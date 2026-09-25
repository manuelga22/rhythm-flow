import { useEffect, useState } from "react";
import { ArrowRight, Check, LoaderCircle, Pause, Play } from "lucide-react";
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

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 900);
    return () => window.clearTimeout(timer);
  }, []);

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
        <h1 className="mt-3 font-display text-5xl leading-none">PRACTICE THE WHOLE CLIP OR ONE PHRASE.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">The arrows show where the voice rises or falls. Select any phrase to isolate it.</p>
      </div>

      <section className="mt-7 border-y border-ink/10 py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Structure</p>
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">↗ Rise · ↘ Fall</p>
        </div>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          {practicePhrases.map((phrase, index) => <span key={phrase.id}><AccentPhrase phrase={phrase} />{index < practicePhrases.length - 1 && <span className="mx-1.5 text-ink/25">|</span>}</span>)}
        </p>
      </section>

      <section className="mt-7">
        <div className="flex items-end justify-between gap-4">
          <div><p className="font-mono text-[10px] uppercase tracking-widest text-primary">Phrases</p><h2 className="mt-1 font-display text-3xl">8 BREATH UNITS</h2></div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">31 sec total</span>
        </div>

        <div className="mt-4 space-y-2">
          {practicePhrases.map((phrase) => {
            const selected = selectedPhrase?.id === phrase.id;
            const playing = playingPhrase === phrase.id;
            return (
              <div key={phrase.id} className={`grid grid-cols-[minmax(0,1fr)_44px] gap-2 rounded-2xl border p-3 transition-colors ${selected ? "border-primary bg-primary/5" : "border-ink/10 bg-card"}`}>
                <Button onClick={() => setSelectedPhrase(selected ? null : phrase)} variant="ghost" className="h-auto min-w-0 justify-start gap-3 whitespace-normal rounded-xl px-1 py-1 text-left hover:bg-transparent">
                  <span className={`grid size-7 shrink-0 place-items-center rounded-full font-mono text-[10px] ${selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{selected ? <Check className="size-4" /> : phrase.id}</span>
                  <span className="min-w-0">
                    <span className="block text-sm leading-relaxed"><AccentPhrase phrase={phrase} /></span>
                    <span className="mt-1 block font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{phrase.durationSeconds} sec{phrase.pauseMs ? ` · pause ${phrase.pauseMs} ms` : " · clip end"}</span>
                  </span>
                </Button>
                <Button onClick={() => setPlayingPhrase(playing ? null : phrase.id)} variant="outline" size="icon" aria-label={`${playing ? "Pause" : "Play"} phrase ${phrase.id}`} className="size-11 self-center rounded-full border-ink/15 bg-transparent shadow-none">
                  {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                </Button>
              </div>
            );
          })}
        </div>
      </section>

      <div className="sticky bottom-24 mt-6 rounded-2xl border border-ink/10 bg-card/95 p-3 shadow-lg backdrop-blur-md">
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Practice scope">
          <Button onClick={() => setSelectedPhrase(null)} variant={selectedPhrase ? "outline" : "default"} className="h-11 rounded-xl shadow-none">Full clip</Button>
          <Button onClick={() => {
            if (selectedPhrase) return;
            const firstPhrase = practicePhrases[0];
            if (firstPhrase) setSelectedPhrase(firstPhrase);
          }} variant={selectedPhrase ? "default" : "outline"} className="h-11 rounded-xl shadow-none">One phrase</Button>
        </div>
        <Button onClick={onContinue} className="mt-2 h-12 w-full rounded-xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">
          {selectedPhrase ? `Practice phrase ${selectedPhrase.id}` : "Practice full clip"} <ArrowRight />
        </Button>
      </div>
    </main>
  );
}