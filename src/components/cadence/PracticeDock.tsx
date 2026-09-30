import type { ReactNode } from "react";
import { ArrowRight, ChevronUp, LoaderCircle, Mic, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { VERDICT_LABEL } from "@/lib/coach";
import { formatTime, targetLabel } from "./data";
import { ReferenceButton, type PracticeLoop } from "./PracticePanel";

/** What the dock says about the target: the recorder first, then the coach or the newest take. */
function dockStatus({ recorder, takes, coach }: PracticeLoop) {
  const coachOn = coach.enabled && !coach.unavailable;
  if (recorder.status === "requesting") return "Waiting for microphone";
  if (recorder.status === "recording") return coachOn ? "Coach is listening…" : "Recording";
  if (recorder.take) return "Take ready to send";
  if (recorder.error) return "Microphone unavailable";
  if (coachOn) {
    const reply = [...coach.messages].reverse().find((message) => message.role === "coach");
    if (!reply || reply.role !== "coach") return "Record a take for instant feedback";
    if (reply.status === "pending") return reply.question ? "Coach is thinking…" : "Coach is comparing with the reference…";
    if (reply.status === "error") return "Coach couldn't answer · tap to retry";
    return reply.verdict ? `${VERDICT_LABEL[reply.verdict]} · ${reply.text}` : reply.text;
  }
  const newest = takes[0];
  if (!newest) return "Listen, then record";
  if (newest.status === "submitting" || newest.status === "processing") return `Take ${newest.number} · Analysing…`;
  if (newest.status === "failed" || !newest.result) return `Take ${newest.number} · Couldn't compare`;
  return `Take ${newest.number} · Beats ${newest.result.beats.matched}/${newest.result.beats.total}`;
}

/**
 * The practice loop on phones: a bar above the app navigation to listen,
 * record and send without leaving the phrase list, and a drawer (`children`,
 * the practice panel) with the transcript and every take's feedback.
 */
export function PracticeDock({ loop, open, setOpen, children }: { loop: PracticeLoop; open: boolean; setOpen: (open: boolean) => void; children: ReactNode }) {
  const { recorder } = loop;
  const recording = recorder.status === "recording";
  const requesting = recorder.status === "requesting";
  const draft = recording ? null : recorder.take;
  const status = dockStatus(loop);
  const label = targetLabel(loop.target);

  return (
    <>
      {/* Sits just above the BottomBar, whose height grows with the safe area. */}
      <section aria-label="Practice" className="fixed bottom-[calc(4.75rem+max(0.7rem,env(safe-area-inset-bottom)))] left-1/2 z-30 flex w-[calc(100%-1.5rem)] max-w-[calc(var(--width-device)-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-[1.4rem] bg-ink p-2 pl-4 text-background shadow-lg lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label={`Open ${label.toLowerCase()} practice: ${status}`} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/60">
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[9px] uppercase tracking-widest text-background/50">{label}</span>
            <span className={`flex items-center gap-1.5 text-sm ${recording ? "text-primary" : ""}`}>
              {recording && <span className="size-2 shrink-0 animate-record rounded-full bg-primary" />}
              {/* Two lines, so a coach reply reads without opening the drawer. */}
              <span className="line-clamp-2 leading-snug">{status}</span>
              {recording && <span className="font-mono text-xs tabular-nums">{formatTime(recorder.elapsed)}</span>}
            </span>
          </span>
          <ChevronUp className="size-4 shrink-0 text-background/50" />
        </button>
        {/* Announces take progress without reading out the recording timer. */}
        <span className="sr-only" aria-live="polite">{status}</span>
        {draft ? (
          <>
            <Button onClick={recorder.reset} size="icon" aria-label="Discard this take" className="size-11 shrink-0 rounded-full bg-background/10 text-background shadow-none hover:bg-background/20"><Trash2 className="size-4" /></Button>
            <Button onClick={loop.onSubmit} className="h-11 shrink-0 rounded-full bg-primary px-4 text-primary-foreground shadow-none hover:bg-primary/90">Send <ArrowRight /></Button>
          </>
        ) : (
          <>
            <ReferenceButton reference={loop.reference} compact />
            <Button onClick={loop.onRecord} disabled={requesting} aria-label={recording ? "Stop recording" : "Start recording"} className={`size-12 shrink-0 rounded-full p-0 shadow-none ${recording ? "bg-background text-foreground hover:bg-background/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
              {requesting ? <LoaderCircle className="size-5 animate-spin" /> : recording ? <Square className="size-4 fill-current" /> : <Mic className="size-5" />}
            </Button>
          </>
        )}
      </section>

      <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
        <DrawerContent className="device-column mx-auto max-h-[92dvh] border-ink/10">
          <DrawerHeader className="sr-only">
            <DrawerTitle>Practice {label.toLowerCase()}</DrawerTitle>
            <DrawerDescription>Record yourself and review feedback on each take.</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4">{children}</div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
