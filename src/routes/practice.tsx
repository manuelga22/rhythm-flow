import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BottomBar } from "@/components/cadence/BottomBar";
import { BreakdownScreen } from "@/components/cadence/BreakdownScreen";
import { CompleteScreen } from "@/components/cadence/CompleteScreen";
import { FeedbackScreen } from "@/components/cadence/FeedbackScreen";
import { Header } from "@/components/cadence/Header";
import { RecordScreen } from "@/components/cadence/RecordScreen";
import { ShadowScreen } from "@/components/cadence/ShadowScreen";
import { SourceScreen, type SourceTab } from "@/components/cadence/SourceScreen";
import type { PracticePhrase, Stage } from "@/components/cadence/data";
import { useAnalysis } from "@/hooks/use-analysis";
import { useAuth } from "@/hooks/use-auth";
import type { ClipSource } from "@/hooks/use-clip-player";
import { useRecorder } from "@/hooks/use-recorder";
import { usePracticeSession } from "@/hooks/use-practice-session";
import { useTakeHistory } from "@/hooks/use-take-history";
import { youtubeId, type AnalysisSource } from "@/lib/analysis";
import { referenceAudioUrl, type PracticeSession } from "@/lib/sessions";

export const Route = createFileRoute("/practice")({
  head: () => ({
    meta: [
      { title: "Practice — Cadence" },
      { name: "description", content: "Shadow a reference clip, then improvise the same idea in your own words." },
      { property: "og:title", content: "Practice — Cadence" },
      { property: "og:description", content: "Shadow a reference clip, then improvise the same idea in your own words." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PracticePage,
});

function PracticePage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("source");
  const [sourceTab, setSourceTab] = useState<SourceTab>("new");
  const [sourceMode, setSourceMode] = useState<"youtube" | "upload">("youtube");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState<"reference" | "you" | null>(null);
  const [selectedPhrase, setSelectedPhrase] = useState<PracticePhrase | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Shadow takes come from the microphone; improvise still runs on the simulated timer.
  const recorder = useRecorder();
  const { analysis, status: analysisStatus, error: analysisError, submitting, start: startAnalysis, open: openAnalysis } = useAnalysis();
  const { user } = useAuth();
  // Signed-in practice is saved to a session per clip; guests get none.
  const { sessionId, savedTakes } = usePracticeSession(analysis?.status === "ready" ? analysis.id : undefined);
  const phraseId = selectedPhrase?.id ?? null;
  const savedForPhrase = useMemo(() => savedTakes.filter((take) => take.phrase_id === phraseId), [savedTakes, phraseId]);
  // Shadow takes for the current clip and phrase: saved ones plus those submitted this visit.
  const history = useTakeHistory(analysis?.id, { sessionId, saved: savedForPhrase });
  const phrases = analysis?.view?.phrases ?? [];
  const clipTitle = analysis?.view?.title ?? analysis?.title ?? "Reference clip";

  // Uploads play from the file the user just picked. A saved session reopened
  // without the file plays the stored upload from a signed Storage URL.
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const storedAudioPath = analysis?.source_type === "upload" && !file && user ? analysis.audio_path : null;
  const { data: storedAudioUrl } = useQuery({
    queryKey: ["reference-audio", storedAudioPath],
    queryFn: () => referenceAudioUrl(storedAudioPath as string),
    enabled: Boolean(storedAudioPath),
    // Signed URLs expire after an hour.
    staleTime: 30 * 60 * 1000,
  });
  const uploadUrl = fileUrl ?? (storedAudioPath ? (storedAudioUrl ?? null) : null);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
  const videoId = analysis?.source_key.startsWith("youtube:") ? analysis.source_key.slice("youtube:".length) : youtubeId(url);
  const clipSource: ClipSource = analysis?.source_type === "upload" ? (uploadUrl ? { kind: "audio", url: uploadUrl } : null) : videoId ? { kind: "youtube", videoId } : null;

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const go = (next: Stage) => {
    // An unsubmitted take only survives while staying on the Shadow step.
    if (next === "shadow") recorder.stop();
    else recorder.reset();
    // Feedback history belongs to one clip and phrase; Improvise → Back keeps it.
    if (next === "source" || next === "breakdown") history.clear();
    setStage(next);
    setRecording(false);
    setPlaying(null);
    setSeconds(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const analyze = (source: AnalysisSource) => {
    setSelectedPhrase(null);
    startAnalysis(source);
    go("breakdown");
  };

  // Reopen a saved clip on the Structure step; its takes load with the session.
  const resume = (session: PracticeSession) => {
    setSelectedPhrase(null);
    setSourceMode(session.sourceType);
    // The picked file (if any) belongs to another clip.
    setFile(null);
    openAnalysis(session.analysisId);
    go("breakdown");
  };

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Header stage={stage} />
      {stage === "source" && (
        <SourceScreen tab={sourceTab} setTab={setSourceTab} mode={sourceMode} setMode={setSourceMode} url={url} setUrl={setUrl} file={file} setFile={setFile} fileRef={fileRef} submitError={analysisStatus === "failed" ? analysisError : null} submitting={submitting} onBack={() => navigate({ to: "/" })} onContinue={analyze} onResume={resume} />
      )}
      {stage === "breakdown" && (
        <BreakdownScreen status={analysisStatus} error={analysisError} title={clipTitle} phrases={phrases} clipSource={clipSource} selectedPhrase={selectedPhrase} setSelectedPhrase={setSelectedPhrase} onBack={() => go("source")} onContinue={() => go("shadow")} />
      )}
      {stage === "shadow" && (
        <ShadowScreen recorder={recorder} history={history} phrases={phrases} selectedPhrase={selectedPhrase} clipSource={clipSource} onBack={() => go("breakdown")} onContinue={() => go("improvise")} />
      )}
      {stage === "improvise" && (
        <RecordScreen kind="improvise" recording={recording} seconds={seconds} onRecord={() => setRecording((value) => !value)} onBack={() => go("shadow")} onAnalyze={() => go("improvFeedback")} />
      )}
      {stage === "improvFeedback" && <FeedbackScreen kind="improvise" playing={playing} setPlaying={setPlaying} onRetry={() => go("improvise")} onContinue={() => go("complete")} />}
      {stage === "complete" && <CompleteScreen onAgain={() => go("source")} />}
      <BottomBar active="practice" />
    </div>
  );
}
