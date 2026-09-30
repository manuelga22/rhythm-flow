import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowRight, AudioLines, MessageCircle, Mic, Repeat, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const steps: { num: string; tag: string; title: string; copy: string; icon: LucideIcon }[] = [
  { num: "01", tag: "Choose", title: "BRING A VOICE", icon: AudioLines, copy: "Use a short video or audio clip from a speaker you want to sound more like. Pick a clear, conversational moment between 5 and 20 seconds." },
  { num: "02", tag: "Shadow", title: "MATCH THE MUSIC", icon: Mic, copy: "Mirror the whole phrase: its strong beats, reductions, links, pauses, and pitch. You are imitating the music of the sentence, not just the words." },
  { num: "03", tag: "Improvise", title: "MAKE IT YOURS", icon: MessageCircle, copy: "Remove the script and carry the same natural rhythm into your own words. The transfer — not the imitation — is the skill that lasts." },
];

export function DashboardScreen() {
  return (
    <main className="device-column px-5 pb-32 pt-10">
      <section className="animate-rise border-b border-ink/10 pb-10">
        <h1 className="mt-4 font-display text-[3.45rem] leading-[0.98]">SOUND NATURAL<br />BEYOND THE WORDS.</h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">Train the rhythm, stress, and melody that fluent speakers use when words become conversation.</p>
        <Button asChild size="lg" className="mt-8 h-14 w-full rounded-2xl bg-primary px-6 text-primary-foreground shadow-none hover:bg-primary/90">
          <Link to="/practice">Start practice <ArrowRight /></Link>
        </Button>
        <Button asChild variant="ghost" className="mt-2 h-11 w-full rounded-2xl text-muted-foreground hover:bg-ink/5">
          <a href="#method">See how it works <ArrowDown /></a>
        </Button>
      </section>

      <section id="method" aria-labelledby="method-heading" className="scroll-mt-20 pt-10">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">How it works</p>
        <h2 id="method-heading" className="mt-3 font-display text-5xl leading-none">THE METHOD.</h2>
        <p className="mt-3 leading-relaxed text-muted-foreground">Three moves, one loop.</p>

        <ol className="mt-10 grid">
          {steps.map(({ num, tag, title, copy, icon: Icon }, index) => (
            <li key={num} className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4 pb-10 last:pb-0">
              {/* Connector to the next step. */}
              {index < steps.length - 1 && <span aria-hidden className="absolute bottom-0 left-[1.375rem] top-12 w-px -translate-x-1/2 bg-ink/15" />}
              <span aria-hidden className="grid size-11 place-items-center rounded-full border border-ink/15 bg-card text-primary">
                <Icon className="size-5" />
              </span>
              <div className="pt-1">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{num} · {tag}</p>
                <h3 className="mt-1.5 font-display text-3xl leading-none">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-12 rounded-3xl bg-ink p-6 text-background">
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-background/60"><Repeat className="size-3.5" aria-hidden /> Then repeat</p>
          <p className="mt-2 font-display text-3xl leading-none">ONE LOOP PER SESSION.</p>
          <p className="mt-2 text-sm leading-relaxed text-background/70">Each session walks the full cycle so natural rhythm becomes a habit, not a performance.</p>
          <Button asChild size="lg" className="mt-6 h-14 w-full rounded-2xl bg-primary px-6 text-primary-foreground shadow-none hover:bg-primary/90">
            <Link to="/practice">Try the method <ArrowRight /></Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
