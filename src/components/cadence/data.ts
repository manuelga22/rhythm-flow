export type Stage = "source" | "breakdown" | "improvise" | "improvFeedback" | "complete";

export type AccentDirection = "up" | "down";

export type PhrasePart = {
  text: string;
  accent?: AccentDirection;
};

export type PracticePhrase = {
  id: number;
  text: string;
  pauseMs?: number;
  durationSeconds: number;
  /** Seconds from the start of the clip; present on analysed phrases. */
  start?: number;
  end?: number;
  structure: PhrasePart[];
};

export type TimedPhrase = { phrase: PracticePhrase; start: number; end: number };

/**
 * Where each phrase sits in the clip. Analysed phrases carry real times;
 * phrases without them are laid end to end with their pauses in between.
 */
export function phraseTimeline(phrases: PracticePhrase[]): TimedPhrase[] {
  let cursor = 0;
  return phrases.map((phrase) => {
    const start = phrase.start ?? cursor;
    const end = phrase.end ?? start + phrase.durationSeconds;
    cursor = end + (phrase.pauseMs ?? 0) / 1000;
    return { phrase, start, end };
  });
}

/** What a practice target is called: one phrase, or the full clip when null. */
export const targetLabel = (phrase: PracticePhrase | null) => (phrase ? `Phrase ${String(phrase.id).padStart(2, "0")}` : "Full clip");

/** mm:ss, e.g. 00:07 or 01:15. */
export function formatTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

export const waveA = [36,62,43,88,55,29,72,47,94,58,34,77,52,85,43,65,31,76,48,91,54,37,70,44,82,40,68,33,73,49];
export const waveB = [42,70,39,91,61,35,79,50,96,64,40,81,55,89,49,71,34,72,52,87,60,41,75,48,78,45,63,37,69,54];

export const stepLabels = ["Source", "Practice", "Improvise", "Complete"];
export const stageStep: Record<Stage, number> = { source: 0, breakdown: 1, improvise: 2, improvFeedback: 2, complete: 3 };
