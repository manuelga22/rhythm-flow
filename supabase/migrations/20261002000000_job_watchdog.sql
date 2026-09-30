-- Fail jobs the worker never finishes.
--
-- Only the worker marks an analysis or attempt 'failed', so when no worker
-- runs at all (the Modal workspace is out of credits, the deploy is broken,
-- the local poller isn't started) rows stay 'processing' forever and the app
-- waits on them indefinitely. A stuck analysis also blocks retries, because
-- request_analysis() only re-queues failed rows.
--
-- expire_stalled_jobs() runs every 30 seconds on pg_cron, inside the
-- database, so it works without the worker. It fails two kinds of rows:
--
--   * Never picked up: unclaimed for longer than unclaimed_timeout while
--     nothing else in the queue is being worked on either. A live worker
--     claims a job within seconds of being woken, and a busy one (Modal
--     runs one container per queue, oldest job first) holds an active
--     claim, so this only fires when no worker is running.
--   * Abandoned: claimed longer ago than abandoned_timeout. A live worker
--     reclaims a stale claim after claim_timeout, so a row still stuck
--     after abandoned_timeout means no worker came back for it.
--
-- The browser already follows these rows over Realtime and polling, so the
-- error_message reaches the user as soon as a row flips to 'failed'.
--
-- Timeouts live in job_settings, one row per queue. Change them without a
-- deploy; the next run picks them up. For example:
--
--   update public.job_settings set unclaimed_timeout = '1 minute' where queue = 'attempts';
--
-- claim_timeout is also read by the worker (prosody_worker/store.py) to
-- decide when a claimed row counts as abandoned by a crashed run and may be
-- claimed again. Keep it above the Modal drain timeouts in
-- prosody/modal_app.py, or a slow but healthy job gets processed twice.

create extension if not exists pg_cron with schema pg_catalog;

create table public.job_settings (
  queue text primary key check (queue in ('analyses', 'attempts')),
  -- How long a queued job may wait for a worker before it fails.
  unclaimed_timeout interval not null check (unclaimed_timeout > interval '0'),
  -- How long a claimed job may run before another worker may reclaim it.
  claim_timeout interval not null check (claim_timeout > interval '0'),
  -- How long after its claim a job fails if no worker has finished it.
  abandoned_timeout interval not null,
  -- Shown to the user on the failed job.
  error_message text not null check (length(error_message) between 1 and 500),
  check (abandoned_timeout > claim_timeout)
);

insert into public.job_settings (queue, unclaimed_timeout, claim_timeout, abandoned_timeout, error_message) values
  ('analyses', '2 minutes', '15 minutes', '25 minutes',
   'Our rhythm analysis service isn''t responding right now. Please try again in a few minutes.'),
  ('attempts', '2 minutes', '15 minutes', '25 minutes',
   'Feedback isn''t available right now because our analysis service didn''t respond. Try again in a few minutes.');

-- Service role and the watchdog only; the browser never sees these.
alter table public.job_settings enable row level security;
revoke all on public.job_settings from anon, authenticated;

create function public.expire_stalled_jobs() returns void
language plpgsql security definer set search_path = public as $$
declare
  settings public.job_settings;
begin
  for settings in select * from public.job_settings loop
    -- Never picked up, and no worker is busy with anything else in the queue.
    -- updated_at rather than created_at: request_analysis() re-queues old rows.
    execute format($sql$
      update public.%1$I job
      set status = 'failed', error = $1
      where job.status = 'processing'
        and job.claimed_at is null
        and job.updated_at < now() - $2
        and not exists (
          select 1 from public.%1$I active
          where active.status = 'processing'
            and active.claimed_at > now() - $3
        )
    $sql$, settings.queue)
    using settings.error_message, settings.unclaimed_timeout, settings.claim_timeout;

    -- Claimed, but no worker finished or reclaimed it.
    execute format($sql$
      update public.%1$I
      set status = 'failed', error = $1
      where status = 'processing'
        and claimed_at < now() - $2
    $sql$, settings.queue)
    using settings.error_message, settings.abandoned_timeout;
  end loop;
end;
$$;

revoke execute on function public.expire_stalled_jobs() from public, anon, authenticated;

-- Re-running cron.schedule with the same name updates the job in place.
select cron.schedule('expire-stalled-jobs', '30 seconds', $$select public.expire_stalled_jobs()$$);
