import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Metric } from "./primitives";

export function CompleteScreen({ onAgain }: { onAgain: () => void }) {
  return (
    <main className="device-column px-5 pb-28 pt-10 text-center">
      <div className="animate-rise"><div className="mx-auto grid size-14 place-items-center rounded-full bg-accent text-accent-foreground"><Check className="size-6" /></div><p className="mt-6 font-mono text-xs uppercase tracking-widest text-accent">Session complete · 6 min</p><h1 className="mt-3 font-display text-6xl">YOU KEPT THE BEAT.</h1><p className="mx-auto mt-5 max-w-lg leading-relaxed text-muted-foreground">Your spontaneous speech preserved the reference's phrasing and final pitch drop. That transfer is the skill that matters.</p></div>
      <div className="mt-10 grid grid-cols-3 gap-2 text-left"><Metric label="Shadow" value="82" suffix="/100" dark /><Metric label="Improvise" value="78" suffix="/100" accent /><Metric label="Strongest" value="Pitch" suffix="fall" caution /></div>
      <section className="mt-6 rounded-3xl border border-ink/10 p-6 text-left"><p className="font-mono text-[10px] uppercase tracking-widest text-primary">Next focus</p><h2 className="mt-2 font-display text-3xl">REDUCE THE WORDS BETWEEN THE BEATS.</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">In your next session, keep function words lighter so the important words can carry the rhythm without extra effort.</p></section>
      <div className="mt-8 grid gap-3">
        <Button onClick={onAgain} className="h-14 rounded-2xl bg-primary px-6 text-primary-foreground shadow-none">Practice another clip <ArrowRight /></Button>
        <Button asChild variant="ghost" className="h-11 rounded-xl text-muted-foreground shadow-none"><Link to="/">Back to home</Link></Button>
      </div>
    </main>
  );
}
