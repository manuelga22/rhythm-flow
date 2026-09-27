import { useEffect, useState } from "react";
import { LoaderCircle, TriangleAlert } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import type { SourceType } from "@/lib/analysis";
import { formatTime } from "./data";

// Rough time each source takes to be ready. The worker reports no progress,
// so the bar eases toward 95% over this and only fills once the clip is ready.
const EXPECTED_SECONDS: Record<SourceType, number> = { upload: 25, youtube: 45, generated: 60 };
const PHRASE_MS = 10_000;

const SHARED = [
  "Listening for every word…",
  "Finding the stressed beats…",
  "Measuring the pauses between phrases…",
  "Tracing where the pitch rises and falls…",
  "Grouping words into phrases…",
  "Tip: English stresses the content words and squeezes the rest.",
  "Tip: pauses are part of the rhythm, not gaps in it.",
  "Tip: a falling pitch usually means a thought is finished.",
];

const PHRASES: Record<SourceType, string[]> = {
  youtube: ["Fetching the audio from YouTube…", "Turning the video into clean audio…", ...SHARED],
  upload: ["Reading your recording…", ...SHARED],
  generated: [
    "Picking a famous movie scene…",
    "Writing an original monologue…",
    "Choosing a voice that fits the speaker…",
    "ElevenLabs is recording the voice…",
    ...SHARED,
  ],
};

const TITLE: Record<SourceType, string> = { youtube: "FINDING THE RHYTHM.", upload: "FINDING THE RHYTHM.", generated: "WRITING YOUR SCENE." };

/** Any phrase of `pool` but `current`, so the text always visibly changes. */
function nextPhrase(pool: string[], current: string): string {
  const choices = pool.filter((phrase) => phrase !== current);
  return choices[Math.floor(Math.random() * choices.length)] ?? current;
}

/** Shown while a new clip is prepared: an estimated progress bar, a new phrase every 10 s and a reminder to stay. */
export function ProcessingScreen({ kind, startedAt }: { kind: SourceType; startedAt: number }) {
  const pool = PHRASES[kind];
  const [now, setNow] = useState(() => Date.now());
  // Every kind opens on its first phrase, which describes the first step.
  const [phrase, setPhrase] = useState<string>(pool[0] ?? "");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setPhrase(pool[0] ?? "");
    const timer = window.setInterval(() => setPhrase((current) => nextPhrase(pool, current)), PHRASE_MS);
    return () => window.clearInterval(timer);
  }, [pool]);

  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const progress = 95 * (1 - Math.exp(-elapsed / EXPECTED_SECONDS[kind]));

  return (
    <main className="device-column grid min-h-[70vh] place-items-center px-5 pb-28 pt-6">
      <div className="w-full max-w-md text-center">
        <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
        <h1 className="mt-5 font-display text-4xl">{TITLE[kind]}</h1>

        <div className="mt-6">
          <Progress value={progress} aria-label="Preparing your clip" className="h-2.5" />
          <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            <span>{elapsed > EXPECTED_SECONDS[kind] * 2 ? "Almost there" : "Working"}</span>
            <span className="tabular-nums">{formatTime(elapsed)}</span>
          </div>
        </div>

        <p aria-live="polite" className="mt-5 flex min-h-12 items-center justify-center text-sm text-muted-foreground">
          <span key={phrase} className="animate-in fade-in duration-500">{phrase}</span>
        </p>

        <div role="status" className="mt-6 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 text-left">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
          <p className="text-sm leading-relaxed">
            <strong className="font-semibold">Keep this screen open.</strong>{" "}
            <span className="text-muted-foreground">Your clip is still being prepared. If you leave or refresh now, you'll have to start over.</span>
          </p>
        </div>
      </div>
    </main>
  );
}
