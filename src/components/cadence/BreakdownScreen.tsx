import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClipPlayer, type ClipSource } from "@/hooks/use-clip-player";
import type { AnalysisStatus } from "@/lib/analysis";
import { phraseTimeline, type PracticePhrase } from "./data";
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

export function BreakdownScreen({ status, error, title, phrases, clipSource, selectedPhrase, setSelectedPhrase, onBack, onContinue }: { status: AnalysisStatus | "idle"; error: string | null; title: string; phrases: PracticePhrase[]; clipSource: ClipSource; selectedPhrase: PracticePhrase | null; setSelectedPhrase: (phrase: PracticePhrase | null) => void; onBack: () => void; onContinue: () => void }) {
  const youtubeMount = useRef<HTMLDivElement | null>(null);
  // Hold the source back until the phrases (and the YouTube mount) render.
  const player = useClipPlayer(status === "ready" ? clipSource : null, youtubeMount);
  const phraseRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const timeline = phraseTimeline(phrases);
  const elapsed = player.currentTime;
  const totalSeconds = player.duration || (timeline.at(-1)?.end ?? 0);
  const clipPlaying = player.playing && !player.range;
  const canPlay = player.status === "ready";

  // A phrase stays active through the pause that follows it.
  let activePhrase = timeline[0]?.phrase;
  for (const entry of timeline) if (entry.start <= elapsed) activePhrase = entry.phrase;

  const playingEntry = player.playing && player.range ? timeline.find((entry) => entry.start === player.range?.start) : undefined;
  const playingPhrase = playingEntry?.phrase.id ?? null;

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

  useEffect(() => {
    if (!clipPlaying || !activePhrase) return;
    phraseRefs.current[activePhrase.id]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activePhrase, clipPlaying]);

  const selectedRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selectedPhrase) selectedRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedPhrase]);

  const toggleClip = () => (clipPlaying ? player.pause() : player.play());

  const togglePhrase = (id: number) => {
    const entry = timeline.find((item) => item.phrase.id === id);
    if (!entry) return;
    if (playingPhrase === id) player.pause();
    else player.playRange(entry.start, entry.end);
  };

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canPlay || !totalSeconds) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    player.seek(((event.clientX - bounds.left) / bounds.width) * totalSeconds);
  };

  const seekFromKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[event.key];
    if (!canPlay || step === undefined) return;
    event.preventDefault();
    player.seek(elapsed + step);
  };

  if (status === "failed" || (status === "ready" && phrases.length === 0)) {
    return (
      <main className="device-column grid min-h-[70vh] place-items-center px-5 pb-28 pt-6">
        <div className="text-center" role="alert">
          <CircleAlert className="mx-auto size-8 text-destructive" />
          <h1 className="mt-5 font-display text-4xl">COULDN'T READ THIS CLIP.</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error ?? "No speech was found in this clip."}</p>
          <Button onClick={onBack} variant="outline" className="mt-6 h-12 rounded-xl border-ink/15 bg-transparent shadow-none hover:bg-ink/5">
            <ArrowLeft /> Try another source
          </Button>
        </div>
      </main>
    );
  }

  if (status !== "ready") {
    return (
      <main className="device-column grid min-h-[70vh] place-items-center px-5 pb-28 pt-6">
        <div className="text-center" aria-live="polite">
          <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
          <h1 className="mt-5 font-display text-4xl">FINDING THE RHYTHM.</h1>
          <p className="mt-2 text-sm text-muted-foreground">Breaking the clip into phrases, pauses, and pitch movements. Longer clips can take a minute.</p>
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
        {clipSource?.kind === "youtube" && <div ref={youtubeMount} className="mb-4 aspect-video w-full overflow-hidden rounded-xl bg-background/10" />}
        <div className="flex items-center gap-3">
          <Button onClick={toggleClip} disabled={!canPlay} size="icon" aria-label={clipPlaying ? "Pause full clip" : "Play full clip"} className="size-12 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none hover:bg-primary/90">
            {player.status === "loading" ? <LoaderCircle className="size-5 animate-spin" /> : clipPlaying ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5 fill-current" />}
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><p className="font-mono text-[9px] uppercase tracking-widest text-background/50">Full reference</p><p className="truncate text-sm font-semibold">{title}</p></div>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-background/60">{formatTime(elapsed)} / {formatTime(totalSeconds)}</span>
            </div>
            <div
              role="slider"
              tabIndex={canPlay ? 0 : -1}
              aria-label="Seek full clip"
              aria-valuemin={0}
              aria-valuemax={Math.floor(totalSeconds)}
              aria-valuenow={Math.floor(elapsed)}
              aria-valuetext={`${formatTime(elapsed)} of ${formatTime(totalSeconds)}`}
              aria-disabled={!canPlay}
              onPointerDown={seekFromPointer}
              onKeyDown={seekFromKey}
              className={`-my-2 py-2 ${canPlay ? "cursor-pointer" : ""}`}
            >
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background/15">
                <div className="h-full rounded-full bg-primary" style={{ width: `${totalSeconds ? Math.min(100, (elapsed / totalSeconds) * 100) : 0}%` }} />
              </div>
            </div>
          </div>
        </div>
        <p className="mt-3 font-mono text-[9px] uppercase tracking-widest text-background/45">{player.status === "error" ? "Couldn't load this clip's audio" : playingPhrase ? `Playing phrase ${playingPhrase} only` : clipPlaying && activePhrase ? `Playing phrase ${activePhrase.id} of ${phrases.length}` : elapsed > 0 && elapsed < totalSeconds ? "Paused" : elapsed >= totalSeconds ? "Clip complete" : "Play the clip to follow each phrase"}</p>
      </section>

      <section className="mt-7 border-y border-ink/10 py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Structure</p>
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">↗ Rise · ↘ Fall</p>
        </div>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {phrases.map((phrase, index) => {
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
                {index < phrases.length - 1 && <span className="mx-1.5 text-ink/25">|</span>}
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
            <Button onClick={() => togglePhrase(selectedPhrase.id)} disabled={!canPlay} variant="outline" size="icon" aria-label={`${playingPhrase === selectedPhrase.id ? "Pause" : "Play"} reference for phrase ${selectedPhrase.id}`} className="size-9 shrink-0 rounded-full border-ink/15 bg-transparent shadow-none">
              {playingPhrase === selectedPhrase.id ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
          </div>
          <p className="mt-2 text-sm leading-7 text-foreground"><AccentPhrase phrase={selectedPhrase} /></p>
          <p className="mt-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{selectedPhrase.durationSeconds} sec{selectedPhrase.pauseMs ? ` · pause ${selectedPhrase.pauseMs} ms after` : " · clip end"}</p>
          <Button onClick={onContinue} className="mt-4 h-12 w-full rounded-xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">
            Practice phrase {selectedPhrase.id} <ArrowRight />
          </Button>
          <Button
            onClick={() => {
              setSelectedPhrase(null);
              onContinue();
            }}
            variant="outline"
            className="mt-2 h-12 w-full rounded-xl border-ink/15 bg-transparent shadow-none hover:bg-ink/5"
          >
            Practice the whole clip instead <ArrowRight />
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