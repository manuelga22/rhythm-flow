import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ANALYSIS_POLL_MS, fetchAnalysis, requestAnalysis, subscribeAnalysis, type Analysis, type AnalysisStatus } from "@/lib/analysis";

const analysisKey = (id: string | undefined) => ["analysis", id] as const;

/**
 * Request an analysis for a source and follow it until it settles.
 * Updates arrive over Realtime, with polling as a fallback while processing.
 */
export function useAnalysis() {
  const queryClient = useQueryClient();

  const request = useMutation({
    mutationFn: requestAnalysis,
    onSuccess: (analysis) => queryClient.setQueryData(analysisKey(analysis.id), analysis),
  });

  const id = request.data?.id;
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
  const status: AnalysisStatus | "idle" = request.isPending ? "processing" : request.isError ? "failed" : (analysis?.status ?? "idle");
  const error = request.error?.message ?? analysis?.error ?? null;

  return {
    analysis,
    status,
    error,
    submitting: request.isPending,
    start: request.mutate,
    reset: request.reset,
  };
}
