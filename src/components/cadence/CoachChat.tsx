import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowRight, ArrowUp, Check, CircleAlert, Ear, Mic, Pause, Play, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { latestTake, type CoachMessage } from "@/hooks/use-coach";
import { VERDICT_LABEL, type CoachVerdict } from "@/lib/coach";
import { formatTime } from "./data";

/** What the practice panel hands the chat: the thread for the current target and what can be done with it. */
export type CoachControls = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** Why the coach can't be used on this clip, if it can't. */
  unavailable: string | null;
  messages: CoachMessage[];
  ask: (question: string) => void;
  retry: (replyId: string) => void;
  /** Send a take from the chat to the full analysis. */
  breakdown: (takeId: string) => void;
};

const QUICK_REPLIES = ["Why?", "Which word should I stress?", "Show me the rhythm"];

const VERDICT_STYLE: Record<CoachVerdict, string> = {
  on_beat: "bg-accent/15 text-accent",
  close: "bg-primary/15 text-primary",
  off: "bg-caution/15 text-caution",
};

/** Stressed words come back in CAPS; set them in bold like the rest of the app. */
function CoachText({ text }: { text: string }) {
  return <>{text.split(/(\b[A-Z][A-Z']+\b)/).map((part, index) => (index % 2 ? <strong key={index} className="font-semibold">{part}</strong> : part))}</>;
}

/**
 * The AI coach as a chat: it listens while you record, replies to each take
 * within a few seconds, and answers questions about your latest take.
 */
export function CoachChat({ coach, targetLabel, recording, levels, canRecord, onRecord, next }: { coach: CoachControls; targetLabel: string; recording: boolean; levels: number[]; canRecord: boolean; onRecord: () => void; next: { label: string; onClick: () => void } | null }) {
  const { enabled, unavailable, messages } = coach;
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const take = latestTake(messages);
  const waiting = messages.some((message) => message.role === "coach" && message.status === "pending");
  const last = messages.at(-1);
  // The newest reply to a take (not a question) carries the next-step actions.
  const takeReply = [...messages].reverse().find((message) => message.role === "coach" && message.question === null);

  // Keep the newest message, or the listening bubble, in view.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
  }, [messages, recording]);

  const send = (text: string) => {
    if (!text.trim() || !take || waiting) return;
    coach.ask(text);
    setDraft("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
    }
  };

  return (
    <section aria-label="AI coach" className="overflow-hidden rounded-3xl border border-ink/10 bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-ink/10 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><Sparkles className="size-3.5" /></span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-foreground">AI coach</p>
            <p className="truncate font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{enabled ? `Listening to ${targetLabel.toLowerCase()}` : "Off"}</p>
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={coach.setEnabled} aria-label="AI coach" />
      </div>

      {!enabled ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Turn on for instant feedback after every take. Send a take for a full breakdown any time.</p>
      ) : (
        <>
          <div ref={logRef} role="log" aria-live="polite" aria-label="Conversation with the coach" className="max-h-80 min-h-32 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
            {messages.length === 0 && !recording && (
              <CoachBubble>Record a take and I'll tell you how it compares with the reference.</CoachBubble>
            )}
            {messages.map((message) => {
              if (message.role === "you") {
                return message.kind === "take" ? <TakeBubble key={message.id} message={message} /> : <YouBubble key={message.id}>{message.text}</YouBubble>;
              }
              if (message.status === "pending") return <Thinking key={message.id} label={message.question ? "Thinking…" : "Comparing with the reference…"} />;
              if (message.status === "error") {
                return (
                  <CoachBubble key={message.id} tone="error">
                    <p className="flex items-start gap-2"><CircleAlert className="mt-0.5 size-4 shrink-0 text-caution" />{message.text}</p>
                    {!unavailable && <Button onClick={() => coach.retry(message.id)} variant="outline" size="sm" className="mt-2 h-8 rounded-full border-ink/15 bg-transparent shadow-none hover:bg-ink/5"><RotateCcw /> Retry</Button>}
                  </CoachBubble>
                );
              }
              const about = messages.find((item) => item.id === message.takeId);
              const sent = about?.role === "you" && about.kind === "take" && about.breakdown;
              return (
                <CoachBubble key={message.id}>
                  {message.verdict && <span className={`mb-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest ${VERDICT_STYLE[message.verdict]}`}>{message.verdict === "on_beat" && <Check className="size-3" />}{VERDICT_LABEL[message.verdict]}</span>}
                  <p><CoachText text={message.text} /></p>
                  {message === takeReply && !recording && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      <Button onClick={onRecord} disabled={!canRecord} size="sm" className="h-8 rounded-full bg-primary px-3 text-primary-foreground shadow-none hover:bg-primary/90"><Mic /> Record again</Button>
                      <Button onClick={() => coach.breakdown(message.takeId)} disabled={sent} variant="outline" size="sm" className="h-8 rounded-full border-ink/15 bg-transparent px-3 shadow-none hover:bg-ink/5">
                        {sent ? <><Check /> Sent for full breakdown</> : <>Full breakdown</>}
                      </Button>
                      {next && <Button onClick={next.onClick} variant="outline" size="sm" className="h-8 rounded-full border-ink/15 bg-transparent px-3 shadow-none hover:bg-ink/5">{next.label} <ArrowRight /></Button>}
                    </div>
                  )}
                </CoachBubble>
              );
            })}
            {recording && <Listening levels={levels} />}
          </div>

          {last?.role === "coach" && last.status === "done" && !recording && (
            <div className="flex gap-1.5 overflow-x-auto px-4 pb-2">
              {QUICK_REPLIES.map((reply) => (
                <button key={reply} type="button" onClick={() => send(reply)} className="shrink-0 rounded-full border border-ink/15 px-3 py-1.5 text-xs text-muted-foreground outline-none hover:bg-ink/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60">
                  {reply}
                </button>
              ))}
            </div>
          )}

          {unavailable ? (
            <p role="status" className="border-t border-ink/10 px-4 py-3 text-sm text-muted-foreground">{unavailable}</p>
          ) : (
            <form onSubmit={submit} className="flex items-end gap-2 border-t border-ink/10 p-2 pl-4">
              <label htmlFor="coach-question" className="sr-only">Ask the coach about your take</label>
              <textarea
                id="coach-question"
                rows={1}
                value={draft}
                maxLength={500}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKeyDown}
                disabled={!take}
                placeholder={take ? "Ask about your take…" : "Record a take first"}
                className="max-h-24 min-h-10 flex-1 resize-none bg-transparent py-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
              />
              <Button type="submit" size="icon" disabled={!take || waiting || !draft.trim()} aria-label="Send question" className="size-10 shrink-0 rounded-full bg-primary text-primary-foreground shadow-none hover:bg-primary/90">
                <ArrowUp className="size-4" />
              </Button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function CoachBubble({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return <div className={`mr-8 w-fit max-w-full rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed ${tone === "error" ? "border border-caution/30 bg-caution/10" : "bg-ink/5"}`}>{children}</div>;
}

function YouBubble({ children }: { children: ReactNode }) {
  return <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2.5 text-sm leading-relaxed text-background">{children}</div>;
}

function TakeBubble({ message }: { message: Extract<CoachMessage, { kind: "take" }> }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };
  return (
    <div className="ml-auto flex w-fit items-center gap-2.5 rounded-2xl rounded-br-md bg-ink py-2 pl-2 pr-3.5 text-background">
      <audio ref={audioRef} src={message.take.url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="hidden" />
      <button type="button" onClick={toggle} aria-label={playing ? `Pause take ${message.number}` : `Play take ${message.number}`} className="grid size-8 place-items-center rounded-full bg-background text-foreground">
        {playing ? <Pause className="size-3.5" /> : <Play className="ml-0.5 size-3.5" />}
      </button>
      <span className="flex h-6 items-center gap-[2px]" aria-hidden>
        {message.take.peaks.filter((_, index) => index % 2 === 0).map((height, index) => <span key={index} className="w-[3px] rounded-sm bg-primary/80" style={{ height: `${Math.max(15, height)}%` }} />)}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-widest text-background/70">Take {message.number} · {formatTime(message.take.duration)}</span>
    </div>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <div className="mr-8 flex w-fit items-center gap-2 rounded-2xl rounded-bl-md bg-ink/5 px-3.5 py-2.5 text-sm text-muted-foreground">
      <span className="flex gap-1" aria-hidden>
        {[0, 150, 300].map((delay) => <span key={delay} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70" style={{ animationDelay: `${delay}ms` }} />)}
      </span>
      {label}
    </div>
  );
}

/** The coach hearing you: the live mic level, so it visibly listens while you speak. */
function Listening({ levels }: { levels: number[] }) {
  return (
    <div className="mr-8 flex w-fit items-center gap-2.5 rounded-2xl rounded-bl-md bg-primary/10 px-3.5 py-2.5 text-sm text-primary">
      <Ear className="size-4 shrink-0" />
      <span className="flex h-5 items-center gap-[2px]" aria-hidden>
        {levels.slice(-14).map((height, index) => <span key={index} className="w-[3px] rounded-sm bg-primary transition-[height] duration-100" style={{ height: `${Math.max(12, height)}%` }} />)}
      </span>
      Listening…
    </div>
  );
}
