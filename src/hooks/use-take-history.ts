import { useCallback, useEffect, useRef, useState } from "react";
import { useQueries, useQueryClient, type Query } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ANALYSIS_POLL_MS } from "@/lib/analysis";
import { fetchAttempt, submitAttempt, subscribeAttempt, type Attempt, type ComparisonView } from "@/lib/attempts";
import type { Take } from "@/hooks/use-recorder";

const attemptKey = (id: string) => ["attempt", id] as const;

type Entry = {
  localId: string;
  /** 1-based take number within this session. */
  number: number;
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

export type TakeEntry = Pick<Entry, "localId" | "number" | "url" | "duration" | "peaks" | "phraseId"> & {
  status: TakeStatus;
  error: string | null;
  result: ComparisonView | null;
};

/**
 * Every shadow take submitted this session, newest first, each followed
 * until the worker has compared it. Updates arrive over Realtime, with
 * polling as a fallback while an attempt is processing.
 */
export function useTakeHistory(analysisId: string | undefined) {
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
    async (localId: string, blob: Blob, phraseId: number | null) => {
      update(localId, { submitting: true, submitError: null, attemptId: null });
      try {
        if (!analysisId) throw new Error("The reference clip isn't ready yet.");
        const attempt = await submitAttempt({ analysisId, phraseId, blob });
        queryClient.setQueryData(attemptKey(attempt.id), attempt);
        update(localId, { submitting: false, attemptId: attempt.id });
      } catch (err) {
        update(localId, { submitting: false, submitError: err instanceof Error ? err.message : "Couldn't send your take." });
      }
    },
    [analysisId, queryClient, update],
  );

  const submit = useCallback(
    (take: Take, phraseId: number | null) => {
      counter.current += 1;
      const entry: Entry = {
        localId: `take-${counter.current}`,
        number: counter.current,
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
      void send(entry.localId, entry.blob, phraseId);
      return entry.localId;
    },
    [send],
  );

  const retry = useCallback(
    (localId: string) => {
      const entry = entriesRef.current.find((item) => item.localId === localId);
      if (entry) void send(localId, entry.blob, entry.phraseId);
    },
    [send],
  );

  const clear = useCallback(() => {
    entriesRef.current.forEach((entry) => URL.revokeObjectURL(entry.url));
    counter.current = 0;
    setEntries([]);
  }, []);

  useEffect(() => () => entriesRef.current.forEach((entry) => URL.revokeObjectURL(entry.url)), []);

  const attemptIds = entries.flatMap((entry) => (entry.attemptId ? [entry.attemptId] : []));
  const queries = useQueries({
    queries: attemptIds.map((id) => ({
      queryKey: attemptKey(id),
      queryFn: () => fetchAttempt(id),
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

  const takes: TakeEntry[] = entries.map((entry) => {
    const attempt = entry.attemptId ? attempts.get(entry.attemptId) : undefined;
    const status: TakeStatus = entry.submitError ? "failed" : entry.submitting || !entry.attemptId ? "submitting" : (attempt?.status ?? "processing");
    return {
      localId: entry.localId,
      number: entry.number,
      url: entry.url,
      duration: entry.duration,
      peaks: entry.peaks,
      phraseId: entry.phraseId,
      status,
      error: entry.submitError ?? attempt?.error ?? null,
      result: attempt?.status === "ready" ? attempt.result : null,
    };
  });

  return {
    takes,
    pending: takes.filter((take) => take.status === "submitting" || take.status === "processing").length,
    submit,
    retry,
    clear,
  };
}
