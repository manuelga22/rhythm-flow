import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ChevronRight, FileAudio, Link2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { sessionsKey } from "@/hooks/use-practice-session";
import { listSessions, type PracticeSession } from "@/lib/sessions";
import { SignInPrompt } from "./SignInPrompt";

const SOURCE_LABEL = { youtube: "YouTube video", upload: "Uploaded clip", generated: "AI clip" } as const;
const SOURCE_ICON = { youtube: Link2, upload: FileAudio, generated: Sparkles } as const;

const sessionTitle = (session: PracticeSession) => session.title ?? SOURCE_LABEL[session.sourceType];

/** The Continue tab of the Source step: the signed-in user's saved sessions, most recent first. */
export function ContinueSessions({ className = "", prompt, onResume, onNew }: { className?: string; prompt: { title: string; body: string }; onResume: (session: PracticeSession) => void; onNew: () => void }) {
  const { user, loading } = useAuth();
  const sessions = useQuery({
    queryKey: sessionsKey(user?.id ?? ""),
    queryFn: listSessions,
    enabled: Boolean(user),
  });

  if (!loading && !user) return <SignInPrompt className={className} {...prompt} />;

  if (loading || sessions.isPending) {
    return (
      <div className={`grid gap-2 ${className}`} aria-busy="true" aria-label="Loading saved sessions">
        {[0, 1, 2].map((index) => <Skeleton key={index} className="h-[4.5rem] rounded-2xl" />)}
      </div>
    );
  }

  if (sessions.isError) {
    return (
      <div role="alert" className={`rounded-2xl border border-caution/30 bg-caution/10 p-5 text-sm ${className}`}>
        <p>We couldn't load your saved sessions. {sessions.error.message}</p>
        <Button variant="outline" size="sm" onClick={() => void sessions.refetch()} className="mt-3 rounded-full border-ink/15 bg-transparent shadow-none">Try again</Button>
      </div>
    );
  }

  if (!sessions.data.length) {
    return (
      <div className={`rounded-2xl border border-dashed border-ink/20 p-6 text-center ${className}`}>
        <p className="font-display text-2xl">NO SAVED SESSIONS YET.</p>
        <p className="mt-2 text-sm text-muted-foreground">Clips you practice while signed in are saved here automatically.</p>
        <Button onClick={onNew} className="mt-5 h-11 rounded-2xl bg-primary px-5 text-primary-foreground shadow-none">Start a new clip</Button>
      </div>
    );
  }

  return (
    <ul className={`grid gap-2 ${className}`} aria-label="Saved sessions">
      {sessions.data.map((session) => {
        const Icon = SOURCE_ICON[session.sourceType];
        return (
          <li key={session.id}>
            <button type="button" onClick={() => onResume(session)} className="grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-ink/10 bg-card p-4 text-left transition-colors hover:border-ink/30">
              <span className="grid size-10 place-items-center rounded-xl bg-ink text-background"><Icon className="size-4" /></span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{sessionTitle(session)}</span>
                <span className="mt-1 block truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {formatDistanceToNow(new Date(session.lastPracticedAt), { addSuffix: true })} · {session.takeCount} take{session.takeCount === 1 ? "" : "s"}
                </span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
