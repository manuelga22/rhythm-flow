import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Metric } from "./primitives";

export function DashboardScreen() {
  return (
    <main className="device-column px-5 pb-28 pt-10">
      <section className="border-b border-ink/10 pb-10">
        <div className="animate-rise">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Your voice, in motion</p>
          <h1 className="mt-4 font-display text-[3.45rem] leading-[0.98]">SOUND NATURAL<br />BEYOND THE WORDS.</h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">Train the rhythm, stress, and melody that fluent speakers use when words become conversation.</p>
          <Button asChild size="lg" className="mt-8 h-14 w-full rounded-2xl bg-primary px-6 text-primary-foreground shadow-none hover:bg-primary/90">
            <Link to="/practice">Start practice <ArrowRight /></Link>
          </Button>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3">
          <Metric label="Last rhythm match" value="82" suffix="/100" dark />
          <Metric label="Sessions" value="14" suffix="total" />
          <div className="col-span-2 rounded-2xl border border-accent/25 bg-accent/10 p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent">Last improvement</p>
            <p className="mt-2 text-sm font-medium">Your phrase-final intonation was 12% closer to the reference.</p>
          </div>
        </div>
      </section>
      <Link to="/method" className="group flex items-center justify-between gap-4 border-b border-ink/10 py-9">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">How it works</p>
          <h2 className="mt-2 font-display text-2xl">THE METHOD</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Choose a voice, shadow it, then improvise without the script.</p>
        </div>
        <ArrowRight className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    </main>
  );
}
