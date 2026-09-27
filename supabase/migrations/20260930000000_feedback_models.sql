-- Feedback models: which model writes a take's feedback.
--
-- Signed-in users pick one in their profile; guests and users who never
-- choose get the default. Each attempt records the model it asked for, and
-- the worker (prosody/prosody_worker/attempts.py) reads it through the
-- feedback_models embed. 'gemini' models listen to the take and the
-- reference clip; 'template' is the rule-based feedback, which is also the
-- fallback whenever a model fails.
--
-- The list is edited in the dashboard or SQL: there are no write policies.
-- Adding another Gemini model is one insert.

create table public.feedback_models (
  id text primary key,
  label text not null,
  description text not null,
  provider text not null check (provider in ('template', 'gemini')),
  model text check ((provider = 'template') = (model is null)),
  is_default boolean not null default false,
  enabled boolean not null default true,
  sort integer not null default 0,
  check (not is_default or enabled)
);

create unique index feedback_models_one_default on public.feedback_models (is_default) where is_default;

alter table public.feedback_models enable row level security;

create policy "enabled feedback models are readable" on public.feedback_models
  for select to anon, authenticated using (enabled);

insert into public.feedback_models (id, label, description, provider, model, is_default, sort) values
  ('gemini-flash-lite', 'Gemini Flash-Lite', 'Listens to your take. Fast and free.', 'gemini', 'gemini-3.1-flash-lite', true, 10),
  ('gemini-flash', 'Gemini Flash', 'Listens to your take. More detailed, a little slower.', 'gemini', 'gemini-3.8-flash', false, 20),
  ('standard', 'Standard', 'Instant rule-based feedback. Your audio stays on our server.', 'template', null, false, 30);

-- ---------------------------------------------------------------------------
-- The user's choice (null = the default) and each attempt's snapshot of it.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column feedback_model text references public.feedback_models (id) on delete set null;

alter table public.attempts
  add column feedback_model text references public.feedback_models (id) on delete set null;

-- A compressed copy of the reference, for the models that listen. YouTube
-- audio is not kept otherwise; rows analysed before this have none, and
-- their takes are heard without the reference.
alter table public.analyses
  add column clip_path text;

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'audio/ogg')
where id = 'reference-audio' and not ('audio/ogg' = any (allowed_mime_types));

-- ---------------------------------------------------------------------------
-- request_attempt: unchanged from 20260928000000_practice_sessions.sql
-- except that the new attempt records which feedback model to use.
-- ---------------------------------------------------------------------------

create or replace function public.request_attempt(
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
  chosen_model text;
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

  -- The user's enabled choice, else the default. Guests get the default.
  select m.id into chosen_model
  from public.profiles p
  join public.feedback_models m on m.id = p.feedback_model and m.enabled
  where p.id = auth.uid();
  if chosen_model is null then
    select id into chosen_model from public.feedback_models where is_default;
  end if;

  insert into public.attempts (
    analysis_id, phrase_id, audio_path, model_size, analyzer_version, user_id, session_id, duration_seconds,
    feedback_model
  ) values (
    p_analysis_id, p_phrase_id, p_audio_path, settings.model_size, settings.analyzer_version,
    auth.uid(), p_session_id, greatest(p_duration, 0),
    chosen_model
  )
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.request_attempt(uuid, integer, text, uuid, real) from public;
grant execute on function public.request_attempt(uuid, integer, text, uuid, real) to anon, authenticated;
