import { useRef, useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AudioButton, Waveform } from "./primitives";
import { formatTime } from "./data";
import type { TakeAudio } from "./RecordScreen";

export function ShadowReviewScreen({ take, onRetry, onContinue }: { take: TakeAudio | null; onRetry: () => void; onContinue: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };
  const leave = (next: () => void) => () => { audioRef.current?.pause(); next(); };

  return (
    <main className="device-column px-5 pb-28 pt-5">
      <section className="animate-rise rounded-3xl bg-ink p-5 text-background">
        <p className="font-mono text-[10px] uppercase tracking-widest text-primary">Shadow take</p>
        <h1 className="mt-2 font-display text-4xl leading-none">{take ? "TAKE SAVED." : "NO TAKE YET."}</h1>
        <p className="mt-3 text-sm leading-relaxed text-background/70">
          {take ? "Automated rhythm feedback is on the way. For now, listen back and compare it with the reference yourself." : "Record a take on the previous step to review it here."}
        </p>
        {take && (
          <div className="mt-6">
            <audio ref={audioRef} src={take.url} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="hidden" />
            <div className="flex items-center justify-between">
              <AudioButton label="Your take" active={playing} onClick={toggle} />
              <span className="font-mono text-xs tabular-nums text-background/60">{formatTime(take.duration)}</span>
            </div>
            <div className="mt-4"><Waveform bars={take.peaks} tone="primary" /></div>
          </div>
        )}
        <div className="mt-6 grid grid-cols-[auto_1fr] gap-3">
          <Button onClick={leave(onRetry)} variant="outline" aria-label="Try again" className="size-12 rounded-2xl border-background/20 bg-transparent p-0 text-background shadow-none hover:bg-background/10 hover:text-background"><RotateCcw /></Button>
          <Button onClick={leave(onContinue)} className="h-12 rounded-2xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">Improvise the idea <ArrowRight /></Button>
        </div>
      </section>
    </main>
  );
}
