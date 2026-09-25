import { ArrowRight, Mic, Pause, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { waveA, waveB } from "./data";
import type { PracticePhrase } from "./data";
import { BackButton, Waveform } from "./primitives";

export function RecordScreen({ kind, recording, seconds, playing, setPlaying, onRecord, onBack, onAnalyze, selectedPhrase }: { kind: "shadow" | "improvise"; recording: boolean; seconds: number; playing: "reference" | "you" | null; setPlaying: (value: "reference" | "you" | null) => void; onRecord: () => void; onBack: () => void; onAnalyze: () => void; selectedPhrase?: PracticePhrase | null }) {
  const isShadow = kind === "shadow";
  const hasTake = seconds > 0;
  const duration = isShadow ? selectedPhrase?.durationSeconds ?? 31 : 30;
  return (
    <main className="device-column px-5 pb-28 pt-5">
      <BackButton onClick={onBack} />
      <div className="mt-5 grid gap-5">
        <section className="animate-rise rounded-3xl bg-ink p-5 text-background">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5"><span className={`size-2.5 rounded-full ${recording ? "animate-record bg-primary" : "bg-background/30"}`} /><span className={`font-mono text-xs uppercase tracking-widest ${recording ? "text-primary" : "text-background/50"}`}>{recording ? "Recording" : hasTake ? "Take ready" : "Ready"}</span></div>
            <span className="font-mono text-lg tabular-nums">00:{String(seconds).padStart(2, "0")} / 00:{String(duration).padStart(2, "0")}</span>
          </div>
          <div className="mt-8">
            <Waveform bars={hasTake || recording ? waveA : waveA.map(() => 7)} tone="primary" tall />
            <div className="mt-3 flex justify-between font-mono text-[10px] uppercase tracking-widest text-background/40"><span>You</span><span>{isShadow ? "Match the reference" : "Explain it your way"}</span></div>
          </div>
          {isShadow ? (
            <div className="mt-8 rounded-xl border border-background/10 bg-background/5 p-4">
              <span className="font-mono text-[10px] uppercase tracking-widest text-background/50">{selectedPhrase ? `Phrase ${selectedPhrase.id} · selected practice` : "Full clip · bold words carry the beat"}</span>
              <p className="mt-2 text-lg leading-relaxed text-background/85">“{selectedPhrase ? selectedPhrase.structure.map((part, index) => part.accent ? <strong key={`${part.text}-${index}`} className="text-background">{part.text}<span className="ml-0.5 text-primary">{part.accent === "up" ? "↗" : "↘"}</span></strong> : part.text) : <>Hey, Benny. Do a flip. So I <strong className="text-background">said↗</strong> yes to every single email for an entire <strong className="text-background">month↗</strong> again...</>}</p>
            </div>
          ) : (
            <div className="mt-8 min-h-32 rounded-xl border border-dashed border-background/20 p-5 text-center">
              <X className="mx-auto size-5 text-background/40" /><p className="mt-3 font-display text-2xl">NO SCRIPT THIS TIME.</p><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-background/55">Explain the same idea in your own words. Keep the relaxed rhythm and let small words stay small.</p>
            </div>
          )}
          <div className="mt-7 flex flex-col items-center">
            <Button onClick={onRecord} aria-label={recording ? "Stop recording" : "Start recording"} className={`size-20 rounded-full border-4 border-background/15 p-0 shadow-none ${recording ? "bg-background text-foreground hover:bg-background/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>{recording ? <Pause className="size-7" /> : <Mic className="size-7" />}</Button>
            <span className="mt-3 font-mono text-[10px] uppercase tracking-widest text-background/50">{recording ? "Tap to stop" : hasTake ? "Tap to record again" : "Tap to record"}</span>
            {hasTake && !recording && <Button onClick={onAnalyze} className="mt-5 h-12 w-full rounded-2xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">See feedback <ArrowRight /></Button>}
          </div>
        </section>
        <aside className="space-y-5">
          <section className="rounded-3xl border border-ink/10 p-5">
             <p className="font-mono text-[10px] uppercase tracking-widest text-primary">{isShadow ? selectedPhrase ? `Phrase ${selectedPhrase.id} reference` : "Full clip reference" : "Idea to paraphrase"}</p>
             <h2 className="mt-2 font-display text-3xl">{isShadow ? "LISTEN FOR THE BEATS." : "KEEP THE MEANING."}</h2>
             <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{isShadow ? selectedPhrase?.text ?? "Practice all eight phrases in one continuous take. Keep the pauses and pitch movement you saw in the breakdown." : "Natural speech does not give every word equal weight; smaller words connect into the stronger ones."}</p>
            <Button onClick={() => setPlaying(playing === "reference" ? null : "reference")} variant="outline" className="mt-5 h-11 w-full rounded-xl border-ink/15 bg-transparent shadow-none"><Play className={playing === "reference" ? "fill-current" : ""} /> {playing === "reference" ? "Pause reference" : "Play reference"}</Button>
            <div className="mt-4"><Waveform bars={waveB} tone="ink" /></div>
          </section>
          <section className="rounded-3xl border border-accent/25 bg-accent/10 p-5"><p className="font-mono text-[10px] uppercase tracking-widest text-accent">Listen for</p><ul className="mt-3 space-y-2 text-sm"><li>Strong beats on <strong>natural, stress, small, next</strong></li><li>A short pause after <strong>speech</strong></li><li>A low, finished pitch on <strong>one</strong></li></ul></section>
        </aside>
      </div>
    </main>
  );
}
