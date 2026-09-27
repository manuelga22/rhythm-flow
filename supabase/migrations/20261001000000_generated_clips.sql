-- AI-generated reference clips.
--
-- request_generated_analysis() queues a 'generated' analysis. The worker
-- (prosody/prosody_worker/generate.py) has Gemini write a short monologue
-- inspired by a well-known movie, voices it with ElevenLabs, stores the MP3
-- at audio_path, and then analyses it like any other clip. The existing
-- analyses_wake_worker trigger wakes the hosted worker.
--
-- Open to guests for the demo; each call spends ElevenLabs and Gemini
-- credits, so add a cap here if that changes.

alter table public.analyses drop constraint analyses_source_type_check;
alter table public.analyses add constraint analyses_source_type_check
  check (source_type in ('youtube', 'upload', 'generated'));

-- {movie, title, script, voice_id, voice_name}, written by the worker once
-- the audio is stored, so a retried job reuses it instead of paying again.
alter table public.analyses add column generation jsonb;

create function public.request_generated_analysis()
returns public.analyses
language plpgsql security definer set search_path = public as $$
declare
  settings record;
  clip_id uuid := gen_random_uuid();
  result public.analyses;
begin
  select * into settings from public.analysis_settings();

  insert into public.analyses (source_type, source_key, model_size, analyzer_version, audio_path)
  values ('generated', 'generated:' || clip_id, settings.model_size, settings.analyzer_version,
          'generated/' || clip_id || '.mp3')
  returning * into result;

  return result;
end;
$$;

revoke execute on function public.request_generated_analysis() from public;
grant execute on function public.request_generated_analysis() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage: the worker stores ElevenLabs MP3s; anyone may play them.
-- ---------------------------------------------------------------------------

update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'audio/mpeg')
where id = 'reference-audio' and not ('audio/mpeg' = any (allowed_mime_types));

create policy "anyone reads generated reference clips" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'reference-audio' and name like 'generated/%');
