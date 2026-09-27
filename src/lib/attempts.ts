import type { PhrasePart } from "@/components/cadence/data";
import { supabase } from "@/lib/supabase";

export type AttemptStatus = "processing" | "ready" | "failed";

/** How one of the user's words compares with the reference. Mirrors to_comparison_view in prosody_worker/serialize.py. */
export type WordFlag = "hit_beat" | "stressed" | "extra_stress" | "missing_stress" | "reduced" | "missing_word" | null;

export type ComparisonView = {
  reference: PhrasePart[];
  words: { text: string; flag: WordFlag; pauseAfter?: number }[];
  beats: { matched: number; total: number };
  /** rateRatio > 1 means the user spoke more slowly than the reference. */
  pace: { rateRatio: number; userWps: number | null; referenceWps: number | null };
  /** source/model are missing on results saved before feedback models existed. */
  feedback: { positive: string; primary: string | null; secondary: string | null; next: string; source?: "template" | "audio" | "llm"; model?: string | null };
  categories: { name: string; verdict: string; comment: string }[];
};

export type Attempt = {
  id: string;
  analysis_id: string;
  phrase_id: number | null;
  status: AttemptStatus;
  error: string | null;
  result: ComparisonView | null;
};

// Everything but the raw `user_recording` blob, which the UI never needs.
const COLUMNS = "id,analysis_id,phrase_id,status,error,result";
const ATTEMPT_BUCKET = "attempt-audio";
export const MAX_TAKE_BYTES = 10 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "mp4",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
};

/**
 * Upload a recorded take and queue it for comparison against the reference.
 * With a session (signed-in users) the take is saved to it.
 */
export async function submitAttempt({ analysisId, phraseId, blob, sessionId = null, duration = null }: { analysisId: string; phraseId: number | null; blob: Blob; sessionId?: string | null; duration?: number | null }): Promise<Attempt> {
  if (!supabase) throw new Error("Error sending your take for feedback.");
  if (blob.size > MAX_TAKE_BYTES) throw new Error("This take is too long to compare. Try a shorter one.");

  // MediaRecorder reports e.g. "audio/webm;codecs=opus"; Storage matches the base type.
  const mime = blob.type.split(";")[0]?.trim().toLowerCase() || "audio/webm";
  const ext = EXTENSIONS[mime];
  if (!ext) throw new Error("This browser recorded in a format we can't compare yet.");

  const path = `attempts/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(ATTEMPT_BUCKET).upload(path, blob, { contentType: mime, upsert: false });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data, error } = await supabase
    .rpc("request_attempt", { p_analysis_id: analysisId, p_phrase_id: phraseId, p_audio_path: path, p_session_id: sessionId, p_duration: duration })
    .select(COLUMNS)
    .single<Attempt>();
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchAttempt(id: string): Promise<Attempt> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.from("attempts").select(COLUMNS).eq("id", id).single<Attempt>();
  if (error) throw new Error(error.message);
  return data;
}

/** Push row updates for one attempt. Returns an unsubscribe function. */
export function subscribeAttempt(id: string, onChange: (attempt: Attempt) => void): () => void {
  const client = supabase;
  if (!client) return () => {};
  const channel = client
    .channel(`attempt:${id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "attempts", filter: `id=eq.${id}` }, () => {
      // Refetch rather than trusting the payload, which carries the large
      // `user_recording` column and can be truncated for big rows.
      fetchAttempt(id).then(onChange).catch(() => {});
    })
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
