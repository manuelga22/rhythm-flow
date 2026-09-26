import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { fetchSessionTakes, startSession } from "@/lib/sessions";

export const sessionsKey = (userId: string) => ["sessions", userId] as const;
export const sessionTakesKey = (sessionId: string) => ["session-takes", sessionId] as const;

/**
 * For signed-in users, the saved session for the current clip and the takes
 * already saved to it. Guests get no session and practice is not saved.
 */
export function usePracticeSession(analysisId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id;
  const [session, setSession] = useState<{ key: string; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = userId && analysisId ? `${userId}:${analysisId}` : null;

  // Opening a session is a write, so run it once per user and clip rather than as a query.
  useEffect(() => {
    if (!key || !analysisId || !userId) return;
    let cancelled = false;
    setError(null);
    startSession(analysisId)
      .then((id) => {
        if (cancelled) return;
        setSession({ key, id });
        void queryClient.invalidateQueries({ queryKey: sessionsKey(userId) });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't save this session.");
      });
    return () => {
      cancelled = true;
    };
  }, [key, analysisId, userId, queryClient]);

  const sessionId = session && session.key === key ? session.id : null;

  const takes = useQuery({
    queryKey: sessionTakesKey(sessionId ?? ""),
    queryFn: () => fetchSessionTakes(sessionId as string),
    enabled: Boolean(sessionId),
    // Signed URLs expire after an hour.
    staleTime: 30 * 60 * 1000,
  });

  return { sessionId, savedTakes: takes.data ?? [], error };
}
