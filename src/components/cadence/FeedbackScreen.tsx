import { ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { waveA, waveB } from "./data";
import { AudioButton, DataRow, Metric, Timeline } from "./primitives";

export function FeedbackScreen({ kind, playing, setPlaying, onRetry, onContinue }: { kind: "shadow" | "improvise"; playing: "reference" | "you" | null; setPlaying: (value: "reference" | "you" | null) => void; onRetry: () => void; onContinue: () => void }) {
  const improv = kind === "improvise";
  const score = improv ? 78 : 82;
  return (
    <main className="device-column px-5 pb-28 pt-5">
      <div className="grid grid-cols-3 gap-3">
        <Metric label={improv ? "Natural rhythm" : "Rhythm match"} value={String(score)} suffix="/100" dark />
        <Metric label="Stress timing" value={improv ? "76" : "84"} suffix="%" accent />
        <Metric label="Intonation" value={improv ? "81" : "73"} suffix="%" caution />
      </div>
      <div className="mt-5 grid gap-5">
        <section className="animate-rise rounded-3xl bg-ink p-5 text-background">
          <div><p className="font-mono text-[10px] uppercase tracking-widest text-primary">{improv ? "Spontaneous speech" : "Reference comparison"}</p><h1 className="mt-2 font-display text-4xl leading-none">{improv ? "THE RHYTHM HELD." : "CLOSE. NOW SHAPE IT."}</h1><div className="mt-4 flex gap-2"><AudioButton label="Reference" active={playing === "reference"} onClick={() => setPlaying(playing === "reference" ? null : "reference")} /><AudioButton label="You" active={playing === "you"} onClick={() => setPlaying(playing === "you" ? null : "you")} /></div></div>
          <div className="mt-8 space-y-5">
            <Timeline label="REF" bars={waveB} tone="light" markers={["natural", "stress", "small", "next"]} />
            <Timeline label="YOU" bars={waveA} tone="primary" markers={improv ? ["usually", "emphasize", "meaning", "connect"] : ["natural", "stress", "small", "next"]} />
          </div>
          <div className="mt-7 rounded-xl border border-background/10 bg-background/5 p-4">
            <div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-widest text-background/50">{improv ? "Your transcript" : "Stress map"}</span><span className="font-mono text-[10px] text-background/40">● stress · ↗ rise · ↘ fall</span></div>
            <p className="mt-3 text-base leading-8 text-background/80">{improv ? <>“Usually we <strong className="text-caution">emphasize</strong> the words that carry the <strong>meaning</strong>, and the rest can <span className="text-accent underline underline-offset-4">connect together</span> more easily.” <span className="text-primary">↘</span></> : <>“That's the thing about <strong>natural speech</strong> — we don't <span className="rounded bg-caution/20 px-1 text-caution">stress every word</span>. We let the <strong>small words</strong> <span className="text-accent underline underline-offset-4">slip into</span> the next one. <span className="text-primary">↘</span>”</>}</p>
          </div>
          <div className="mt-6 grid grid-cols-[auto_1fr] gap-3"><Button onClick={onRetry} variant="outline" aria-label="Try again" className="size-12 rounded-2xl border-background/20 bg-transparent p-0 text-background shadow-none hover:bg-background/10 hover:text-background"><RotateCcw /></Button><Button onClick={onContinue} className="h-12 rounded-2xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">{improv ? "Complete session" : "Improvise the idea"} <ArrowRight /></Button></div>
        </section>
        <aside className="space-y-5">
          <section className="rounded-3xl border border-ink/10 p-5"><div className="flex items-center gap-2"><span className="font-mono text-xs text-primary">03</span><h2 className="font-display text-3xl">COACHING</h2></div><ol className="mt-5 space-y-5">
            {(improv ? [
              ["Keep", "the relaxed pace you found in the middle phrase — it sounded conversational."],
              ["Reduce", "“the words that” a little more so “carry the meaning” becomes the clear focus."],
              ["Finish", "with the same confident pitch drop you used in the reference."],
            ] : [
              ["Soften", "“every” — it received more weight than the reference and slowed the phrase."],
              ["Link", "“slip into” as one breath unit, with no reset before “into.”"],
              ["Fall", "after “one” — close the thought with a lower, steadier pitch."],
            ]).map(([lead, copy], index) => <li key={lead} className="flex gap-3"><span className={`mt-0.5 font-mono text-xs ${index === 0 ? "text-caution" : index === 1 ? "text-accent" : "text-primary"}`}>{index + 1}</span><p className="text-sm leading-relaxed"><strong>{lead}</strong> {copy}</p></li>)}
          </ol></section>
          <section className="rounded-3xl border border-ink/10 p-5"><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Timing notes</p><div className="mt-4 space-y-3 text-sm"><DataRow label="Speech rate" value={improv ? "146 wpm" : "151 wpm"} /><DataRow label="Longest pause" value={improv ? "0.5 sec" : "0.7 sec"} /><DataRow label="Pitch range" value={improv ? "118 Hz" : "104 Hz"} /></div></section>
        </aside>
      </div>
    </main>
  );
}
