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
