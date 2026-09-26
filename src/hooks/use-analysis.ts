import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ANALYSIS_POLL_MS, fetchAnalysis, requestAnalysis, subscribeAnalysis, type Analysis, type AnalysisStatus } from "@/lib/analysis";

const analysisKey = (id: string | undefined) => ["analysis", id] as const;

/**
 * Request an analysis for a source, or reopen a stored one by id, and follow
 * it until it settles.
 * Updates arrive over Realtime, with polling as a fallback while processing.
 */
export function useAnalysis() {
  const queryClient = useQueryClient();

  const request = useMutation({
    mutationFn: requestAnalysis,
    onSuccess: (analysis) => queryClient.setQueryData(analysisKey(analysis.id), analysis),
  });

  // Set when reopening a saved session's analysis instead of requesting one.
  const [openedId, setOpenedId] = useState<string | null>(null);
  const id = request.data?.id ?? openedId ?? undefined;
  const live = Boolean(id && supabase);

  const query = useQuery({
    queryKey: analysisKey(id),
    queryFn: () => fetchAnalysis(id as string),
    enabled: live,
    staleTime: Infinity,
    refetchInterval: (current) => (current.state.data?.status === "processing" ? ANALYSIS_POLL_MS : false),
  });

  useEffect(() => {
    if (!id || !live) return;
    return subscribeAnalysis(id, (analysis) => queryClient.setQueryData(analysisKey(id), analysis));
  }, [id, live, queryClient]);

  const analysis: Analysis | undefined = query.data ?? request.data;
  const loading = request.isPending || (Boolean(openedId) && query.isPending);
  const failed = request.isError || (!analysis && query.isError);
  const status: AnalysisStatus | "idle" = loading ? "processing" : failed ? "failed" : (analysis?.status ?? "idle");
  const error = request.error?.message ?? (analysis ? analysis.error : query.error?.message) ?? null;

  const { mutate, reset } = request;
  const start = useCallback(
    (source: Parameters<typeof mutate>[0]) => {
      setOpenedId(null);
      mutate(source);
    },
    [mutate],
  );
  const open = useCallback(
    (analysisId: string) => {
      reset();
      setOpenedId(analysisId);
    },
    [reset],
  );

  return {
    analysis,
    status,
    error,
    submitting: request.isPending,
    start,
    open,
    reset,
  };
}
