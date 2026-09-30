import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/** How a take compares with the reference, as the coach heard it. Mirrors supabase/functions/coach/gemini.ts. */
export type CoachVerdict = "on_beat" | "close" | "off";
export type CoachTurn = { role: "you" | "coach"; text: string };
export type CoachReply = { verdict: CoachVerdict | null; reply: string };

export const VERDICT_LABEL: Record<CoachVerdict, string> = { on_beat: "On beat", close: "Close", off: "Try again" };

/** A coach failure the UI can act on: `no_reference` means the coach can't be used on this clip at all. */
export class CoachError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * Ask the AI coach (the `coach` Edge Function) about the learner's latest
 * take. With no `question` it gives quick feedback on the take; with one it
 * answers it, hearing the take again.
 */
export async function askCoach({ analysisId, phraseId, wavBase64, history, question = null }: { analysisId: string; phraseId: number | null; wavBase64: string; history: CoachTurn[]; question?: string | null }): Promise<CoachReply> {
  if (!supabase) throw new CoachError("The coach isn't available right now.", "config");
  const { data, error } = await supabase.functions.invoke<CoachReply>("coach", {
    body: { analysisId, phraseId, take: { wav: wavBase64 }, history, question },
  });
  if (error) {
    // The function answers errors as { error, code }.
    if (error instanceof FunctionsHttpError) {
      const body = (await (error.context as Response).json().catch(() => null)) as { error?: string; code?: string } | null;
      throw new CoachError(body?.error ?? "The coach couldn't answer just now. Try again.", body?.code ?? "model");
    }
    throw new CoachError("Couldn't reach the coach. Check your connection and try again.", "network");
  }
  if (!data?.reply) throw new CoachError("The coach couldn't answer just now. Try again.", "model");
  return data;
}
