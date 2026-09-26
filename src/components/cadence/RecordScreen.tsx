import { useEffect, useRef, useState } from "react";
import { ArrowRight, Eye, EyeOff, Mic, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime, waveA } from "./data";
import type { PracticePhrase } from "./data";
import { BackButton, Waveform } from "./primitives";

export type TakeAudio = { url: string; duration: number; peaks: number[] };

/**
 * Pass `take` (even as null) to record from the microphone: `levels` drive the
 * live waveform and the take plays back for real. Without it the screen runs
 * on the simulated timer the improvise step still uses.
 */
export function RecordScreen({ kind, recording, seconds, onRecord, onBack, onAnalyze, phrases = [], selectedPhrase, take, levels, error, busy }: { kind: "shadow" | "improvise"; recording: boolean; seconds: number; onRecord: () => void; onBack: () => void; onAnalyze: () => void; phrases?: PracticePhrase[]; selectedPhrase?: PracticePhrase | null; take?: TakeAudio | null; levels?: number[]; error?: string | null; busy?: boolean }) {
  const isShadow = kind === "shadow";
  const live = take !== undefined;
  const hasTake = live ? Boolean(take) : seconds > 0;
  const takeSeconds = live ? (take?.duration ?? 0) : seconds;
  const targetPhrases = selectedPhrase ? [selectedPhrase] : phrases;
  const duration = isShadow ? Math.ceil(targetPhrases.reduce((total, phrase) => total + phrase.durationSeconds, 0)) : 30;
  const transcriptParts = targetPhrases.flatMap((phrase, index) => (index ? [{ text: " " }, ...phrase.structure] : phrase.structure));
  const [showTranscript, setShowTranscript] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playPos, setPlayPos] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => { if (recording) { audioRef.current?.pause(); setPlaying(false); setPlayPos(0); } }, [recording]);
  useEffect(() => {
    if (live || !playing) return;
    const id = window.setInterval(() => {
      setPlayPos((p) => {
        const next = p + 0.25;
        if (next >= seconds) { setPlaying(false); return seconds; }
        return next;
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [live, playing, seconds]);
  const togglePlayback = () => {
    const audio = audioRef.current;
    if (live) {
      if (!audio) return;
      if (audio.paused) void audio.play().catch(() => setPlaying(false));
      else audio.pause();
      return;
    }
    if (!playing && playPos >= seconds) setPlayPos(0);
    setPlaying((v) => !v);
  };
  const liveBars = recording ? levels : take?.peaks;
  const bars = live ? (liveBars ?? waveA.map(() => 7)) : hasTake || recording ? waveA : waveA.map(() => 7);
  return (
    <main className="device-column px-5 pb-28 pt-5">
      <BackButton onClick={onBack} />
      <section className="animate-rise mt-5 rounded-3xl bg-ink p-5 text-background">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5"><span className={`size-2.5 rounded-full ${recording ? "animate-record bg-primary" : "bg-background/30"}`} /><span className={`font-mono text-xs uppercase tracking-widest ${recording ? "text-primary" : "text-background/50"}`}>{recording ? "Recording" : hasTake ? "Take ready" : "Ready"}</span></div>
          <span className="font-mono text-lg tabular-nums">{formatTime(seconds)} / {formatTime(duration)}</span>
        </div>
        <div className="mt-6 flex flex-col items-center">
          <Button onClick={onRecord} disabled={busy} aria-label={recording ? "Stop recording" : "Start recording"} className={`size-20 rounded-full border-4 border-background/15 p-0 shadow-none ${recording ? "bg-background text-foreground hover:bg-background/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>{recording ? <Pause className="size-7" /> : <Mic className="size-7" />}</Button>
          <span className="mt-3 font-mono text-[10px] uppercase tracking-widest text-background/50">{busy ? "Waiting for microphone" : recording ? "Tap to stop" : hasTake ? "Tap to record again" : "Tap to record"}</span>
          {error && <p role="alert" className="mt-3 max-w-xs text-center text-sm text-caution">{error}</p>}
        </div>
        <div className="mt-6">
          <Waveform bars={bars} tone="primary" tall />
          <div className="mt-3 flex justify-between font-mono text-[10px] uppercase tracking-widest text-background/40"><span>You</span><span>{isShadow ? "Match the reference" : "Explain it your way"}</span></div>
        </div>
        {isShadow && showTranscript && (
          <div className="mt-6 rounded-xl border border-background/10 bg-background/5 p-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-background/50">{selectedPhrase ? `Phrase ${selectedPhrase.id} · selected practice` : "Full clip · bold words carry the beat"}</span>
            <p className="mt-2 text-lg leading-relaxed text-background/85">“{transcriptParts.map((part, index) => part.accent ? <strong key={`${part.text}-${index}`} className="text-background">{part.text}<span className="ml-0.5 text-primary">{part.accent === "up" ? "↗" : "↘"}</span></strong> : part.text)}”</p>
          </div>
        )}
        {hasTake && !recording && (
          <div className="mt-6 space-y-3">
            {live && take && <audio ref={audioRef} src={take.url} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPlayPos(take.duration); }} onTimeUpdate={(event) => setPlayPos(event.currentTarget.currentTime)} className="hidden" />}
            <div className="flex items-center gap-3 rounded-xl border border-background/10 bg-background/5 p-3">
              <button type="button" onClick={togglePlayback} aria-label={playing ? "Pause your recording" : "Play your recording"} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background text-foreground">{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
              <div className="min-w-0 flex-1">
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest text-background/50"><span>Your take</span><span className="tabular-nums">{formatTime(playPos)} / {formatTime(takeSeconds)}</span></div>
                <div role="progressbar" aria-valuemin={0} aria-valuemax={Math.ceil(takeSeconds)} aria-valuenow={Math.floor(playPos)} className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/15"><div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${takeSeconds ? Math.min(100, (playPos / takeSeconds) * 100) : 0}%` }} /></div>
              </div>
            </div>
            <Button onClick={() => { audioRef.current?.pause(); setPlaying(false); onAnalyze(); }} className="h-12 w-full rounded-2xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">{live ? "Submit for review" : "Get feedback"} <ArrowRight /></Button>
          </div>
        )}
      </section>
      {isShadow ? (
        <Button onClick={() => setShowTranscript((value) => !value)} variant="outline" aria-pressed={showTranscript} className="mt-4 h-11 w-full rounded-xl border-ink/15 bg-transparent shadow-none">
           {showTranscript ? <EyeOff /> : <Eye />} {showTranscript ? "Hide transcript" : "Show transcript"}
        </Button>
      ) : (
        <div className="mt-5 min-h-32 rounded-xl border border-dashed border-ink/20 p-5 text-center">
          <p className="font-display text-2xl">NO SCRIPT THIS TIME.</p><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Explain the same idea in your own words. Keep the relaxed rhythm and let small words stay small.</p>
        </div>
      )}
    </main>
  );
}
