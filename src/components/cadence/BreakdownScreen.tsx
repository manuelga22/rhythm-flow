import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { practicePhrases, type PracticePhrase } from "./data";
import { BackButton } from "./primitives";

function AccentPhrase({ phrase }: { phrase: PracticePhrase }) {
  return (
    <span>
      {phrase.structure.map((part, index) => part.accent ? (
        <strong key={`${part.text}-${index}`} className="font-semibold uppercase text-foreground">
          {part.text}<span className="ml-0.5 text-primary">{part.accent === "up" ? "↗" : "↘"}</span>
        </strong>
      ) : <span key={`${part.text}-${index}`}>{part.text}</span>)}
    </span>
  );
}

export function BreakdownScreen({ selectedPhrase, setSelectedPhrase, playingPhrase, setPlayingPhrase, onBack, onContinue }: { selectedPhrase: PracticePhrase | null; setSelectedPhrase: (phrase: PracticePhrase | null) => void; playingPhrase: number | null; setPlayingPhrase: (id: number | null) => void; onBack: () => void; onContinue: () => void }) {
  const [loading, setLoading] = useState(true);
  const [clipPlaying, setClipPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const phraseRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const totalSeconds = practicePhrases.reduce((total, phrase) => total + phrase.durationSeconds, 0);
  let phraseBoundary = 0;
  const activePhrase = practicePhrases.find((phrase) => {
    phraseBoundary += phrase.durationSeconds;
    return elapsed < phraseBoundary;
  }) ?? practicePhrases.at(-1);

  const formatTime = (seconds: number) => `0:${String(Math.floor(seconds)).padStart(2, "0")}`;

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 900);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!clipPlaying) return;
    const timer = window.setInterval(() => {
      setElapsed((current) => {
        const next = Math.min(current + 0.25, totalSeconds);
        if (next >= totalSeconds) setClipPlaying(false);
        return next;
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [clipPlaying, totalSeconds]);

  useEffect(() => {
    if (!clipPlaying || !activePhrase) return;
    phraseRefs.current[activePhrase.id]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activePhrase, clipPlaying]);

  const selectedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selectedPhrase) selectedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedPhrase]);

  const toggleClip = () => {
    setPlayingPhrase(null);
    if (elapsed >= totalSeconds) setElapsed(0);
    setClipPlaying((current) => !current);
  };

  const togglePhrase = (id: number) => {
    setClipPlaying(false);
    setPlayingPhrase(playingPhrase === id ? null : id);
  };

  if (loading) {
    return (
      <main className="device-column grid min-h-[70vh] place-items-center px-5 pb-28 pt-6">
        <div className="text-center" aria-live="polite">
          <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
          <h1 className="mt-5 font-display text-4xl">FINDING THE RHYTHM.</h1>
          <p className="mt-2 text-sm text-muted-foreground">Breaking the clip into phrases, pauses, and pitch movements.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="device-column px-5 pb-36 pt-6">
      <BackButton onClick={onBack} />
      <div className="mt-7 animate-rise">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">02 · Structure</p>
        <h1 className="mt-3 font-display text-4xl leading-none">PRACTICE THE WHOLE CLIP OR ONE PHRASE.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">The arrows show where the voice rises or falls. Select any phrase to isolate it.</p>
      </div>

      <section className="mt-7 rounded-2xl bg-ink p-4 text-background">
        <div className="flex items-center gap-3">
          <Button onClick={toggleClip} size="icon" aria-label={clipPlaying ? "Pause full clip" : "Play full clip"} className="size-12 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none hover:bg-primary/90">
            {clipPlaying ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5 fill-current" />}
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="font-mono text-[9px] uppercase tracking-widest text-background/50">Full reference</p><p className="truncate text-sm font-semibold">The Benny camera robot</p></div>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-background/60">{formatTime(elapsed)} / {formatTime(totalSeconds)}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background/15" role="progressbar" aria-label="Full clip playback progress" aria-valuemin={0} aria-valuemax={totalSeconds} aria-valuenow={Math.floor(elapsed)}>
              <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${(elapsed / totalSeconds) * 100}%` }} />
            </div>
          </div>
        </div>
        <p className="mt-3 font-mono text-[9px] uppercase tracking-widest text-background/45">{clipPlaying && activePhrase ? `Playing phrase ${activePhrase.id} of ${practicePhrases.length}` : elapsed > 0 && elapsed < totalSeconds ? "Paused" : elapsed >= totalSeconds ? "Clip complete" : "Play the clip to follow each phrase"}</p>
      </section>

      <section className="mt-7 border-y border-ink/10 py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Structure</p>
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">↗ Rise · ↘ Fall</p>
        </div>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {practicePhrases.map((phrase, index) => {
            const selected = selectedPhrase?.id === phrase.id;
            const active = clipPlaying && activePhrase?.id === phrase.id;
            return (
              <button
                key={phrase.id}
                ref={(element) => { phraseRefs.current[phrase.id] = element; }}
                onClick={() => setSelectedPhrase(selected ? null : phrase)}
                aria-pressed={selected}
                aria-label={`${selected ? "Deselect" : "Select"} phrase ${phrase.id}: ${phrase.text}`}
                className={`rounded px-0.5 py-0.5 text-left transition-colors ${active ? "bg-primary/15 text-foreground" : "hover:bg-ink/5"} ${selected ? "bg-primary/20 ring-1 ring-primary/40" : ""}`}
              >
                <AccentPhrase phrase={phrase} />
                {index < practicePhrases.length - 1 && <span className="mx-1.5 text-ink/25">|</span>}
              </button>
            );
          })}
        </p>
        <p className="mt-3 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Tap any phrase to practice it on its own.</p>
      </section>

      {selectedPhrase && (
        <section ref={selectedRef} className="mt-5 animate-rise rounded-2xl border border-primary/30 bg-primary/5 p-4" aria-live="polite">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-widest text-primary">Phrase {selectedPhrase.id} selected</p>
            <Button onClick={() => togglePhrase(selectedPhrase.id)} variant="outline" size="icon" aria-label={`${playingPhrase === selectedPhrase.id ? "Pause" : "Play"} reference for phrase ${selectedPhrase.id}`} className="size-9 shrink-0 rounded-full border-ink/15 bg-transparent shadow-none">
              {playingPhrase === selectedPhrase.id ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
          </div>
          <p className="mt-2 text-sm leading-7 text-foreground"><AccentPhrase phrase={selectedPhrase} /></p>
          <p className="mt-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{selectedPhrase.durationSeconds} sec{selectedPhrase.pauseMs ? ` · pause ${selectedPhrase.pauseMs} ms after` : " · clip end"}</p>
          <Button onClick={onContinue} className="mt-4 h-12 w-full rounded-xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">
            Practice phrase {selectedPhrase.id} <ArrowRight />
          </Button>
        </section>
      )}

      {!selectedPhrase && (
        <div className="mt-6 rounded-2xl border border-ink/10 bg-card p-3">
          <Button onClick={onContinue} className="h-12 w-full rounded-xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">
            Practice full clip <ArrowRight />
          </Button>
        </div>
      )}
    </main>
  );
}