import { useState } from "react";
import { ArrowRight, Eye, EyeOff, Mic, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { waveA } from "./data";
import type { PracticePhrase } from "./data";
import { BackButton, Waveform } from "./primitives";

export function RecordScreen({ kind, recording, seconds, onRecord, onBack, onAnalyze, selectedPhrase }: { kind: "shadow" | "improvise"; recording: boolean; seconds: number; onRecord: () => void; onBack: () => void; onAnalyze: () => void; selectedPhrase?: PracticePhrase | null }) {
  const isShadow = kind === "shadow";
  const hasTake = seconds > 0;
  const duration = isShadow ? selectedPhrase?.durationSeconds ?? 31 : 30;
  const [showTranscript, setShowTranscript] = useState(true);
  return (
    <main className="device-column px-5 pb-28 pt-5">
      <BackButton onClick={onBack} />
      <section className="animate-rise mt-5 rounded-3xl bg-ink p-5 text-background">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5"><span className={`size-2.5 rounded-full ${recording ? "animate-record bg-primary" : "bg-background/30"}`} /><span className={`font-mono text-xs uppercase tracking-widest ${recording ? "text-primary" : "text-background/50"}`}>{recording ? "Recording" : hasTake ? "Take ready" : "Ready"}</span></div>
          <span className="font-mono text-lg tabular-nums">00:{String(seconds).padStart(2, "0")} / 00:{String(duration).padStart(2, "0")}</span>
        </div>
        <div className="mt-6 flex flex-col items-center">
          <Button onClick={onRecord} aria-label={recording ? "Stop recording" : "Start recording"} className={`size-20 rounded-full border-4 border-background/15 p-0 shadow-none ${recording ? "bg-background text-foreground hover:bg-background/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>{recording ? <Pause className="size-7" /> : <Mic className="size-7" />}</Button>
          <span className="mt-3 font-mono text-[10px] uppercase tracking-widest text-background/50">{recording ? "Tap to stop" : hasTake ? "Tap to record again" : "Tap to record"}</span>
        </div>
        <div className="mt-6">
          <Waveform bars={hasTake || recording ? waveA : waveA.map(() => 7)} tone="primary" tall />
          <div className="mt-3 flex justify-between font-mono text-[10px] uppercase tracking-widest text-background/40"><span>You</span><span>{isShadow ? "Match the reference" : "Explain it your way"}</span></div>
        </div>
        {isShadow && showTranscript && (
          <div className="mt-6 rounded-xl border border-background/10 bg-background/5 p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-background/50">{selectedPhrase ? `Phrase ${selectedPhrase.id} · selected practice` : "Full clip · bold words carry the beat"}</span>
            <p className="mt-2 text-lg leading-relaxed text-background/85">“{selectedPhrase ? selectedPhrase.structure.map((part, index) => part.accent ? <strong key={`${part.text}-${index}`} className="text-background">{part.text}<span className="ml-0.5 text-primary">{part.accent === "up" ? "↗" : "↘"}</span></strong> : part.text) : <>Hey, Benny. Do a flip. So I <strong className="text-background">said↗</strong> yes to every single email for an entire <strong className="text-background">month↗</strong> again...</>}</p>
          </div>
        )}
        {hasTake && !recording && <Button onClick={onAnalyze} className="mt-6 h-12 w-full rounded-2xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">See feedback <ArrowRight /></Button>}
      </section>
      {isShadow ? (
        <Button onClick={() => setShowTranscript((value) => !value)} variant="outline" aria-pressed={showTranscript} className="mt-4 h-11 w-full rounded-xl border-ink/15 bg-transparent shadow-none">
          {showTranscript ? <EyeOff /> : <Eye />} {showTranscript ? "Hide structure" : "Show structure"}
        </Button>
      ) : (
        <div className="mt-5 min-h-32 rounded-xl border border-dashed border-ink/20 p-5 text-center">
          <p className="font-display text-2xl">NO SCRIPT THIS TIME.</p><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Explain the same idea in your own words. Keep the relaxed rhythm and let small words stay small.</p>
        </div>
      )}
    </main>
  );
}
