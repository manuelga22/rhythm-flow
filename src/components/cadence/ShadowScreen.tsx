import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, Mic, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClipPlayer, type ClipSource } from "@/hooks/use-clip-player";
import type { useRecorder } from "@/hooks/use-recorder";
import type { useTakeHistory } from "@/hooks/use-take-history";
import { phraseTimeline, type PracticePhrase } from "./data";
import { BackButton } from "./primitives";
import { RecordPanel } from "./RecordScreen";
import { TakeCard } from "./TakeFeedback";

type Tab = "record" | "feedback";

const TRIGGER = "h-9 gap-2 rounded-full font-mono text-[11px] uppercase tracking-widest text-muted-foreground data-[state=active]:bg-ink data-[state=active]:text-background data-[state=active]:shadow-none";

export function ShadowScreen({ recorder, history, phrases, selectedPhrase, clipSource, onBack, onContinue }: { recorder: ReturnType<typeof useRecorder>; history: ReturnType<typeof useTakeHistory>; phrases: PracticePhrase[]; selectedPhrase: PracticePhrase | null; clipSource: ClipSource; onBack: () => void; onContinue: () => void }) {
  const [tab, setTab] = useState<Tab>(history.takes.length ? "feedback" : "record");
  const [expanded, setExpanded] = useState<string | null>(history.takes[0]?.localId ?? null);
  const recording = recorder.status === "recording";
  const { takes, pending } = history;

  const submit = () => {
    if (!recorder.take) return;
    const localId = history.submit(recorder.take, selectedPhrase?.id ?? null);
    // The take now lives in the history; start the Record tab fresh.
    recorder.reset();
    setExpanded(localId);
    setTab("feedback");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="device-column px-5 pb-28 pt-5">
      <BackButton onClick={onBack} />
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="mt-4">
        <TabsList className="grid h-11 w-full grid-cols-2 rounded-full bg-ink/5 p-1">
          <TabsTrigger value="record" className={TRIGGER}><Mic className="size-3.5" /> Record</TabsTrigger>
          <TabsTrigger value="feedback" disabled={recording} className={TRIGGER}>
            Feedback
            {pending > 0 ? <LoaderCircle className="size-3.5 animate-spin" aria-label={`${pending} take${pending === 1 ? "" : "s"} analysing`} /> : takes.length > 0 && <span className="rounded-full bg-primary px-1.5 py-px text-[9px] leading-4 text-primary-foreground">{takes.length}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="record" className="mt-0">
          <RecordPanel
            kind="shadow"
            recording={recording}
            seconds={recorder.elapsed}
            onRecord={() => (recording ? recorder.stop() : void recorder.start())}
            onAnalyze={submit}
            phrases={phrases}
            selectedPhrase={selectedPhrase}
            take={recorder.take}
            levels={recorder.levels}
            error={recorder.error}
            busy={recorder.status === "requesting"}
          />
        </TabsContent>

        {/* Kept mounted so the reference player isn't rebuilt on every tab switch. */}
        <TabsContent value="feedback" forceMount className="mt-5 data-[state=inactive]:hidden">
          <ReferenceCard phrases={phrases} selectedPhrase={selectedPhrase} clipSource={clipSource} active={tab === "feedback"} />
          {takes.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-dashed border-ink/20 p-6 text-center">
              <p className="font-display text-2xl">NO TAKES YET.</p>
              <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">Record yourself shadowing the reference, then submit it to see how your rhythm compares.</p>
              <Button onClick={() => setTab("record")} className="mt-4 h-11 rounded-full bg-primary px-5 text-primary-foreground shadow-none hover:bg-primary/90"><Mic /> Record a take</Button>
            </div>
          ) : (
            <>
              <div className="mt-5 space-y-3">
                {takes.map((take) => (
                  <TakeCard key={take.localId} take={take} expanded={expanded === take.localId} onToggle={() => setExpanded(expanded === take.localId ? null : take.localId)} onRetry={() => history.retry(take.localId)} />
                ))}
              </div>
              <div className="sticky bottom-24 z-10 -mx-2 mt-5 grid grid-cols-[auto_1fr] gap-2 rounded-2xl bg-background/95 p-2 backdrop-blur-md">
                <Button onClick={() => setTab("record")} variant="outline" className="h-12 rounded-xl border-ink/15 bg-transparent px-4 shadow-none hover:bg-ink/5"><RotateCcw /> Record again</Button>
                <Button onClick={onContinue} className="h-12 rounded-xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">Continue to improvise <ArrowRight /></Button>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
}

function ReferenceCard({ phrases, selectedPhrase, clipSource, active }: { phrases: PracticePhrase[]; selectedPhrase: PracticePhrase | null; clipSource: ClipSource; active: boolean }) {
  // No video here: YouTube only plays through its visible embed, so the
  // reference is playable on this tab for uploaded clips only.
  const audioSource = clipSource?.kind === "audio" ? clipSource : null;
  const noMount = useRef<HTMLElement | null>(null);
  const player = useClipPlayer(audioSource, noMount);
  const entry = selectedPhrase ? phraseTimeline(phrases).find((item) => item.phrase.id === selectedPhrase.id) : undefined;
  const canPlay = player.status === "ready";
  const playing = player.playing;
  const text = selectedPhrase ? selectedPhrase.text : phrases.map((phrase) => phrase.text).join(" ");

  // Leaving the tab stops the reference, so it never plays over a recording.
  const { pause } = player;
  useEffect(() => {
    if (!active) pause();
  }, [active, pause]);

  const toggle = () => {
    if (player.playing) player.pause();
    else if (entry) player.playRange(entry.start, entry.end);
    else player.play();
  };

  return (
    <section className="rounded-2xl bg-ink p-4 text-background">
      <div className="flex items-center gap-3">
        {audioSource && (
          <Button onClick={toggle} disabled={!canPlay} size="icon" aria-label={playing ? "Pause reference" : "Play reference"} className="size-10 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none hover:bg-primary/90">
            {player.status === "loading" ? <LoaderCircle className="size-4 animate-spin" /> : playing ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4 fill-current" />}
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[9px] uppercase tracking-widest text-background/50">Reference · {selectedPhrase ? `phrase ${selectedPhrase.id}` : "full clip"}</p>
          <p className="truncate text-sm text-background/85">{text}</p>
        </div>
      </div>
    </section>
  );
}
