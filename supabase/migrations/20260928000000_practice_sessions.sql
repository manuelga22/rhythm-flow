-- Saved practice sessions for signed-in learners.
--
-- A session ties a user to one reference analysis; picking the same clip
-- again reuses it. Shadow attempts made while signed in carry the user and
-- session, so they can be listed and replayed later. Guests keep working as
-- before: their attempts have no user and stay readable by id only.

create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_practiced_at timestamptz not null default now(),
  unique (user_id, analysis_id)
);

create index practice_sessions_recent_idx on public.practice_sessions (user_id, last_practiced_at desc);

alter table public.practice_sessions enable row level security;

create policy "users read their own sessions" on public.practice_sessions
  for select to authenticated using (user_id = auth.uid());

-- Open the caller's session for an analysis, creating it on first use.
create function public.start_session(p_analysis_id uuid)
returns public.practice_sessions
language plpgsql security definer set search_path = public as $$
declare
  result public.practice_sessions;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.analyses where id = p_analysis_id) then
    raise exception 'analysis % not found', p_analysis_id using errcode = '22023';
  end if;

  insert into public.practice_sessions (user_id, analysis_id)
  values (auth.uid(), p_analysis_id)
  on conflict (user_id, analysis_id) do update set last_practiced_at = now()
  returning * into result;
  return result;
end;
$$;

revoke execute on function public.start_session(uuid) from public, anon;
grant execute on function public.start_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Attempts: owner, session and take length.
-- ---------------------------------------------------------------------------

alter table public.attempts
  add column user_id uuid references auth.users (id) on delete cascade,
  add column session_id uuid references public.practice_sessions (id) on delete cascade,
  add column duration_seconds real check (duration_seconds is null or duration_seconds >= 0);

create index attempts_session_idx on public.attempts (session_id, created_at) where session_id is not null;

drop policy "attempts are readable" on public.attempts;

-- Guest attempts (no user) stay readable by id, as before; saved ones are private.
create policy "attempts are readable by their owner" on public.attempts
  for select to anon, authenticated using (user_id is null or user_id = auth.uid());

drop function public.request_attempt(uuid, integer, text);

create function public.request_attempt(
  p_analysis_id uuid,
  p_phrase_id integer,
  p_audio_path text,
  p_session_id uuid default null,
  p_duration real default null
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

  if p_session_id is not null then
    update public.practice_sessions set last_practiced_at = now()
    where id = p_session_id and user_id = auth.uid() and analysis_id = p_analysis_id;
    if not found then
      raise exception 'session % is not yours or is for another clip', p_session_id using errcode = '42501';
    end if;
  end if;

  select * into settings from public.analysis_settings();

  insert into public.attempts (
    analysis_id, phrase_id, audio_path, model_size, analyzer_version, user_id, session_id, duration_seconds
  ) values (
    p_analysis_id, p_phrase_id, p_audio_path, settings.model_size, settings.analyzer_version,
    auth.uid(), p_session_id, greatest(p_duration, 0)
  )
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.request_attempt(uuid, integer, text, uuid, real) from public;
grant execute on function public.request_attempt(uuid, integer, text, uuid, real) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: replaying saved takes and reopened upload clips.
-- ---------------------------------------------------------------------------

create policy "users read their own attempt audio" on storage.objects
  for select to authenticated
  using (bucket_id = 'attempt-audio' and owner_id = auth.uid()::text);

-- Used by account deletion to clean up takes before the rows cascade away.
create policy "users delete their own attempt audio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'attempt-audio' and owner_id = auth.uid()::text);

create policy "users read reference uploads from their sessions" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reference-audio'
    and exists (
      select 1
      from public.practice_sessions s
      join public.analyses a on a.id = s.analysis_id
      where s.user_id = auth.uid() and a.audio_path = storage.objects.name
    )
  );
