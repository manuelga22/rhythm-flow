import { useRef, useState } from "react";
import { Check, ChevronDown, CircleAlert, LoaderCircle, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TakeEntry } from "@/hooks/use-take-history";
import type { ComparisonView, WordFlag } from "@/lib/attempts";
import { formatTime } from "./data";
import { Metric, SeekBar } from "./primitives";

// Paces within this share of the reference read as matching it.
const ON_PACE = 0.08;

export function TakeCard({ take, expanded, onToggle, onRetry }: { take: TakeEntry; expanded: boolean; onToggle: () => void; onRetry: () => void }) {
  const bodyId = `${take.localId}-body`;
  return (
    <article className={`overflow-hidden rounded-2xl border transition-colors ${expanded ? "border-ink/15 bg-card" : "border-ink/10"}`}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={bodyId} className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-primary/60">
        <span className="font-display text-xl leading-none">TAKE {take.number}</span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{formatTime(take.duration)}</span>
        <span className="ml-auto"><TakeStatusBadge take={take} /></span>
        <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div id={bodyId} className="space-y-5 border-t border-ink/10 px-4 pb-5 pt-4 animate-in fade-in duration-200">
          {take.url ? <TakePlayer url={take.url} duration={take.duration} /> : <p className="text-sm text-muted-foreground">This take's audio isn't available right now.</p>}
          {take.status === "ready" && take.result && <ComparisonDetails result={take.result} />}
          {(take.status === "submitting" || take.status === "processing") && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
              <LoaderCircle className="size-4 animate-spin text-primary" />
              {take.status === "submitting" ? "Sending your take…" : "Comparing your rhythm with the reference. This usually takes a few seconds."}
            </p>
          )}
          {take.status === "failed" && (
            <div role="alert" className="rounded-xl border border-caution/30 bg-caution/10 p-4">
              <p className="flex items-start gap-2 text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0 text-caution" />{take.error ?? "We couldn't compare this take."}</p>
              {take.canRetry && <Button onClick={onRetry} variant="outline" size="sm" className="mt-3 rounded-full border-ink/15 bg-transparent shadow-none hover:bg-ink/5"><RotateCcw /> Retry analysis</Button>}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function TakeStatusBadge({ take }: { take: TakeEntry }) {
  const label = "font-mono text-[10px] uppercase tracking-widest";
  if (take.status === "submitting" || take.status === "processing") {
    return <span className={`flex items-center gap-1.5 text-muted-foreground ${label}`}><LoaderCircle className="size-3.5 animate-spin" />{take.status === "submitting" ? "Sending" : "Analysing"}</span>;
  }
  if (take.status === "failed" || !take.result) return <span className={`text-caution ${label}`}>Failed</span>;
  const { matched, total } = take.result.beats;
  return <span className={`${matched === total ? "text-accent" : "text-foreground"} ${label}`}>Beats {matched}/{total}</span>;
}

function TakePlayer({ url, duration }: { url: string; duration: number }) {
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
    <div className="flex items-center gap-3">
      <audio ref={audioRef} src={url} preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPosition(duration); }} onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)} className="hidden" />
      <button type="button" onClick={toggle} aria-label={playing ? "Pause this take" : "Play this take"} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-background">{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</button>
      <div className="min-w-0 flex-1">
        <div className="flex justify-between font-mono text-[10px] uppercase tracking-widest text-muted-foreground"><span>Your take</span><span className="tabular-nums">{formatTime(position)} / {formatTime(duration)}</span></div>
        <SeekBar value={position} max={duration} label="Take position" onSeek={seek} tone="light" />
      </div>
    </div>
  );
}

function pace(rateRatio: number): { value: string; suffix: string } {
  if (Math.abs(rateRatio - 1) <= ON_PACE) return { value: "ON", suffix: "pace" };
  const percent = Math.round(Math.abs(rateRatio - 1) * 100);
  return { value: `${percent}%`, suffix: rateRatio > 1 ? "slower" : "faster" };
}

function ComparisonDetails({ result }: { result: ComparisonView }) {
  const { beats, feedback, categories } = result;
  const good = categories.filter((category) => category.verdict === "Good").length;
  const speed = pace(result.pace.rateRatio);
  const notes: [string, string | null, string][] = [
    ["Good", feedback.positive, "text-accent"],
    ["Work on", feedback.primary, "text-caution"],
    ["Also", feedback.secondary, "text-caution"],
    ["Try next", feedback.next, "text-primary"],
  ];
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Metric label="Beats hit" value={String(beats.matched)} suffix={`/${beats.total}`} dark />
        <Metric label="Pace" value={speed.value} suffix={speed.suffix} />
        <Metric label="Areas good" value={String(good)} suffix={`/${categories.length}`} accent={good === categories.length} caution={good < categories.length} />
      </div>
      <ComparisonLine result={result} />
      <ul className="space-y-3">
        {notes.filter(([, text]) => text).map(([label, text, tone]) => (
          <li key={label} className="grid grid-cols-[4.5rem_1fr] gap-2 text-sm leading-relaxed">
            <span className={`pt-0.5 font-mono text-[10px] uppercase tracking-widest ${tone}`}>{label}</span>
            <p>{text}</p>
          </li>
        ))}
      </ul>
      {feedback.source && (
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          {feedback.source === "audio" && feedback.model ? `Feedback by ${feedback.model} · listened to your take` : "Standard feedback"}
        </p>
      )}
      <ul className="divide-y divide-ink/10 rounded-xl border border-ink/10">
        {categories.map((category) => {
          const ok = category.verdict === "Good";
          return (
            <li key={category.name} className="flex gap-3 px-3 py-2.5 text-sm">
              <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${ok ? "bg-accent/15 text-accent" : "bg-caution/15 text-caution"}`}>{ok ? <Check className="size-3" /> : <span className="text-[10px] font-bold">!</span>}</span>
              <p><strong className="font-semibold">{category.name}.</strong> <span className="text-muted-foreground">{category.comment}</span></p>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const FLAG_STYLE: Record<Exclude<WordFlag, null>, string> = {
  hit_beat: "font-semibold uppercase text-primary",
  stressed: "font-semibold uppercase text-background",
  extra_stress: "rounded bg-caution/25 px-0.5 font-semibold uppercase text-caution",
  missing_stress: "text-accent underline decoration-2 underline-offset-4",
  reduced: "text-background/45",
  missing_word: "text-background/35 line-through",
};

/** The reference and the take, word by word, in the CLI's colour scheme. */
export function ComparisonLine({ result }: { result: ComparisonView }) {
  return (
    <div className="rounded-xl bg-ink p-4 text-background">
      <div className="grid grid-cols-[2.25rem_1fr] gap-x-2 gap-y-3 text-[15px] leading-7">
        <span className="pt-1.5 font-mono text-[10px] text-background/50">REF</span>
        <p className="text-background/80">
          {result.reference.map((part, index) => part.accent ? (
            <strong key={index} className="font-semibold uppercase text-background">{part.text}<span className="ml-0.5 text-primary">{part.accent === "up" ? "↗" : "↘"}</span></strong>
          ) : <span key={index}>{part.text}</span>)}
        </p>
        <span className="pt-1.5 font-mono text-[10px] text-primary">YOU</span>
        <p className="text-background/80">
          {result.words.map((word, index) => (
            <span key={index}>
              {index > 0 && " "}
              <span className={word.flag ? FLAG_STYLE[word.flag] : ""}>{word.flag === "missing_word" ? `(${word.text})` : word.text}</span>
              {word.pauseAfter !== undefined && <span className="mx-1 text-primary/80" title={`${word.pauseAfter}s pause`}>|</span>}
            </span>
          ))}
        </p>
      </div>
      <p className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[9px] uppercase tracking-widest text-background/50">
        <span><span className="text-primary">■</span> beat hit</span>
        <span><span className="text-caution">■</span> too much stress</span>
        <span><span className="text-accent">■</span> missed beat</span>
        <span>(word) skipped</span>
        <span><span className="text-primary">|</span> pause</span>
      </p>
    </div>
  );
}
