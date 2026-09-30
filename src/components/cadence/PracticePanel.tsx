import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Eye, EyeOff, LoaderCircle, Mic, Pause, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Take, useRecorder } from "@/hooks/use-recorder";
import type { TakeEntry } from "@/hooks/use-take-history";
import { formatTime, targetLabel, type PhrasePart, type PracticePhrase } from "./data";
import { CoachChat, type CoachControls } from "./CoachChat";
import { SeekBar, Waveform } from "./primitives";
import { TakeCard } from "./TakeFeedback";

/** The shared reference player, scoped to the practice target. */
export type ReferenceControls = { canPlay: boolean; loading: boolean; playing: boolean; toggle: () => void };

/** Everything the panel and the phone dock need to run the practice loop for one target. */
export type PracticeLoop = {
  /** Null practises the full clip. */
  target: PracticePhrase | null;
  phrases: PracticePhrase[];
  reference: ReferenceControls;
  recorder: ReturnType<typeof useRecorder>;
  /** Starts a take, or stops the one being recorded. */
  onRecord: () => void;
  onSubmit: () => void;
  /** Takes for the target, newest first. */
  takes: TakeEntry[];
  onRetry: (localId: string) => void;
  /** Where to go once the newest take has its feedback. */
  next: { label: string; onClick: () => void } | null;
  coach: CoachControls;
};

export function ReferenceButton({ reference, compact }: { reference: ReferenceControls; compact?: boolean }) {
  const icon = reference.loading ? <LoaderCircle className="size-4 animate-spin" /> : reference.playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4 fill-current" />;
  const label = reference.playing ? "Pause reference" : "Play reference";
  if (compact) {
    return (
      <Button onClick={reference.toggle} disabled={!reference.canPlay} size="icon" aria-label={label} className="size-11 shrink-0 rounded-full bg-background/10 text-background shadow-none hover:bg-background/20">
        {icon}
      </Button>
    );
  }
  return (
    <Button onClick={reference.toggle} disabled={!reference.canPlay} variant="outline" aria-label={label} className="h-10 rounded-full border-background/20 bg-transparent px-4 text-background shadow-none hover:bg-background/10 hover:text-background">
      {icon} Reference
    </Button>
  );
}

function AccentText({ parts }: { parts: PhrasePart[] }) {
  return (
    <>
      {parts.map((part, index) => part.accent ? (
        <strong key={`${part.text}-${index}`} className="font-semibold text-background">
          {part.text}<span className="ml-0.5 text-primary">{part.accent === "up" ? "↗" : "↘"}</span>
        </strong>
      ) : <span key={`${part.text}-${index}`}>{part.text}</span>)}
    </>
  );
}

/**
 * The practice loop for the current target: what to say, the reference, the
 * recorder, and every take with its feedback. Shown beside the phrases on
 * desktop and inside the dock's drawer on phones.
 */
export function PracticePanel({ loop, expanded, setExpanded, showTranscript, setShowTranscript, footer }: { loop: PracticeLoop; expanded: string | null; setExpanded: (localId: string | null) => void; showTranscript: boolean; setShowTranscript: (show: boolean) => void; footer?: ReactNode }) {
  const { target, phrases, reference, recorder, takes, next } = loop;
  const recording = recorder.status === "recording";
  const requesting = recorder.status === "requesting";
  const draft = recording ? null : recorder.take;
  const targetPhrases = target ? [target] : phrases;
  const duration = Math.ceil(targetPhrases.reduce((total, phrase) => total + phrase.durationSeconds, 0));
  const transcript = targetPhrases.flatMap((phrase, index) => (index ? [{ text: " " }, ...phrase.structure] : phrase.structure));
  const newest = takes[0];
  // With the coach on, takes go to the chat and this list holds the full breakdowns.
  const coachOn = loop.coach.enabled && !loop.coach.unavailable;
  const cardRef = useRef<HTMLElement>(null);

  // Keep the recorder in view when a take starts, e.g. from "Record again" further down.
  useEffect(() => {
    if (recording) cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [recording]);

  return (
    <div className="space-y-5">
      <section ref={cardRef} aria-label={`Record ${targetLabel(target).toLowerCase()}`} className="rounded-3xl bg-ink p-5 text-background">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-background/60">
            {targetLabel(target)} · {target ? `${target.durationSeconds} sec` : `${phrases.length} phrases`}
          </p>
          <div className="flex items-center gap-2">
            <span className={`size-2 rounded-full ${recording ? "animate-record bg-primary" : draft ? "bg-accent" : "bg-background/30"}`} />
            <span className={`font-mono text-[10px] uppercase tracking-widest ${recording ? "text-primary" : "text-background/50"}`}>{recording ? "Recording" : draft ? "Take ready" : "Ready"}</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div><ReferenceButton reference={reference} /></div>
          <Button onClick={loop.onRecord} disabled={requesting} aria-label={recording ? "Stop recording" : "Start recording"} className={`size-16 rounded-full border-4 border-background/15 p-0 shadow-none ${recording ? "bg-background text-foreground hover:bg-background/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
            {requesting ? <LoaderCircle className="size-6 animate-spin" /> : recording ? <Square className="size-5 fill-current" /> : <Mic className="size-6" />}
          </Button>
          <span className="justify-self-end font-mono text-sm tabular-nums text-background/80">{formatTime(recorder.elapsed)} / {formatTime(duration)}</span>
        </div>
        <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-widest text-background/50">{requesting ? "Waiting for microphone" : recording ? "Tap to stop" : draft ? "Tap to record again" : "Listen, then tap to record"}</p>
        {recorder.error && <p role="alert" className="mx-auto mt-3 max-w-xs text-center text-sm text-caution">{recorder.error}</p>}

        <div className="mt-5">
          <Waveform bars={draft ? draft.peaks : recorder.levels} tone="primary" />
        </div>

        {draft && <DraftTake key={draft.url} take={draft} onDiscard={recorder.reset} onSubmit={loop.onSubmit} />}

        <div className="mt-5 border-t border-background/10 pt-3">
          <button type="button" onClick={() => setShowTranscript(!showTranscript)} className="-ml-2.5 mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-background/60 outline-none hover:bg-background/10 hover:text-background focus-visible:ring-2 focus-visible:ring-primary/60 [&_svg]:size-3.5">
            {showTranscript ? <EyeOff /> : <Eye />} {showTranscript ? "Hide transcript" : "Show transcript"}
          </button>
          {showTranscript ? (
            <p className="text-lg leading-relaxed text-background/85">“<AccentText parts={transcript} />”</p>
          ) : (
            <p className="text-sm text-background/50">Transcript hidden. Shadow from memory.</p>
          )}
        </div>
      </section>

      <CoachChat coach={loop.coach} targetLabel={targetLabel(target)} recording={recording} levels={recorder.levels} canRecord={!requesting} onRecord={loop.onRecord} next={next} />

      <section aria-label={coachOn ? "Full breakdowns" : "Your takes"}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{coachOn ? "Full breakdowns" : "Your takes"} · {targetLabel(target)}</p>
          {takes.length > 0 && <p className="font-mono text-[10px] tabular-nums text-muted-foreground">{takes.length}</p>}
        </div>
        {takes.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-ink/20 p-5 text-center">
            <p className="font-display text-2xl">{coachOn ? "NO BREAKDOWNS YET." : "NO TAKES YET."}</p>
            <p className="mx-auto mt-1.5 max-w-xs text-sm text-muted-foreground">{coachOn ? "Want the detailed report? Press Full breakdown on any take in the coach chat." : "Play the reference, record yourself matching it, then send it to see how your rhythm compares."}</p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {takes.map((take) => (
              <div key={take.localId}>
                <TakeCard take={take} expanded={expanded === take.localId} onToggle={() => setExpanded(expanded === take.localId ? null : take.localId)} onRetry={() => loop.onRetry(take.localId)} />
                {take === newest && take.status === "ready" && !recording && !draft && (
                  <div className={`mt-2 grid gap-2 ${next ? "grid-cols-[auto_1fr]" : "grid-cols-1"}`}>
                    <Button onClick={loop.onRecord} disabled={requesting} variant="outline" className="h-11 rounded-xl border-ink/15 bg-transparent px-4 shadow-none hover:bg-ink/5"><Mic /> Record again</Button>
                    {next && <Button onClick={next.onClick} className="h-11 rounded-xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">{next.label} <ArrowRight /></Button>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {footer}
    </div>
  );
}

/** The take just recorded: listen back, then send it or throw it away. */
function DraftTake({ take, onDiscard, onSubmit }: { take: Take; onDiscard: () => void; onSubmit: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };
  const seek = (seconds: number) => {
    if (audioRef.current) audioRef.current.currentTime = seconds;
    setPosition(seconds);
  };
  return (
    <div className="mt-5 space-y-3">
      <audio ref={audioRef} src={take.url} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPosition(take.duration); }} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} className="hidden" />
      <div className="flex items-center gap-3 rounded-xl border border-background/10 bg-background/5 p-3">
        <button type="button" onClick={toggle} aria-label={playing ? "Pause your recording" : "Play your recording"} className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background text-foreground">{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
        <div className="min-w-0 flex-1">
          <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest text-background/50"><span>Your take</span><span className="tabular-nums">{formatTime(position)} / {formatTime(take.duration)}</span></div>
          <SeekBar value={position} max={take.duration} label="Your take position" onSeek={seek} />
        </div>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button onClick={onDiscard} variant="outline" aria-label="Discard this take" className="h-12 rounded-2xl border-background/20 bg-transparent px-4 text-background shadow-none hover:bg-background/10 hover:text-background"><Trash2 /></Button>
        <Button onClick={() => { audioRef.current?.pause(); onSubmit(); }} className="h-12 rounded-2xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">Send for feedback <ArrowRight /></Button>
      </div>
    </div>
  );
}
