import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BottomBar } from "@/components/cadence/BottomBar";
import { Header } from "@/components/cadence/Header";

export const Route = createFileRoute("/method")({
  head: () => ({
    meta: [
      { title: "The Method — Cadence" },
      { name: "description", content: "How Cadence works: choose a voice, shadow it, then improvise without the script." },
      { property: "og:title", content: "The Method — Cadence" },
      { property: "og:description", content: "Choose a voice, shadow it, then improvise without the script." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MethodPage,
});

const steps = [
  { num: "01", tag: "Choose", title: "BRING A VOICE", copy: "Use a short video or audio clip from a speaker you want to sound more like. Pick a clear, conversational moment between 5 and 20 seconds." },
  { num: "02", tag: "Shadow", title: "MATCH THE MUSIC", copy: "Mirror the whole phrase: its strong beats, reductions, links, pauses, and pitch. You are imitating the music of the sentence, not just the words." },
  { num: "03", tag: "Improvise", title: "MAKE IT YOURS", copy: "Remove the script and carry the same natural rhythm into your own words. The transfer — not the imitation — is the skill that lasts." },
];

function MethodPage() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased lg:pl-56">
        <Header />

        <main className="device-column px-5 pb-32 pt-6">
          <Button asChild variant="ghost" size="sm" className="-ml-3 rounded-full text-muted-foreground hover:bg-ink/5">
            <Link to="/"><ArrowLeft /> Back</Link>
          </Button>
          <div className="mt-8 animate-rise">
            <p className="font-mono text-xs uppercase tracking-widest text-primary">How it works</p>
            <h1 className="mt-3 font-display text-5xl leading-none">THE METHOD.</h1>
            <p className="mt-3 leading-relaxed text-muted-foreground">Three moves, one loop. Each session walks the full cycle so natural rhythm becomes a habit, not a performance.</p>
          </div>

          <section className="mt-10 grid gap-9">
            {steps.map((step) => (
              <div key={step.num} className="border-b border-ink/10 pb-9 last:border-0 last:pb-0">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{step.num} · {step.tag}</p>
                <h2 className="mt-2 font-display text-3xl">{step.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.copy}</p>
              </div>
            ))}
          </section>

          <Button asChild size="lg" className="mt-10 h-14 w-full rounded-2xl bg-primary px-6 text-primary-foreground shadow-none hover:bg-primary/90">
            <Link to="/practice">Try the method <ArrowRight /></Link>
          </Button>
        </main>

        <BottomBar />
    </div>
  );
}
