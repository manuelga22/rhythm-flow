/**
 * The AI coach: quick feedback on a take, and answers to follow-up
 * questions, from a Gemini model that hears the reference and the take.
 *
 * Unlike the full analysis there is no queue, worker or transcription: one
 * request, one model call, so the reply comes back in a few seconds and
 * still works while the worker is down.
 *
 * POST { analysisId, phraseId, take: { wav }, history, question }
 *   take.wav  base64 16 kHz mono WAV of the learner's latest take
 *   phraseId  1-based practice view phrase id, or null for the full clip
 *   question  null for a take turn, else the learner's typed question
 * →    { verdict: "on_beat" | "close" | "off" | null, reply }
 *
 * Secrets: GEMINI_API_KEY, optional COACH_MODEL. SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY are provided by the platform; the service role
 * reads reference clips, which the browser cannot.
 */

import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { createClient } from "npm:@supabase/supabase-js@2";
import { measureWav, unusableTake } from "./audio.ts";
import { buildRequest, parseReply, type ChatTurn, type ViewPhrase } from "./gemini.ts";
import { COACH_PROMPT } from "./prompt.ts";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const TIMEOUT_MS = 20_000;
const AUDIO_BUCKET = "reference-audio";
// Original uploads can be large WAVs; inline audio must keep the request under Gemini's 20 MB.
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024;
const REFERENCE_MIME: Record<string, string> = { ogg: "audio/ogg", wav: "audio/wav", mp3: "audio/mpeg" };

// About a minute of 16 kHz mono PCM16, as base64.
const MAX_TAKE_BASE64 = Math.ceil((2 * 1024 * 1024 * 4) / 3);
const MAX_QUESTION = 500;
const MAX_HISTORY = 10;
const MAX_TURN_TEXT = 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class CoachError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type Body = { analysisId: string; phraseId: number | null; take: string; history: ChatTurn[]; question: string | null };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ error: "Use POST.", code: "method" }, 405);
  try {
    return json(await coach(parseBody(await request.json().catch(() => null))));
  } catch (error) {
    if (error instanceof CoachError) return json({ error: error.message, code: error.code }, error.status);
    console.error(error);
    return json({ error: "The coach couldn't answer just now. Try again.", code: "model" }, 502);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function parseBody(raw: unknown): Body {
  const bad = (message: string) => new CoachError(400, "invalid", message);
  if (!raw || typeof raw !== "object") throw bad("Send a JSON body.");
  const body = raw as Record<string, unknown>;

  const analysisId = body["analysisId"];
  if (typeof analysisId !== "string" || !/^[0-9a-f-]{36}$/i.test(analysisId)) throw bad("analysisId must be a uuid.");

  const phraseId = body["phraseId"] ?? null;
  if (phraseId !== null && (typeof phraseId !== "number" || !Number.isInteger(phraseId) || phraseId < 1)) throw bad("phraseId must be a positive integer or null.");

  const take = (body["take"] as { wav?: unknown } | null | undefined)?.wav;
  if (typeof take !== "string" || !take || !/^[A-Za-z0-9+/]+=*$/.test(take)) throw bad("take.wav must be base64 audio.");
  if (take.length > MAX_TAKE_BASE64) throw new CoachError(413, "too_long", "That take is too long for the coach. Keep it under a minute.");

  const question = body["question"] ?? null;
  if (question !== null && (typeof question !== "string" || !question.trim() || question.length > MAX_QUESTION)) {
    throw bad(`question must be 1 to ${MAX_QUESTION} characters, or null.`);
  }

  const history = Array.isArray(body["history"]) ? body["history"] : [];
  const turns: ChatTurn[] = history
    .filter((turn): turn is ChatTurn => Boolean(turn) && (turn.role === "you" || turn.role === "coach") && typeof turn.text === "string")
    .slice(-MAX_HISTORY)
    .map((turn) => ({ role: turn.role, text: turn.text.slice(0, MAX_TURN_TEXT) }));

  return { analysisId, phraseId, take, history: turns, question: typeof question === "string" ? question.trim() : null };
}

async function coach({ analysisId, phraseId, take, history, question }: Body) {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!url || !serviceKey || !apiKey) {
    const missing = Object.entries({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey, GEMINI_API_KEY: apiKey }).filter(([, value]) => !value).map(([name]) => name);
    console.error(`coach is missing secrets: ${missing.join(", ")} (set with \`supabase secrets set\`)`);
    throw new CoachError(503, "config", "The coach isn't set up yet. Try again later.");
  }

  // A silent or clipped take gets an honest answer without a model call:
  // models will describe rhythm they never heard.
  if (question === null) {
    let problem: string | null;
    try {
      problem = unusableTake(measureWav(take));
    } catch {
      throw new CoachError(400, "invalid", "take.wav must be a 16-bit PCM WAV.");
    }
    if (problem) return { verdict: "off" as const, reply: problem };
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: analysis, error } = await supabase.from("analyses").select("status,view,clip_path,audio_path").eq("id", analysisId).maybeSingle();
  if (error) throw new Error(`analysis lookup failed: ${error.message}`);
  if (!analysis || analysis.status !== "ready") throw new CoachError(404, "not_ready", "This clip isn't ready for the coach.");

  const allPhrases: ViewPhrase[] = analysis.view?.phrases ?? [];
  const phrases = phraseId === null ? allPhrases : allPhrases.filter((phrase) => phrase.id === phraseId);
  if (!phrases.length) throw new CoachError(400, "invalid", "That phrase is not part of this clip.");
  const target = phrases[0];

  // Prefer the phrase on its own, then the listening clip of the whole
  // clip, then (for uploads and generated clips analysed before listening
  // clips existed) the original audio. YouTube audio is not kept otherwise.
  let reference: Uint8Array | null = null;
  let referencePath = "";
  const bucket = supabase.storage.from(AUDIO_BUCKET);
  const candidates = [phraseId !== null ? `clips/${analysisId}/phrase-${phraseId}.ogg` : null, analysis.clip_path, analysis.audio_path];
  for (const path of candidates) {
    if (!path || !REFERENCE_MIME[extension(path)]) continue;
    reference = await download(bucket, path);
    if (reference && reference.byteLength <= MAX_REFERENCE_BYTES) {
      referencePath = path;
      break;
    }
    reference = null;
  }
  if (!reference) {
    throw new CoachError(409, "no_reference", "This clip was prepared before the coach could listen to it, so there's no reference audio to compare with. Try the coach on a newer clip, or use Full breakdown here.");
  }
  // Only a phrase clip is already cut to the phrase.
  const whole = !referencePath.includes("/phrase-");
  const range = phraseId !== null && whole && target?.start !== undefined && target.end !== undefined ? { start: target.start, end: target.end } : null;

  const body = buildRequest({
    systemPrompt: COACH_PROMPT,
    reference: { base64: encodeBase64(reference), mime: REFERENCE_MIME[extension(referencePath)] ?? "audio/ogg" },
    range,
    take: { base64: take, mime: "audio/wav" },
    targetLabel: phraseId === null ? "the full clip" : `phrase ${phraseId}`,
    phrases,
    history,
    question,
  });

  const model = Deno.env.get("COACH_MODEL") || DEFAULT_MODEL;
  const response = await fetch(GEMINI_URL.replace("{model}", model), {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return parseReply(await response.json(), question !== null);
}

function extension(path: string) {
  return path.split(".").at(-1)?.toLowerCase() ?? "";
}

/** An object's bytes, or null when it doesn't exist or can't be read. */
async function download(bucket: { download(path: string): Promise<{ data: Blob | null; error: unknown }> }, path: string): Promise<Uint8Array | null> {
  const { data, error } = await bucket.download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}
