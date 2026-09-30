/**
 * The Gemini request the coach sends and the reply it expects. Pure, so it
 * is tested without the network (gemini_test.ts). Mirrors build_request in
 * prosody/prosody_coach/listen.py: labelled audio parts, then the facts.
 */

export type Verdict = "on_beat" | "close" | "off";
export type ChatTurn = { role: "you" | "coach"; text: string };
export type PhrasePart = { text: string; accent?: "up" | "down" };
export type ViewPhrase = { id: number; text: string; start?: number; end?: number; structure: PhrasePart[] };
export type AudioInput = { base64: string; mime: string };
export type CoachReply = { verdict: Verdict | null; reply: string };

export const VERDICTS: readonly Verdict[] = ["on_beat", "close", "off"];

const OUTPUT_FORMAT = `

## Reply format

Respond with a JSON object containing exactly these keys:
  "verdict" - for a take: "on_beat" (matches the reference), "close" (one
              thing to fix) or "off" (clearly different, or no usable take);
              for a question: null
  "reply"   - what you say to the learner, plain text
`;

/** The phrase with stressed words in CAPS and their pitch direction, e.g. "so I THINK↗ we". */
export function stressPattern(phrases: ViewPhrase[]): string {
  return phrases
    .map((phrase) => phrase.structure.map((part) => (part.accent ? `${part.text.toUpperCase()}${part.accent === "up" ? "↗" : "↘"}` : part.text)).join(""))
    .join(" / ");
}

/** m:ss.s, precise enough to find a phrase in a clip. */
export function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}`;
}

export function buildRequest({
  systemPrompt,
  reference,
  range,
  take,
  targetLabel,
  phrases,
  history,
  question,
}: {
  systemPrompt: string;
  reference: AudioInput;
  /** Where the practised phrase sits when `reference` is the whole clip. */
  range: { start: number; end: number } | null;
  take: AudioInput;
  targetLabel: string;
  phrases: ViewPhrase[];
  history: ChatTurn[];
  question: string | null;
}) {
  const where = range ? ` This is the whole clip; the learner practised only the part from ${clock(range.start)} to ${clock(range.end)}, so compare against that part.` : "";
  const parts: Record<string, unknown>[] = [
    { text: `Audio 1: the native reference.${where}` },
    audioPart(reference),
    { text: "Audio 2: the learner's latest take." },
    audioPart(take),
    { text: `Target (${targetLabel}):\n${stressPattern(phrases)}` },
  ];
  if (history.length) {
    const lines = history.map((turn) => `${turn.role === "you" ? "Learner" : "Coach"}: ${turn.text}`);
    parts.push({ text: `Conversation so far:\n${lines.join("\n")}` });
  }
  parts.push({ text: question ? `Question turn. The learner asks: ${JSON.stringify(question)}` : "Take turn. Give quick feedback on Audio 2." });
  return {
    system_instruction: { parts: [{ text: systemPrompt + OUTPUT_FORMAT }] },
    contents: [{ role: "user", parts }],
    // Room for the model's thinking, which counts toward the limit; the prompt keeps replies short.
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 2048 },
  };
}

function audioPart(audio: AudioInput) {
  return { inline_data: { mime_type: audio.mime, data: audio.base64 } };
}

/** The coach's reply from a generateContent response. Throws on anything unusable. */
export function parseReply(body: unknown, isQuestion: boolean): CoachReply {
  const candidates = (body as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[] })?.candidates ?? [];
  const first = candidates[0];
  if (!first) throw new Error("Gemini returned no answer");
  const text = (first.content?.parts ?? []).map((part) => part.text ?? "").join("").trim();
  if (!text) throw new Error(`Gemini returned an empty answer (${first.finishReason ?? "unknown"})`);

  let data: unknown;
  try {
    // Models sometimes wrap JSON in a code fence despite the MIME type.
    data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new Error("Gemini's answer was not JSON");
  }
  const reply = typeof (data as { reply?: unknown })?.reply === "string" ? (data as { reply: string }).reply.trim() : "";
  if (!reply) throw new Error("Gemini's answer had no reply");
  const verdict = (data as { verdict?: unknown }).verdict;
  return { verdict: !isQuestion && VERDICTS.includes(verdict as Verdict) ? (verdict as Verdict) : null, reply };
}
