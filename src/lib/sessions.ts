import type { SourceType } from "@/lib/analysis";
import type { Attempt } from "@/lib/attempts";
import { supabase } from "@/lib/supabase";

/** A signed-in learner's saved practice on one reference clip. */
export type PracticeSession = {
  id: string;
  analysisId: string;
  lastPracticedAt: string;
  title: string | null;
  sourceType: SourceType;
  sourceKey: string;
  durationSeconds: number | null;
  takeCount: number;
};

/** A shadow take saved to a session, playable from a signed Storage URL. */
export type SavedTake = Attempt & {
  createdAt: string;
  duration: number;
  url: string | null;
};

type SessionRow = {
  id: string;
  analysis_id: string;
  last_practiced_at: string;
  analysis: { title: string | null; view_title: string | null; source_type: SourceType; source_key: string; duration_seconds: number | null } | null;
  attempts: { count: number }[];
};

type SavedTakeRow = Attempt & { audio_path: string; duration_seconds: number | null; created_at: string };

const ATTEMPT_BUCKET = "attempt-audio";
const REFERENCE_BUCKET = "reference-audio";
// Long enough to cover a practice sitting; queries refetch well before then.
const SIGNED_URL_SECONDS = 60 * 60;

function client() {
  if (!supabase) throw new Error("Saved sessions aren't available right now.");
  return supabase;
}

export async function listSessions(): Promise<PracticeSession[]> {
  const { data, error } = await client()
    .from("practice_sessions")
    .select("id,analysis_id,last_practiced_at,analysis:analyses(title,view_title:view->>title,source_type,source_key,duration_seconds),attempts(count)")
    .order("last_practiced_at", { ascending: false })
    .returns<SessionRow[]>();
  if (error) throw new Error(error.message);
  return data.flatMap((row) =>
    row.analysis
      ? [{
          id: row.id,
          analysisId: row.analysis_id,
          lastPracticedAt: row.last_practiced_at,
          title: row.analysis.view_title ?? row.analysis.title,
          sourceType: row.analysis.source_type,
          sourceKey: row.analysis.source_key,
          durationSeconds: row.analysis.duration_seconds,
          takeCount: row.attempts[0]?.count ?? 0,
        }]
      : [],
  );
}

/** Open the signed-in user's session for a clip, creating it on first use. */
export async function startSession(analysisId: string): Promise<string> {
  const { data, error } = await client().rpc("start_session", { p_analysis_id: analysisId }).select("id").single<{ id: string }>();
  if (error) throw new Error(error.message);
  return data.id;
}

/** Every take saved to a session, oldest first. */
export async function fetchSessionTakes(sessionId: string): Promise<SavedTake[]> {
  const db = client();
  const { data, error } = await db
    .from("attempts")
    .select("id,analysis_id,phrase_id,status,error,result,audio_path,duration_seconds,created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .returns<SavedTakeRow[]>();
  if (error) throw new Error(error.message);
  if (!data.length) return [];

  const { data: signed } = await db.storage.from(ATTEMPT_BUCKET).createSignedUrls(data.map((row) => row.audio_path), SIGNED_URL_SECONDS);
  const urls = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));
  return data.map(({ audio_path, duration_seconds, created_at, ...attempt }) => ({
    ...attempt,
    createdAt: created_at,
    duration: duration_seconds ?? 0,
    url: urls.get(audio_path) ?? null,
  }));
}

/** Playable URL for an uploaded reference clip, for sessions reopened without the file. */
export async function referenceAudioUrl(audioPath: string): Promise<string> {
  const { data, error } = await client().storage.from(REFERENCE_BUCKET).createSignedUrl(audioPath, SIGNED_URL_SECONDS);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
