import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, LoaderCircle, Pause, Play, RotateCcw } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useClipPlayer, type ClipSource } from "@/hooks/use-clip-player";
import { useCoach } from "@/hooks/use-coach";
import { useMediaQuery } from "@/hooks/use-mobile";
import type { useRecorder } from "@/hooks/use-recorder";
import type { PhraseProgress, useTakeHistory } from "@/hooks/use-take-history";
import type { AnalysisStatus, SourceType } from "@/lib/analysis";
import { phraseTimeline, targetLabel, type PracticePhrase } from "./data";
import { PracticeDock } from "./PracticeDock";
import { PracticePanel, type PracticeLoop, type ReferenceControls } from "./PracticePanel";
import { BackButton } from "./primitives";
import { ProcessingScreen } from "./ProcessingScreen";

function AccentPhrase({ phrase }: { phrase: PracticePhrase }) {
  return (
    <span>
      {phrase.structure.map((part, index) => part.accent ? (
        <strong key={`${part.text}-${index}`} className="font-semibold uppercase text-foreground">
          {part.text}<span className="ml-0.5 text-primary">{part.accent === "up" ? "↗" : "↘"}</span>
        </strong>
      ) : <span key={`${part.text}-${index}`}>{part.text}</span>)}
    </span>
  );
}

function progressText(progress: PhraseProgress | undefined) {
  if (!progress?.count) return "no takes yet";
  const takes = `${progress.count} take${progress.count === 1 ? "" : "s"}`;
  if (progress.pending) return `${takes}, analysing`;
  return progress.best ? `${takes}, best ${progress.best.matched} of ${progress.best.total} beats` : takes;
}

/** Take count and best beats score for a phrase row; described in the row's label. */
function ProgressBadge({ progress }: { progress: PhraseProgress | undefined }) {
  if (!progress?.count) return null;
  if (progress.pending) return <LoaderCircle aria-hidden className="size-3.5 animate-spin text-muted-foreground" />;
  const { count, best } = progress;
  const perfect = best && best.matched === best.total;
  return (
    <span aria-hidden className={`font-mono text-[10px] tabular-nums tracking-widest ${perfect ? "text-accent" : "text-muted-foreground"}`}>
      {count}×{best ? ` · ${best.matched}/${best.total}` : ""}
    </span>
  );
}

/**
 * The clip's phrases and the practice loop together: pick the full clip or
 * one phrase, listen, record, read the feedback and move on to the next
 * phrase without leaving the page. `voice` is the ElevenLabs voice of a
 * generated clip; `startedAt` is when the clip was requested.
 */
export function PracticeScreen({ analysisId, status, error, title, phrases, clipSource, kind, voice, startedAt, selectedPhrase, setSelectedPhrase, recorder, history, onBack, onRetry, onContinue }: { analysisId: string | undefined; status: AnalysisStatus | "idle"; error: string | null; title: string; phrases: PracticePhrase[]; clipSource: ClipSource; kind: SourceType; voice?: string | null; startedAt: number; selectedPhrase: PracticePhrase | null; setSelectedPhrase: (phrase: PracticePhrase | null) => void; recorder: ReturnType<typeof useRecorder>; history: ReturnType<typeof useTakeHistory>; onBack: () => void; onRetry?: (() => void) | undefined; onContinue: () => void }) {
  const youtubeMount = useRef<HTMLDivElement | null>(null);
  // Hold the source back until the phrases (and the YouTube mount) render.
  const player = useClipPlayer(status === "ready" ? clipSource : null, youtubeMount);
  const phraseRefs = useRef<Record<number, HTMLLIElement | null>>({});
  const timeline = phraseTimeline(phrases);
  const elapsed = player.currentTime;
  const totalSeconds = player.duration || (timeline.at(-1)?.end ?? 0);
  const clipPlaying = player.playing && !player.range;
  const canPlay = player.status === "ready";
  // Desktop shows the practice panel beside the phrases; phones get the dock.
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showTranscript, setShowTranscript] = useState(true);
  // Which take is open, per target; the newest until the learner picks one.
  const [expanded, setExpanded] = useState<Record<string, string | null>>({});
  // A target picked while an unsent take is waiting, held until the learner confirms.
  const [pendingTarget, setPendingTarget] = useState<{ phrase: PracticePhrase | null } | null>(null);

  // Nothing plays over a take, and the target can't change under one.
  const micBusy = recorder.status === "recording" || recorder.status === "requesting";
  const listenable = canPlay && !micBusy;

  // A phrase stays active through the pause that follows it.
  let activePhrase = timeline[0]?.phrase;
  for (const entry of timeline) if (entry.start <= elapsed) activePhrase = entry.phrase;

  const playingEntry = player.playing && player.range ? timeline.find((entry) => entry.start === player.range?.start) : undefined;
  const playingPhrase = playingEntry?.phrase.id ?? null;

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

  useEffect(() => {
    if (!clipPlaying || !activePhrase) return;
    phraseRefs.current[activePhrase.id]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activePhrase, clipPlaying]);

  // Bring the selected phrase into view, e.g. after "Next phrase".
  useEffect(() => {
    if (selectedPhrase) phraseRefs.current[selectedPhrase.id]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedPhrase]);

  const toggleClip = () => (clipPlaying ? player.pause() : player.play());

  const togglePhrase = (id: number) => {
    const entry = timeline.find((item) => item.phrase.id === id);
    if (!entry) return;
    if (playingPhrase === id) player.pause();
    else player.playRange(entry.start, entry.end);
  };

  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canPlay || !totalSeconds) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    player.seek(((event.clientX - bounds.left) / bounds.width) * totalSeconds);
  };

  const seekFromKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[event.key];
    if (!canPlay || step === undefined) return;
    event.preventDefault();
    player.seek(elapsed + step);
  };

  const applyTarget = (phrase: PracticePhrase | null) => {
    recorder.reset();
    setSelectedPhrase(phrase);
  };

  const chooseTarget = (phrase: PracticePhrase | null) => {
    if (micBusy || (phrase?.id ?? null) === (selectedPhrase?.id ?? null)) return;
    if (recorder.take) setPendingTarget({ phrase });
    else applyTarget(phrase);
  };

  const record = () => {
    if (recorder.status === "recording") return recorder.stop();
    player.pause();
    document.querySelectorAll("audio").forEach((audio) => audio.pause());
    void recorder.start();
  };

  const targetId = selectedPhrase?.id ?? null;
  const targetKey = String(targetId ?? "full");
  const takes = history.takesFor(targetId);
  const expandedTake = expanded[targetKey] !== undefined ? expanded[targetKey] : (takes[0]?.localId ?? null);
  const setExpandedTake = (localId: string | null) => setExpanded((current) => ({ ...current, [targetKey]: localId }));

  const coach = useCoach(analysisId);
  // With the coach on, a finished take goes straight to it: no Send step.
  const coachOn = coach.enabled && !coach.unavailable;
  const { sendTake } = coach;
  const handedOff = useRef<string | null>(null);
  useEffect(() => {
    const take = recorder.take;
    if (!coachOn || !take || handedOff.current === take.url) return;
    handedOff.current = take.url;
    sendTake(take, targetId);
    recorder.reset();
    // recorder.reset is stable; the recorder object itself changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachOn, recorder.take, sendTake, targetId]);
  const coachMessages = coach.threadFor(targetId);

  // A take from the coach chat goes through the full analysis, like a sent draft.
  const breakdown = (takeId: string) => {
    const message = coachMessages.find((item) => item.id === takeId);
    if (message?.role !== "you" || message.kind !== "take" || message.breakdown) return;
    const localId = history.submit({ ...message.take }, targetId);
    coach.markBreakdown(takeId, targetId);
    setExpandedTake(localId);
  };

  const submit = () => {
    if (!recorder.take) return;
    const localId = history.submit(recorder.take, targetId);
    // The take now lives in the history; the recorder starts fresh.
    recorder.reset();
    setExpandedTake(localId);
    if (!desktop) setDrawerOpen(true);
  };

  const targetEntry = selectedPhrase ? timeline.find((entry) => entry.phrase.id === selectedPhrase.id) : undefined;
  const referencePlaying = targetEntry ? playingPhrase === targetEntry.phrase.id : clipPlaying;
  const reference: ReferenceControls = {
    canPlay: listenable,
    loading: player.status === "loading",
    playing: referencePlaying,
    toggle: () => {
      if (referencePlaying) player.pause();
      else if (targetEntry) player.playRange(targetEntry.start, targetEntry.end);
      else player.play();
    },
  };

  const index = selectedPhrase ? phrases.findIndex((phrase) => phrase.id === selectedPhrase.id) : -1;
  const following = index >= 0 ? phrases[index + 1] : undefined;
  const next = selectedPhrase ? { label: following ? "Next phrase" : "Practice full clip", onClick: () => chooseTarget(following ?? null) } : null;

  const loop: PracticeLoop = {
    target: selectedPhrase,
    phrases,
    reference,
    recorder,
    onRecord: record,
    onSubmit: submit,
    takes,
    onRetry: history.retry,
    next,
    coach: {
      enabled: coach.enabled,
      setEnabled: coach.setEnabled,
      unavailable: coach.unavailable,
      messages: coachMessages,
      ask: (question) => coach.ask(question, targetId),
      retry: (replyId) => coach.retry(replyId, targetId),
      breakdown,
    },
  };
  const continueButton = (
    <Button onClick={onContinue} disabled={micBusy} variant="outline" className="h-12 w-full rounded-xl border-ink/15 bg-transparent shadow-none hover:bg-ink/5">
      Continue to improvise <ArrowRight />
    </Button>
  );

  if (status === "failed" || (status === "ready" && phrases.length === 0)) {
    return (
      <main className="device-column grid min-h-[70vh] place-items-center px-5 pb-28 pt-6">
        <div className="text-center" role="alert">
          <CircleAlert className="mx-auto size-8 text-destructive" />
          <h1 className="mt-5 font-display text-4xl">COULDN'T PREPARE THIS CLIP.</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{error ?? "No speech was found in this clip."}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {onRetry && (
              <Button onClick={onRetry} className="h-12 rounded-xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">
                <RotateCcw /> Try again
              </Button>
            )}
            <Button onClick={onBack} variant="outline" className="h-12 rounded-xl border-ink/15 bg-transparent shadow-none hover:bg-ink/5">
              <ArrowLeft /> Try another source
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (status !== "ready") return <ProcessingScreen kind={kind} startedAt={startedAt} />;

  const panel = <PracticePanel loop={loop} expanded={expandedTake} setExpanded={setExpandedTake} showTranscript={showTranscript} setShowTranscript={setShowTranscript} footer={desktop ? continueButton : undefined} />;
  const fullSelected = selectedPhrase === null;

  return (
    // Phones leave room for the practice dock stacked on the app navigation.
    <main className="device-column px-5 pb-52 pt-6 lg:max-w-6xl lg:px-8 lg:pb-12">
      <BackButton onClick={onBack} />
      <div className="mt-7 animate-rise lg:mt-4">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">02 · Practice</p>
        <h1 className="mt-3 font-display text-4xl leading-none">PICK A PHRASE. LISTEN. RECORD. REPEAT.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">The arrows show where the voice rises or falls. Practice the whole clip or one phrase at a time.</p>
      </div>

      {/* Desktop: the phrases on the left, the practice panel pinned on the right. */}
      <div className="lg:mt-8 lg:grid lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-start lg:gap-10">
        <div>
          <section className="mt-7 rounded-2xl bg-ink p-4 text-background lg:mt-0">
            {clipSource?.kind === "youtube" && <div ref={youtubeMount} className="mb-4 aspect-video w-full overflow-hidden rounded-xl bg-background/10" />}
            <div className="flex items-center gap-3">
              <Button onClick={toggleClip} disabled={!listenable} size="icon" aria-label={clipPlaying ? "Pause full clip" : "Play full clip"} className="size-12 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none hover:bg-primary/90">
                {player.status === "loading" ? <LoaderCircle className="size-5 animate-spin" /> : clipPlaying ? <Pause className="size-5" /> : <Play className="ml-0.5 size-5 fill-current" />}
              </Button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[9px] uppercase tracking-widest text-background/50">Full reference</p>
                    <p className="truncate text-sm font-semibold">{title}</p>
                    {kind === "generated" && <p className="truncate font-mono text-[9px] uppercase tracking-widest text-primary">AI voice{voice ? ` · ${voice}` : ""} · Powered by ElevenLabs</p>}
                  </div>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-background/60">{formatTime(elapsed)} / {formatTime(totalSeconds)}</span>
                </div>
                <div
                  role="slider"
                  tabIndex={canPlay ? 0 : -1}
                  aria-label="Seek full clip"
                  aria-valuemin={0}
                  aria-valuemax={Math.floor(totalSeconds)}
                  aria-valuenow={Math.floor(elapsed)}
                  aria-valuetext={`${formatTime(elapsed)} of ${formatTime(totalSeconds)}`}
                  aria-disabled={!canPlay}
                  onPointerDown={seekFromPointer}
                  onKeyDown={seekFromKey}
                  className={`-my-2 py-2 ${canPlay ? "cursor-pointer" : ""}`}
                >
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-background/15">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${totalSeconds ? Math.min(100, (elapsed / totalSeconds) * 100) : 0}%` }} />
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 font-mono text-[9px] uppercase tracking-widest text-background/45">{player.status === "error" ? "Couldn't load this clip's audio" : micBusy ? "Paused while you record" : playingPhrase ? `Playing phrase ${playingPhrase} only` : clipPlaying && activePhrase ? `Playing phrase ${activePhrase.id} of ${phrases.length}` : elapsed > 0 && elapsed < totalSeconds ? "Paused" : elapsed >= totalSeconds ? "Clip complete" : "Play the clip to follow each phrase"}</p>
          </section>

          <section className="mt-7 border-y border-ink/10 py-5 lg:mt-6">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Practice</p>
              <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">↗ Rise · ↘ Fall</p>
            </div>
            <button
              type="button"
              onClick={() => chooseTarget(null)}
              aria-pressed={fullSelected}
              aria-disabled={micBusy && !fullSelected}
              aria-label={`Practice the full clip, ${progressText(history.progress.get(null))}`}
              className={`mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 ${fullSelected ? "bg-primary/10 ring-1 ring-primary/40" : micBusy ? "cursor-not-allowed opacity-50" : "hover:bg-ink/5"}`}
            >
              <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">Full clip</span>
              <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{phrases.length} phrases · {formatTime(totalSeconds)}</span>
              <span className="ml-auto shrink-0"><ProgressBadge progress={history.progress.get(null)} /></span>
            </button>
            <ol className="mt-1 space-y-1">
              {phrases.map((phrase) => {
                const selected = selectedPhrase?.id === phrase.id;
                const active = clipPlaying && activePhrase?.id === phrase.id;
                const phrasePlaying = playingPhrase === phrase.id;
                const locked = micBusy && !selected;
                const progress = history.progress.get(phrase.id);
                return (
                  <li
                    key={phrase.id}
                    ref={(element) => { phraseRefs.current[phrase.id] = element; }}
                    className={`rounded-xl transition-colors ${selected ? "bg-primary/10 ring-1 ring-primary/40" : active ? "bg-primary/10" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => chooseTarget(selected ? null : phrase)}
                      aria-pressed={selected}
                      aria-disabled={locked}
                      aria-label={`${selected ? "Practising" : "Practice"} phrase ${phrase.id}: ${phrase.text}. ${progressText(progress)}`}
                      className={`flex w-full items-baseline gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 ${selected ? "" : locked ? "cursor-not-allowed opacity-50" : "hover:bg-ink/5"}`}
                    >
                      <span className="w-4 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground/70">{String(phrase.id).padStart(2, "0")}</span>
                      <span className={`min-w-0 flex-1 text-sm leading-6 lg:text-base lg:leading-7 ${selected || active ? "text-foreground" : "text-muted-foreground"}`}><AccentPhrase phrase={phrase} /></span>
                      <span className="shrink-0 self-center"><ProgressBadge progress={progress} /></span>
                    </button>
                    {selected && (
                      <div className="flex items-center justify-between gap-2 pb-2.5 pl-10 pr-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
                        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{phrase.durationSeconds} sec{phrase.pauseMs ? ` · ${phrase.pauseMs} ms pause` : ""}</span>
                        <Button onClick={() => togglePhrase(phrase.id)} disabled={!listenable} variant="outline" size="icon" aria-label={`${phrasePlaying ? "Pause" : "Play"} reference for phrase ${phrase.id}`} className="size-9 rounded-full border-ink/15 bg-background shadow-none hover:bg-ink/5">
                          {phrasePlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            <p className="mt-3 font-mono text-[9px] uppercase tracking-widest text-muted-foreground" aria-live="polite">
              {micBusy ? "Stop recording to switch phrase." : <><span className="lg:hidden">Tap</span><span className="hidden lg:inline">Click</span> a phrase to practice it on its own.</>}
            </p>
          </section>

          {!desktop && <div className="mt-6">{continueButton}</div>}
        </div>

        {desktop && (
          <aside aria-label={`Practice ${targetLabel(selectedPhrase).toLowerCase()}`} className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto overscroll-contain pb-2">
            {panel}
          </aside>
        )}
      </div>

      {!desktop && <PracticeDock loop={loop} open={drawerOpen} setOpen={setDrawerOpen}>{panel}</PracticeDock>}

      <AlertDialog open={pendingTarget !== null} onOpenChange={(open) => { if (!open) setPendingTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your unsent take?</AlertDialogTitle>
            <AlertDialogDescription>
              Your take for {targetLabel(selectedPhrase).toLowerCase()} hasn't been sent for feedback. Switching to {pendingTarget ? targetLabel(pendingTarget.phrase).toLowerCase() : "another phrase"} throws it away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep take</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pendingTarget) applyTarget(pendingTarget.phrase); setPendingTarget(null); }}>Discard</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
