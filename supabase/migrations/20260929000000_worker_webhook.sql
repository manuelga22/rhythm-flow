-- Wake the hosted worker (prosody/modal_app.py) when a job is queued.
--
-- Whenever an analysis or attempt enters 'processing', POST
-- {"queue": "<table>"} to the worker's wake endpoint. pg_net sends the
-- request after the transaction commits, so the request RPCs are not
-- slowed down and a slow or failed call cannot roll them back.
--
-- The endpoint URL and its bearer token live in Vault, not in git. Until
-- both secrets exist the trigger does nothing, so databases served by the
-- local polling worker are unaffected. Set them once in the SQL editor:
--
--   select vault.create_secret('https://<workspace>--prosody-worker-wake.modal.run', 'worker_webhook_url');
--   select vault.create_secret('<WORKER_WEBHOOK_TOKEN>', 'worker_webhook_token');

create extension if not exists pg_net with schema extensions;

create function public.wake_worker() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  webhook_url text;
  webhook_token text;
begin
  -- A status update that leaves the row in 'processing' queues nothing new.
  if tg_op = 'UPDATE' and old.status = 'processing' then
    return new;
  end if;

  select decrypted_secret into webhook_url
  from vault.decrypted_secrets where name = 'worker_webhook_url';
  select decrypted_secret into webhook_token
  from vault.decrypted_secrets where name = 'worker_webhook_token';
  if webhook_url is null or webhook_token is null then
    return new;
  end if;

  perform net.http_post(
    url := webhook_url,
    body := jsonb_build_object('queue', tg_table_name),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || webhook_token
    )
  );
  return new;
end;
$$;

revoke execute on function public.wake_worker() from public;

create trigger analyses_wake_worker
  after insert or update of status on public.analyses
  for each row when (new.status = 'processing')
  execute function public.wake_worker();

create trigger attempts_wake_worker
  after insert or update of status on public.attempts
  for each row when (new.status = 'processing')
  execute function public.wake_worker();
