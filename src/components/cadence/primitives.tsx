import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowLeft, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Metric({ label, value, suffix, dark, accent, caution }: { label: string; value: string; suffix: string; dark?: boolean; accent?: boolean; caution?: boolean }) {
  const tone = dark ? "bg-ink text-background" : accent ? "border-accent/25 bg-accent/10 text-accent" : caution ? "border-caution/30 bg-caution/10 text-caution" : "border-ink/10 bg-card";
  return <div className={`min-w-0 rounded-2xl border border-transparent p-4 ${tone}`}><p className="truncate font-mono text-[9px] uppercase tracking-widest opacity-65">{label}</p><div className="mt-1 flex items-baseline gap-1"><span className="font-display text-3xl">{value}</span><span className="font-mono text-[10px] opacity-60">{suffix}</span></div></div>;
}

export function Waveform({ bars, tone, tall }: { bars: number[]; tone: "primary" | "ink"; tall?: boolean }) {
  return <div className={`flex items-center gap-[3px] ${tall ? "h-28" : "h-14"}`} aria-label="Audio waveform">{bars.map((height, index) => <span key={index} className={`w-full rounded-sm ${tone === "primary" ? "bg-primary/80" : "bg-ink/50"}`} style={{ height: `${height}%` }} />)}</div>;
}

export function Timeline({ label, bars, tone, markers }: { label: string; bars: number[]; tone: "light" | "primary"; markers: string[] }) {
  return <div className="grid grid-cols-[42px_1fr] items-center gap-3"><span className={`font-mono text-[10px] ${tone === "primary" ? "text-primary" : "text-background/50"}`}>{label}</span><div><div className="flex h-14 items-center gap-[3px]">{bars.map((height, index) => <span key={index} className={`w-full rounded-sm ${tone === "primary" ? "bg-primary/75" : "bg-background/35"}`} style={{ height: `${height}%` }} />)}</div><div className="mt-1 grid grid-cols-4 font-mono text-[9px] text-background/40">{markers.map((word) => <span key={word}>{word}</span>)}</div></div></div>;
}

export function AudioButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <Button onClick={onClick} variant="outline" size="sm" className="rounded-full border-background/20 bg-transparent text-background shadow-none hover:bg-background/10 hover:text-background">{active ? <Pause /> : <Play />} {label}</Button>;
}

export function BackButton({ onClick }: { onClick: () => void }) { return <Button onClick={onClick} variant="ghost" size="sm" className="-ml-3 rounded-full text-muted-foreground hover:bg-ink/5"><ArrowLeft /> Back</Button>; }

export function DataRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between border-b border-ink/10 pb-3 last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="font-mono text-xs">{value}</span></div>; }

/**
 * Playback progress. With `onSeek` it becomes a slider: click or drag
 * anywhere on the track to jump, or use the arrow keys (Shift for 5s steps).
 */
export function SeekBar({ value, max, label, onSeek }: { value: number; max: number; label: string; onSeek?: ((seconds: number) => void) | undefined }) {
  const [dragging, setDragging] = useState(false);
  const percent = max ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const clamp = (seconds: number) => Math.min(max, Math.max(0, seconds));
  const seekTo = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek?.(clamp(((event.clientX - rect.left) / rect.width) * max));
  };
  const fill = <div className={`h-full bg-primary ${dragging ? "" : "transition-[width] duration-200"}`} style={{ width: `${percent}%` }} />;
  if (!onSeek) {
    return <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.ceil(max)} aria-valuenow={Math.floor(value)} className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/15">{fill}</div>;
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 5 : 1;
    const next = { ArrowLeft: value - step, ArrowDown: value - step, ArrowRight: value + step, ArrowUp: value + step, Home: 0, End: max }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onSeek(clamp(next));
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.ceil(max)}
      aria-valuenow={Math.floor(value)}
      aria-valuetext={`${Math.floor(value)} of ${Math.ceil(max)} seconds`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); seekTo(event); }}
      onPointerMove={(event) => { if (dragging) seekTo(event); }}
      onPointerUp={() => setDragging(false)}
      onPointerCancel={() => setDragging(false)}
      className="group mt-1 cursor-pointer touch-none rounded-full py-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <div className="relative h-1.5 rounded-full bg-background/15">
        <div className="h-full overflow-hidden rounded-full">{fill}</div>
        <span className={`absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background shadow transition-opacity ${dragging ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"}`} style={{ left: `${percent}%` }} />
      </div>
    </div>
  );
}
