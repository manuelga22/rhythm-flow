import { useCallback, useEffect, useRef, useState } from "react";
import type { Take } from "@/hooks/use-recorder";
import { askCoach, CoachError, type CoachTurn, type CoachVerdict } from "@/lib/coach";
import { blobToBase64, encodeWav16k } from "@/lib/wav";

export type CoachTake = Pick<Take, "blob" | "duration" | "peaks"> & {
  /** Owned by the coach, independent of the recorder's own URL. */
  url: string;
};

export type CoachMessage =
  | { id: string; role: "you"; kind: "take"; take: CoachTake; number: number; breakdown: boolean }
  | { id: string; role: "you"; kind: "text"; text: string }
  | {
      id: string;
      role: "coach";
      /** The take this reply is about. */
      takeId: string;
      /** Null when the reply is quick feedback on the take. */
      question: string | null;
      status: "pending" | "done" | "error";
      verdict: CoachVerdict | null;
      text: string;
    };

const ENABLED_KEY = "rhythmflow.coach.enabled";
const HISTORY_TURNS = 10;

const threadKey = (phraseId: number | null) => String(phraseId ?? "full");

/** The newest take in a thread, the one follow-up questions are about. */
export function latestTake(messages: CoachMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "you" && message.kind === "take") return message;
  }
  return undefined;
}

function revokeTakes(threads: Record<string, CoachMessage[]>) {
  for (const messages of Object.values(threads)) {
    for (const message of messages) if (message.role === "you" && message.kind === "take") URL.revokeObjectURL(message.take.url);
  }
}

function readEnabled() {
  try {
    return window.localStorage.getItem(ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * The AI coach's conversation for one clip: a thread per practice target
 * (a phrase, or the full clip). Each take gets quick feedback, and the
 * learner can ask follow-up questions about their latest take. Kept for the
 * visit only.
 */
export function useCoach(analysisId: string | undefined) {
  const [threads, setThreads] = useState<Record<string, CoachMessage[]>>({});
  // Mirrors `threads` for async work that must see the latest messages.
  const threadsRef = useRef(threads);
  const [enabled, setEnabledState] = useState(true);
  // Set when this clip has no reference audio the coach can hear.
  const [unavailable, setUnavailable] = useState<string | null>(null);
  // Take message id -> base64 WAV, so follow-ups resend the take without re-encoding it.
  const wavs = useRef(new Map<string, Promise<string>>());
  const counter = useRef(0);

  useEffect(() => setEnabledState(readEnabled()), []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try {
      window.localStorage.setItem(ENABLED_KEY, value ? "on" : "off");
    } catch {
      // Private mode: the choice lasts for this visit.
    }
  }, []);

  const update = useCallback((key: string, change: (messages: CoachMessage[]) => CoachMessage[]) => {
    const next = { ...threadsRef.current, [key]: change(threadsRef.current[key] ?? []) };
    threadsRef.current = next;
    setThreads(next);
  }, []);

  const patchReply = useCallback(
    (key: string, id: string, patch: Partial<Extract<CoachMessage, { role: "coach" }>>) => {
      update(key, (messages) => messages.map((message) => (message.id === id && message.role === "coach" ? { ...message, ...patch } : message)));
    },
    [update],
  );

  // A new clip starts a new conversation; its takes' audio is released.
  useEffect(() => {
    revokeTakes(threadsRef.current);
    threadsRef.current = {};
    setThreads({});
    setUnavailable(null);
    wavs.current.clear();
  }, [analysisId]);

  useEffect(() => () => revokeTakes(threadsRef.current), []);

  const nextId = () => {
    counter.current += 1;
    return `coach-${counter.current}`;
  };

  const run = useCallback(
    async (phraseId: number | null, replyId: string) => {
      const key = threadKey(phraseId);
      const messages = threadsRef.current[key] ?? [];
      const index = messages.findIndex((message) => message.id === replyId);
      const reply = messages[index];
      if (!analysisId || !reply || reply.role !== "coach") return;
      patchReply(key, replyId, { status: "pending", text: "" });

      // Earlier turns as text; the model hears only the take this reply is about.
      const history: CoachTurn[] = messages
        .slice(0, index)
        .flatMap((message): CoachTurn[] => {
          if (message.role === "coach") return message.status === "done" ? [{ role: "coach", text: message.text }] : [];
          return [{ role: "you", text: message.kind === "text" ? message.text : `(recorded take ${message.number})` }];
        })
        // A question's own text is sent as the question.
        .filter((turn, position, all) => !(reply.question && position === all.length - 1 && turn.role === "you" && turn.text === reply.question))
        .slice(-HISTORY_TURNS);

      try {
        const wav = wavs.current.get(reply.takeId);
        if (!wav) throw new CoachError("That take is no longer available. Record a new one.", "missing_take");
        const answer = await askCoach({ analysisId, phraseId, wavBase64: await wav, history, question: reply.question });
        patchReply(key, replyId, { status: "done", verdict: answer.verdict, text: answer.reply });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The coach couldn't answer just now. Try again.";
        if (error instanceof CoachError && error.code === "no_reference") setUnavailable(message);
        patchReply(key, replyId, { status: "error", text: message });
      }
    },
    [analysisId, patchReply],
  );

  /** Hand a finished take to the coach for quick feedback. */
  const sendTake = useCallback(
    (take: Take, phraseId: number | null) => {
      const key = threadKey(phraseId);
      const takeId = nextId();
      const replyId = nextId();
      const number = (threadsRef.current[key] ?? []).filter((message) => message.role === "you" && message.kind === "take").length + 1;
      const wav = encodeWav16k(take.blob).then(blobToBase64);
      // Surfaces as the reply's error; don't leave an unhandled rejection meanwhile.
      wav.catch(() => {});
      wavs.current.set(takeId, wav);
      update(key, (messages) => [
        ...messages,
        { id: takeId, role: "you", kind: "take", number, breakdown: false, take: { blob: take.blob, duration: take.duration, peaks: take.peaks, url: URL.createObjectURL(take.blob) } },
        { id: replyId, role: "coach", takeId, question: null, status: "pending", verdict: null, text: "" },
      ]);
      void run(phraseId, replyId);
    },
    [run, update],
  );

  /** Ask about the latest take for this target. */
  const ask = useCallback(
    (question: string, phraseId: number | null) => {
      const key = threadKey(phraseId);
      const latest = latestTake(threadsRef.current[key] ?? []);
      const text = question.trim();
      if (!latest || !text) return;
      const replyId = nextId();
      update(key, (messages) => [...messages, { id: nextId(), role: "you", kind: "text", text }, { id: replyId, role: "coach", takeId: latest.id, question: text, status: "pending", verdict: null, text: "" }]);
      void run(phraseId, replyId);
    },
    [run, update],
  );

  const retry = useCallback((replyId: string, phraseId: number | null) => void run(phraseId, replyId), [run]);

  /** Record that a take was sent for the full breakdown, so it isn't sent twice. */
  const markBreakdown = useCallback(
    (takeId: string, phraseId: number | null) => {
      update(threadKey(phraseId), (messages) => messages.map((message) => (message.id === takeId && message.role === "you" && message.kind === "take" ? { ...message, breakdown: true } : message)));
    },
    [update],
  );

  return {
    enabled,
    setEnabled,
    unavailable,
    threadFor: (phraseId: number | null) => threads[threadKey(phraseId)] ?? [],
    sendTake,
    ask,
    retry,
    markBreakdown,
  };
}
