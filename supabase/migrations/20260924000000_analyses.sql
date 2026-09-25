-- Reference-clip analyses for the Practice flow.
--
-- The browser never writes to this table directly. It reads rows (RLS
-- select policy) and asks for new ones through request_analysis(), which
-- dedupes on the source. The Python worker (prosody/prosody_worker) claims
-- 'processing' rows with the service-role key, runs prosody_coach and writes
-- the result back.

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('youtube', 'upload')),
  source_key text not null,              -- youtube:<video id> | upload:<sha256>
  source_url text,                       -- as pasted by the user, display only
  title text,
  duration_seconds real,
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'failed')),
  error text,
  model_size text not null,
  analyzer_version text not null,
  -- Speaker-level summary of the analysed recording. Stable across analyzer
  -- versions, so these get real columns for querying; per-word detail lives
  -- in `recording`, whose shape is free to change with analyzer_version.
  transcript text,
  pitch_baseline_hz real,
  pitch_range_hz real,
  speech_rate_wps real,
  articulation_rate_wps real,
  total_pause_time real,
  recording jsonb                        -- prosody_coach Recording.to_dict()
    check (recording is null or jsonb_typeof(recording->'words') = 'array'),
  view jsonb,                            -- phrase view model the UI renders
  audio_path text,                       -- object path in the reference-audio bucket
  attempts integer not null default 0,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_key, model_size, analyzer_version),
  check (status <> 'ready' or (recording is not null and view is not null))
);

create index analyses_pending_idx on public.analyses (analyzer_version, claimed_at)
  where status = 'processing';

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger analyses_touch_updated_at
  before update on public.analyses
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Engine settings. Bump analyzer_version whenever prosody_coach output
-- changes shape or meaning; existing rows then stop matching and clips are
-- re-analysed on next request. The worker only processes rows whose
-- analyzer_version equals its own ANALYZER_VERSION.
-- ---------------------------------------------------------------------------

create function public.analysis_settings(out model_size text, out analyzer_version text)
language sql immutable as $$
  select 'small'::text, '1'::text;
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Read-only cache lookup for the current engine settings.
create function public.find_analysis(p_source_key text)
returns setof public.analyses
language sql stable as $$
  select a.*
  from public.analyses a, public.analysis_settings() s
  where a.source_key = p_source_key
    and a.model_size = s.model_size
    and a.analyzer_version = s.analyzer_version;
$$;

-- Return the analysis for a source, creating a 'processing' row if none
-- exists. A previously failed row is reset so the worker retries it.
create function public.request_analysis(
  p_source_type text,
  p_source_key text,
  p_source_url text default null,
  p_title text default null
)
returns public.analyses
language plpgsql security definer set search_path = public as $$
declare
  settings record;
  result public.analyses;
begin
  if not (
    (p_source_type = 'youtube' and p_source_key ~ '^youtube:[A-Za-z0-9_-]{11}$')
    or (p_source_type = 'upload' and p_source_key ~ '^upload:[0-9a-f]{64}$')
  ) then
    raise exception 'invalid source %:%', p_source_type, p_source_key
      using errcode = '22023';
  end if;

  select * into settings from public.analysis_settings();

  insert into public.analyses (
    source_type, source_key, source_url, title, model_size, analyzer_version, audio_path
  ) values (
    p_source_type,
    p_source_key,
    left(p_source_url, 500),
    left(p_title, 200),
    settings.model_size,
    settings.analyzer_version,
    case when p_source_type = 'upload'
      then 'uploads/' || substr(p_source_key, 8) || '.wav'
    end
  )
  on conflict (source_key, model_size, analyzer_version) do update
    set status = 'processing', error = null, attempts = 0, claimed_at = null
    where analyses.status = 'failed'
  returning * into result;

  if not found then
    select * into result
    from public.analyses
    where source_key = p_source_key
      and model_size = settings.model_size
      and analyzer_version = settings.analyzer_version;
  end if;

  return result;
end;
$$;

revoke execute on function public.request_analysis(text, text, text, text) from public;
grant execute on function public.request_analysis(text, text, text, text) to anon, authenticated;
grant execute on function public.find_analysis(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security: world-readable, writes only via RPC or service role.
-- TODO(auth): scope reads to owners once analyses are tied to users.
-- ---------------------------------------------------------------------------

alter table public.analyses enable row level security;

create policy "analyses are readable" on public.analyses
  for select to anon, authenticated using (true);

alter publication supabase_realtime add table public.analyses;

-- ---------------------------------------------------------------------------
-- Storage: uploaded reference WAVs, content-addressed by sha256.
-- Uploads cannot overwrite (no update policy), so a given hash always maps
-- to the bytes that produced it; the worker re-verifies the hash anyway.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reference-audio', 'reference-audio', false, 26214400,
        array['audio/wav', 'audio/x-wav', 'audio/wave'])
on conflict (id) do nothing;

create policy "anyone can upload reference wavs" on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'reference-audio'
    and name ~ '^uploads/[0-9a-f]{64}\.wav$'
  );
