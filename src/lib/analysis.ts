import type { PracticePhrase } from "@/components/cadence/data";
import { supabase } from "@/lib/supabase";

export type AnalysisStatus = "processing" | "ready" | "failed";

export type AnalysisView = {
  title: string | null;
  duration: number;
  transcript?: string;
  phrases: PracticePhrase[];
};

export type Analysis = {
  id: string;
  status: AnalysisStatus;
  error: string | null;
  title: string | null;
  source_type: SourceType;
  source_key: string;
  duration_seconds: number | null;
  view: AnalysisView | null;
  /** Object path of an uploaded or generated clip in the reference-audio bucket. */
  audio_path: string | null;
  /** What wrote and voiced a generated clip; null until its audio exists. */
  generation: { movie: string; title: string; voice_name: string } | null;
};

export type SourceType = "youtube" | "upload" | "generated";

export type AnalysisSource = { kind: "youtube"; url: string } | { kind: "upload"; file: File } | { kind: "generated" };

// Everything but the raw `recording` blob, which the UI never needs.
const COLUMNS = "id,status,error,title,source_type,source_key,duration_seconds,view,audio_path,generation";
const AUDIO_BUCKET = "reference-audio";
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
// Safety net alongside Realtime, which can miss updates while reconnecting.
export const ANALYSIS_POLL_MS = 3000;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

/** Mirrors parse_youtube_id in prosody/prosody_worker/sources.py. */
export function youtubeId(input: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  let candidate: string | null | undefined = null;
  if (host === "youtu.be") {
    candidate = parsed.pathname.replace(/^\//, "").split("/")[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (parsed.pathname === "/watch") {
      candidate = parsed.searchParams.get("v");
    } else {
      const [kind, id] = parsed.pathname.replace(/^\/|\/$/g, "").split("/");
      if (kind && ["shorts", "embed", "live", "v"].includes(kind)) candidate = id;
    }
  }
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/** Returns a user-facing problem with the source, or null when it can be analysed. */
export function validateSource(source: AnalysisSource): string | null {
  if (source.kind === "generated") return null;
  if (source.kind === "youtube") {
    if (!source.url.trim()) return "Paste a YouTube link to continue.";
    return youtubeId(source.url) ? null : "That doesn't look like a YouTube video link.";
  }
  if (!/\.wav$/i.test(source.file.name)) return "Choose a .wav file.";
  if (source.file.size > MAX_UPLOAD_BYTES) return "WAV files must be under 25 MB.";
  return null;
}

export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Find a stored analysis for this source or queue a new one.
 * The returned row may still be `processing`; follow it with subscribeAnalysis.
 */
export async function requestAnalysis(source: AnalysisSource): Promise<Analysis> {
  const problem = validateSource(source);
  if (problem) throw new Error(problem);
  if (!supabase) {
    throw new Error("Error fetching your rhythm analysis.");
  }

  // Every generated clip is new, so there is nothing to look up first.
  if (source.kind === "generated") {
    const { data, error } = await supabase.rpc("request_generated_analysis").select(COLUMNS).single<Analysis>();
    if (error) throw new Error(error.message);
    return data;
  }

  const sourceKey = source.kind === "youtube" ? `youtube:${youtubeId(source.url)}` : `upload:${await sha256Hex(source.file)}`;

  const { data: existing, error: findError } = await supabase.rpc("find_analysis", { p_source_key: sourceKey }).select(COLUMNS).maybeSingle<Analysis>();
  if (findError) throw new Error(findError.message);
  if (existing && existing.status !== "failed") return existing;

  if (source.kind === "upload") await uploadWav(sourceKey, source.file);

  const { data, error } = await supabase
    .rpc("request_analysis", {
      p_source_type: source.kind,
      p_source_key: sourceKey,
      p_source_url: source.kind === "youtube" ? source.url.trim() : null,
      p_title: source.kind === "upload" ? source.file.name : null,
    })
    .select(COLUMNS)
    .single<Analysis>();
  if (error) throw new Error(error.message);
  return data;
}

async function uploadWav(sourceKey: string, file: File) {
  if (!supabase) return;
  const path = `uploads/${sourceKey.replace(/^upload:/, "")}.wav`;
  const { error } = await supabase.storage.from(AUDIO_BUCKET).upload(path, file, { contentType: "audio/wav", upsert: false });
  // Content-addressed: an existing object already holds these exact bytes.
  if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`Upload failed: ${error.message}`);
}

export async function fetchAnalysis(id: string): Promise<Analysis> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.from("analyses").select(COLUMNS).eq("id", id).single<Analysis>();
  if (error) throw new Error(error.message);
  return data;
}

/** Push row updates for one analysis. Returns an unsubscribe function. */
export function subscribeAnalysis(id: string, onChange: (analysis: Analysis) => void): () => void {
  const client = supabase;
  if (!client) return () => {};
  const channel = client
    .channel(`analysis:${id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "analyses", filter: `id=eq.${id}` }, () => {
      // Refetch rather than trusting the payload, which carries the large
      // `recording` column and can be truncated for big rows.
      fetchAnalysis(id).then(onChange).catch(() => {});
    })
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
