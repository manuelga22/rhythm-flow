import { useCallback, useEffect, useRef, useState } from "react";
import { useQueries, useQueryClient, type Query } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ANALYSIS_POLL_MS } from "@/lib/analysis";
import { fetchAttempt, submitAttempt, subscribeAttempt, type Attempt, type ComparisonView } from "@/lib/attempts";
import type { SavedTake } from "@/lib/sessions";
import type { Take } from "@/hooks/use-recorder";

const attemptKey = (id: string) => ["attempt", id] as const;

type Entry = {
  localId: string;
  blob: Blob;
  /** Owned by the history, independent of the recorder's own URL. */
  url: string;
  duration: number;
  peaks: number[];
  phraseId: number | null;
  attemptId: string | null;
  submitting: boolean;
  submitError: string | null;
};

export type TakeStatus = "submitting" | "processing" | "ready" | "failed";

export type TakeEntry = Pick<Entry, "localId" | "duration" | "peaks" | "phraseId"> & {
  /** 1-based take number within its phrase (or the full clip), counting saved takes first. */
  number: number;
  /** Null when a saved take's audio couldn't be signed. */
  url: string | null;
  status: TakeStatus;
  error: string | null;
  result: ComparisonView | null;
  /** Only takes recorded this visit still have their audio to resend. */
  canRetry: boolean;
};

/** How practice on one phrase (null: the full clip) is going. */
export type PhraseProgress = {
  count: number;
  pending: number;
  /** The take that hit the most beats, as a share of the beats. */
  best: { matched: number; total: number } | null;
};

/**
 * Shadow takes for the current clip, newest first: those submitted this visit
 * followed by takes saved to the signed-in user's session. Each
 * is followed until the worker has compared it. Updates arrive over Realtime,
 * with polling as a fallback while an attempt is processing.
 */
export function useTakeHistory(analysisId: string | undefined, { sessionId = null, saved = [] }: { sessionId?: string | null; saved?: SavedTake[] } = {}) {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<Entry[]>([]);
  // Read by callbacks that must not change identity with every entry update.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  const counter = useRef(0);

  const update = useCallback((localId: string, patch: Partial<Entry>) => {
    setEntries((current) => current.map((entry) => (entry.localId === localId ? { ...entry, ...patch } : entry)));
  }, []);

  const send = useCallback(
    async (localId: string, blob: Blob, phraseId: number | null, duration: number) => {
      update(localId, { submitting: true, submitError: null, attemptId: null });
      try {
        if (!analysisId) throw new Error("The reference clip isn't ready yet.");
        const attempt = await submitAttempt({ analysisId, phraseId, blob, sessionId, duration });
        queryClient.setQueryData(attemptKey(attempt.id), attempt);
        update(localId, { submitting: false, attemptId: attempt.id });
        // Take counts in the saved-session list.
        if (sessionId) void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      } catch (err) {
        update(localId, { submitting: false, submitError: err instanceof Error ? err.message : "Couldn't send your take." });
      }
    },
    [analysisId, sessionId, queryClient, update],
  );

  const submit = useCallback(
    (take: Take, phraseId: number | null) => {
      counter.current += 1;
      const entry: Entry = {
        localId: `take-${counter.current}`,
        blob: take.blob,
        url: URL.createObjectURL(take.blob),
        duration: take.duration,
        peaks: take.peaks,
        phraseId,
        attemptId: null,
        submitting: true,
        submitError: null,
      };
      setEntries((current) => [entry, ...current]);
      void send(entry.localId, entry.blob, phraseId, entry.duration);
      return entry.localId;
    },
    [send],
  );

  const retry = useCallback(
    (localId: string) => {
      const entry = entriesRef.current.find((item) => item.localId === localId);
      if (entry) void send(localId, entry.blob, entry.phraseId, entry.duration);
    },
    [send],
  );

  const clear = useCallback(() => {
    entriesRef.current.forEach((entry) => URL.revokeObjectURL(entry.url));
    counter.current = 0;
    setEntries([]);
    // Takes sent this visit show up as saved ones next time.
    if (sessionId) void queryClient.invalidateQueries({ queryKey: ["session-takes", sessionId] });
  }, [queryClient, sessionId]);

  useEffect(() => () => entriesRef.current.forEach((entry) => URL.revokeObjectURL(entry.url)), []);

  // A take sent this visit is listed once, as the local entry that holds its audio.
  const localAttemptIds = new Set(entries.flatMap((entry) => (entry.attemptId ? [entry.attemptId] : [])));
  const savedTakes = saved.filter((take) => !localAttemptIds.has(take.id));

  const initial = new Map<string, Attempt>(savedTakes.map((take) => [take.id, take]));
  const attemptIds = [...localAttemptIds, ...savedTakes.map((take) => take.id)];
  const queries = useQueries({
    queries: attemptIds.map((id) => ({
      queryKey: attemptKey(id),
      queryFn: () => fetchAttempt(id),
      initialData: () => initial.get(id),
      enabled: Boolean(supabase),
      staleTime: Infinity,
      refetchInterval: (query: Query<Attempt>) => (query.state.data?.status === "processing" ? ANALYSIS_POLL_MS : false),
    })),
  });
  const attempts = new Map(attemptIds.map((id, index) => [id, queries[index]?.data]));

  const processingIds = attemptIds.filter((id) => attempts.get(id)?.status === "processing").join(",");
  useEffect(() => {
    if (!processingIds) return;
    const unsubscribes = processingIds.split(",").map((id) => subscribeAttempt(id, (attempt) => queryClient.setQueryData(attemptKey(id), attempt)));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [processingIds, queryClient]);

  // Takes are numbered per phrase: saved ones first, oldest to newest.
  const savedCount = new Map<number | null, number>();
  for (const take of savedTakes) savedCount.set(take.phrase_id, (savedCount.get(take.phrase_id) ?? 0) + 1);
  const localCount = new Map<number | null, number>();
  for (const entry of entries) localCount.set(entry.phraseId, (localCount.get(entry.phraseId) ?? 0) + 1);

  const newerLocal = new Map<number | null, number>();
  const localTakes: TakeEntry[] = entries.map((entry) => {
    const attempt = entry.attemptId ? attempts.get(entry.attemptId) : undefined;
    const status: TakeStatus = entry.submitError ? "failed" : entry.submitting || !entry.attemptId ? "submitting" : (attempt?.status ?? "processing");
    const newer = newerLocal.get(entry.phraseId) ?? 0;
    newerLocal.set(entry.phraseId, newer + 1);
    return {
      localId: entry.localId,
      number: (savedCount.get(entry.phraseId) ?? 0) + (localCount.get(entry.phraseId) ?? 0) - newer,
      url: entry.url,
      duration: entry.duration,
      peaks: entry.peaks,
      phraseId: entry.phraseId,
      status,
      error: entry.submitError ?? attempt?.error ?? null,
      result: attempt?.status === "ready" ? attempt.result : null,
      canRetry: true,
    };
  });
  const olderSaved = new Map<number | null, number>();
  const earlierTakes: TakeEntry[] = savedTakes
    .map((take) => {
      const attempt = attempts.get(take.id) ?? take;
      const number = (olderSaved.get(take.phrase_id) ?? 0) + 1;
      olderSaved.set(take.phrase_id, number);
      return {
        localId: `saved-${take.id}`,
        number,
        url: take.url,
        duration: take.duration,
        peaks: [],
        phraseId: take.phrase_id,
        status: attempt.status,
        error: attempt.error,
        result: attempt.status === "ready" ? attempt.result : null,
        canRetry: false,
      };
    })
    .reverse();
  const takes = [...localTakes, ...earlierTakes];

  const progress = new Map<number | null, PhraseProgress>();
  for (const take of takes) {
    const current = progress.get(take.phraseId) ?? { count: 0, pending: 0, best: null };
    const beats = take.result?.beats;
    const better = beats && beats.total > 0 && (!current.best || beats.matched / beats.total > current.best.matched / current.best.total);
    progress.set(take.phraseId, {
      count: current.count + 1,
      pending: current.pending + (take.status === "submitting" || take.status === "processing" ? 1 : 0),
      best: better ? { matched: beats.matched, total: beats.total } : current.best,
    });
  }

  return {
    takes,
    /** Takes for one phrase, or the full clip when null. */
    takesFor: (phraseId: number | null) => takes.filter((take) => take.phraseId === phraseId),
    progress,
    pending: takes.filter((take) => take.status === "submitting" || take.status === "processing").length,
    submit,
    retry,
    clear,
  };
}
