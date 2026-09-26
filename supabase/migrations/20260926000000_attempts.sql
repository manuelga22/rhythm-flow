-- Shadowing attempts: a learner's take compared against a reference analysis.
--
-- Same shape as analyses: the browser uploads the take to Storage, then asks
-- for a row through request_attempt(). The Python worker claims
-- 'processing' rows on a dedicated thread, runs the prosody_coach comparison
-- and writes the result back.

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  phrase_id integer,                     -- 1-based view phrase id; null = full clip
  audio_path text not null,              -- object path in the attempt-audio bucket
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'failed')),
  error text,
  model_size text not null,
  analyzer_version text not null,
  user_recording jsonb                   -- prosody_coach Recording.to_dict() of the take
    check (user_recording is null or jsonb_typeof(user_recording->'words') = 'array'),
  result jsonb,                          -- comparison view model the UI renders
  attempts integer not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'ready' or (user_recording is not null and result is not null))
);

create index attempts_pending_idx on public.attempts (analyzer_version, claimed_at)
  where status = 'processing';

create trigger attempts_touch_updated_at
  before update on public.attempts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

create function public.request_attempt(
  p_analysis_id uuid,
  p_phrase_id integer,
  p_audio_path text
)
returns public.attempts
language plpgsql security definer set search_path = public as $$
declare
  settings record;
  reference public.analyses;
  result public.attempts;
begin
  if p_audio_path is null
    or p_audio_path !~ '^attempts/[0-9a-f-]{36}\.(webm|ogg|mp4|m4a|wav)$' then
    raise exception 'invalid audio path %', p_audio_path using errcode = '22023';
  end if;

  select * into reference from public.analyses where id = p_analysis_id;
  if not found or reference.status <> 'ready' then
    raise exception 'analysis % is not ready', p_analysis_id using errcode = '22023';
  end if;

  if p_phrase_id is not null
    and (p_phrase_id < 1 or p_phrase_id > jsonb_array_length(reference.view->'phrases')) then
    raise exception 'phrase % is out of range', p_phrase_id using errcode = '22023';
  end if;

  select * into settings from public.analysis_settings();

  insert into public.attempts (analysis_id, phrase_id, audio_path, model_size, analyzer_version)
  values (p_analysis_id, p_phrase_id, p_audio_path, settings.model_size, settings.analyzer_version)
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.request_attempt(uuid, integer, text) from public;
grant execute on function public.request_attempt(uuid, integer, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security: world-readable, writes only via RPC or service role.
-- Attempt ids are random, so a row is only found by whoever created it.
-- TODO(auth): scope reads to owners once attempts are tied to users.
-- ---------------------------------------------------------------------------

alter table public.attempts enable row level security;

create policy "attempts are readable" on public.attempts
  for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.attempts;

-- ---------------------------------------------------------------------------
-- Storage: learner takes as recorded by the browser (webm/ogg/mp4/wav).
-- Paths are random uuids chosen by the browser; there is no update policy,
-- so an uploaded take cannot be replaced.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attempt-audio', 'attempt-audio', false, 10485760,
        array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/wave'])
on conflict (id) do nothing;

create policy "anyone can upload attempt audio" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'attempt-audio'
    and name ~ '^attempts/[0-9a-f-]{36}\.(webm|ogg|mp4|m4a|wav)$'
  );
