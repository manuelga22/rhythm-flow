export type Stage = "source" | "breakdown" | "shadow" | "shadowFeedback" | "improvise" | "improvFeedback" | "complete";

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
 * the mocked ones are laid end to end with their pauses in between.
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

export const waveA = [36,62,43,88,55,29,72,47,94,58,34,77,52,85,43,65,31,76,48,91,54,37,70,44,82,40,68,33,73,49];
export const waveB = [42,70,39,91,61,35,79,50,96,64,40,81,55,89,49,71,34,72,52,87,60,41,75,48,78,45,63,37,69,54];

export const practicePhrases: PracticePhrase[] = [
  { id: 1, text: "Hey, Benny.", pauseMs: 820, durationSeconds: 2, structure: [{ text: "Hey, " }, { text: "Benny", accent: "down" }, { text: "." }] },
  { id: 2, text: "Do a flip.", pauseMs: 990, durationSeconds: 2, structure: [{ text: "Do a " }, { text: "flip", accent: "down" }, { text: "." }] },
  { id: 3, text: "So I said yes to every single email for an entire month again,", pauseMs: 180, durationSeconds: 7, structure: [{ text: "So I " }, { text: "said", accent: "up" }, { text: " yes to every single email for an entire " }, { text: "month", accent: "up" }, { text: " again," }] },
  { id: 4, text: "expecting a bunch of things to show up.", pauseMs: 1200, durationSeconds: 4, structure: [{ text: "expecting a bunch of " }, { text: "things", accent: "up" }, { text: " to show " }, { text: "up", accent: "down" }, { text: "." }] },
  { id: 5, text: "And it did.", pauseMs: 460, durationSeconds: 2, structure: [{ text: "And it " }, { text: "did", accent: "down" }, { text: "." }] },
  { id: 6, text: "But this is the coolest thing that showed up. This is the Benny camera robot.", pauseMs: 360, durationSeconds: 8, structure: [{ text: "But this is " }, { text: "the", accent: "up" }, { text: " coolest " }, { text: "thing", accent: "down" }, { text: " that showed up. This is the Benny camera robot." }] },
  { id: 7, text: "And that face right there has a camera.", pauseMs: 460, durationSeconds: 4, structure: [{ text: "And that " }, { text: "face", accent: "down" }, { text: " right there has a camera." }] },
  { id: 8, text: "So it's...", durationSeconds: 2, structure: [{ text: "So " }, { text: "it's", accent: "up" }, { text: "..." }] },
];

export const stepLabels = ["Source", "Structure", "Shadow", "Compare", "Improvise", "Complete"];
export const stageStep: Record<Stage, number> = { source: 0, breakdown: 1, shadow: 2, shadowFeedback: 3, improvise: 4, improvFeedback: 4, complete: 5 };
