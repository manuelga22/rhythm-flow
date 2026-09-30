-- Let several workers share a queue, and size the hosted pool to the backlog.
--
-- claim_next_analysis() / claim_next_attempt() pick the oldest pending row
-- and claim it in one statement. FOR UPDATE SKIP LOCKED makes workers that
-- ask at the same moment get different rows instead of racing for one.
-- Every claim stamps a fresh claim_token, and the worker writes its result
-- back only while the row still carries that token, so a worker whose claim
-- expired cannot overwrite the result of the retry that replaced it.
--
-- reserve_workers() decides how many hosted workers (prosody/modal_app.py)
-- a queue needs: one per p_waiting_per_worker waiting rows, capped. Each
-- reservation is a queue_workers row from the moment the worker is spawned,
-- so cold starts count, until the worker exits or the reservation expires.
--
-- All of these run with the service-role key only.

alter table public.analyses add column claim_token uuid;
alter table public.attempts add column claim_token uuid;

create index analyses_claim_idx on public.analyses (analyzer_version, created_at)
  where status = 'processing';
create index attempts_claim_idx on public.attempts (analyzer_version, created_at)
  where status = 'processing';

-- ---------------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------------

create function public.claim_next_analysis(
  p_analyzer_version text,
  p_claim_timeout_seconds integer,
  p_max_attempts integer
)
returns jsonb
language plpgsql set search_path = public as $$
declare
  stale timestamptz := now() - make_interval(secs => p_claim_timeout_seconds);
  claimed public.analyses;
begin
  -- Rows that keep killing workers are given up on, not retried forever.
  update public.analyses
  set status = 'failed', error = 'Analysis did not finish after several attempts.'
  where status = 'processing'
    and analyzer_version = p_analyzer_version
    and attempts >= p_max_attempts
    and (claimed_at is null or claimed_at < stale);

  update public.analyses a
  set attempts = a.attempts + 1, claimed_at = now(), claim_token = gen_random_uuid()
  where a.id = (
    select id from public.analyses
    where status = 'processing'
      and analyzer_version = p_analyzer_version
      and attempts < p_max_attempts
      and (claimed_at is null or claimed_at < stale)
    order by created_at
    limit 1
    for update skip locked
  )
  returning a.* into claimed;

  if not found then
    return null;
  end if;
  return to_jsonb(claimed);
end;
$$;

-- Same as claim_next_analysis(), plus the feedback model the take asked
-- for, in the shape prosody_worker/attempts.py reads.
create function public.claim_next_attempt(
  p_analyzer_version text,
  p_claim_timeout_seconds integer,
  p_max_attempts integer
)
returns jsonb
language plpgsql set search_path = public as $$
declare
  stale timestamptz := now() - make_interval(secs => p_claim_timeout_seconds);
  claimed public.attempts;
begin
  update public.attempts
  set status = 'failed', error = 'Feedback did not finish after several attempts.'
  where status = 'processing'
    and analyzer_version = p_analyzer_version
    and attempts >= p_max_attempts
    and (claimed_at is null or claimed_at < stale);

  update public.attempts a
  set attempts = a.attempts + 1, claimed_at = now(), claim_token = gen_random_uuid()
  where a.id = (
    select id from public.attempts
    where status = 'processing'
      and analyzer_version = p_analyzer_version
      and attempts < p_max_attempts
      and (claimed_at is null or claimed_at < stale)
    order by created_at
    limit 1
    for update skip locked
  )
  returning a.* into claimed;

  if not found then
    return null;
  end if;
  return to_jsonb(claimed) || jsonb_build_object(
    'feedback_models',
    (select jsonb_build_object('provider', f.provider, 'model', f.model, 'label', f.label)
     from public.feedback_models f
     where f.id = claimed.feedback_model)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Hosted worker pool
-- ---------------------------------------------------------------------------

create table public.queue_workers (
  id uuid primary key default gen_random_uuid(),
  queue text not null check (queue in ('analyses', 'attempts')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index queue_workers_queue_idx on public.queue_workers (queue, expires_at);

alter table public.queue_workers enable row level security;
revoke all on public.queue_workers from anon, authenticated;

-- Reserve the workers p_queue is short of and return their ids; the caller
-- spawns one worker per id. Waiting rows are pending ones nobody holds a
-- live claim on.
create function public.reserve_workers(
  p_queue text,
  p_analyzer_version text,
  p_waiting_per_worker integer,
  p_max_workers integer,
  p_lifetime_seconds integer,
  p_claim_timeout_seconds integer
)
returns uuid[]
language plpgsql set search_path = public as $$
declare
  stale timestamptz := now() - make_interval(secs => p_claim_timeout_seconds);
  waiting integer;
  live integer;
  target integer;
  reserved uuid[];
begin
  if p_queue not in ('analyses', 'attempts') then
    raise exception 'unknown queue %', p_queue using errcode = '22023';
  end if;

  -- One decision per queue at a time: two wakes arriving together must not
  -- both see the same shortfall and each spawn for it.
  perform pg_advisory_xact_lock(hashtext('reserve_workers:' || p_queue));

  delete from public.queue_workers where queue = p_queue and expires_at <= now();

  if p_queue = 'analyses' then
    select count(*) into waiting from public.analyses
    where status = 'processing'
      and analyzer_version = p_analyzer_version
      and (claimed_at is null or claimed_at < stale);
  else
    select count(*) into waiting from public.attempts
    where status = 'processing'
      and analyzer_version = p_analyzer_version
      and (claimed_at is null or claimed_at < stale);
  end if;

  select count(*) into live from public.queue_workers where queue = p_queue;
  target := least(p_max_workers, ceil(waiting::numeric / p_waiting_per_worker)::integer);

  with inserted as (
    insert into public.queue_workers (queue, expires_at)
    select p_queue, now() + make_interval(secs => p_lifetime_seconds)
    from generate_series(1, target - live)
    returning id
  )
  select coalesce(array_agg(id), '{}') into reserved from inserted;

  return reserved;
end;
$$;

revoke execute on function public.claim_next_analysis(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.claim_next_attempt(text, integer, integer) from public, anon, authenticated;
revoke execute on function public.reserve_workers(text, text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_next_analysis(text, integer, integer) to service_role;
grant execute on function public.claim_next_attempt(text, integer, integer) to service_role;
grant execute on function public.reserve_workers(text, text, integer, integer, integer, integer) to service_role;
