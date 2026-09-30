// Run with: npx deno test supabase/functions/coach/

import { assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { buildRequest, clock, parseReply, stressPattern, type ViewPhrase } from "./gemini.ts";

const PHRASE: ViewPhrase = {
  id: 2,
  text: "so I think we should go",
  start: 12.3,
  end: 14.05,
  structure: [{ text: "so I " }, { text: "think", accent: "up" }, { text: " we should " }, { text: "go", accent: "down" }],
};

const AUDIO = { base64: "AAAA", mime: "audio/ogg" };

type Part = { text?: string; inline_data?: { mime_type: string } };

function parts(request: ReturnType<typeof buildRequest>): Part[] {
  return request.contents[0]?.parts as Part[];
}

function gemini(text: string) {
  return { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] };
}

Deno.test("stressPattern puts stressed words in caps with their pitch", () => {
  assertEquals(stressPattern([PHRASE]), "so I THINK↗ we should GO↘");
});

Deno.test("clock shows tenths of a second", () => {
  assertEquals(clock(12.3), "0:12.3");
  assertEquals(clock(75.04), "1:15.0");
});

Deno.test("buildRequest labels the reference before the take", () => {
  const request = buildRequest({ systemPrompt: "Coach.", reference: AUDIO, range: null, take: { base64: "BBBB", mime: "audio/wav" }, targetLabel: "phrase 2", phrases: [PHRASE], history: [], question: null });
  const [refLabel, ref, takeLabel, take, target, turn] = parts(request);
  assertStringIncludes(refLabel?.text ?? "", "Audio 1");
  assertEquals(ref?.inline_data?.mime_type, "audio/ogg");
  assertStringIncludes(takeLabel?.text ?? "", "Audio 2");
  assertEquals(take?.inline_data?.mime_type, "audio/wav");
  assertStringIncludes(target?.text ?? "", "THINK↗");
  assertStringIncludes(turn?.text ?? "", "Take turn");
  assertStringIncludes(JSON.stringify(request.system_instruction), '\\"verdict\\"');
});

Deno.test("buildRequest points at the phrase inside a whole-clip reference", () => {
  const request = buildRequest({ systemPrompt: "Coach.", reference: AUDIO, range: { start: 12.3, end: 14.05 }, take: AUDIO, targetLabel: "phrase 2", phrases: [PHRASE], history: [], question: null });
  assertStringIncludes(parts(request)[0]?.text ?? "", "from 0:12.3 to 0:14.1");
});

Deno.test("buildRequest carries the conversation and the question", () => {
  const request = buildRequest({
    systemPrompt: "Coach.",
    reference: AUDIO,
    range: null,
    take: AUDIO,
    targetLabel: "phrase 2",
    phrases: [PHRASE],
    history: [{ role: "coach", text: "Lean into THINK." }],
    question: "Why?",
  });
  const all = parts(request).map((part) => part.text ?? "").join("\n");
  assertStringIncludes(all, "Coach: Lean into THINK.");
  assertStringIncludes(all, 'The learner asks: "Why?"');
});

Deno.test("parseReply reads a take verdict", () => {
  assertEquals(parseReply(gemini('{"verdict": "close", "reply": "Lean into THINK."}'), false), { verdict: "close", reply: "Lean into THINK." });
});

Deno.test("parseReply drops the verdict on questions and unknown values", () => {
  assertEquals(parseReply(gemini('{"verdict": "close", "reply": "Because."}'), true).verdict, null);
  assertEquals(parseReply(gemini('{"verdict": "great", "reply": "Nice."}'), false).verdict, null);
});

Deno.test("parseReply tolerates a code fence", () => {
  assertEquals(parseReply(gemini('```json\n{"verdict": "on_beat", "reply": "Spot on."}\n```'), false).reply, "Spot on.");
});

Deno.test("parseReply rejects unusable answers", () => {
  assertThrows(() => parseReply({ candidates: [] }, false));
  assertThrows(() => parseReply(gemini("not json"), false));
  assertThrows(() => parseReply(gemini('{"verdict": "close"}'), false));
});
