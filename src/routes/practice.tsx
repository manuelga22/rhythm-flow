import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BottomBar } from "@/components/cadence/BottomBar";
import { BreakdownScreen } from "@/components/cadence/BreakdownScreen";
import { CompleteScreen } from "@/components/cadence/CompleteScreen";
import { FeedbackScreen } from "@/components/cadence/FeedbackScreen";
import { Header } from "@/components/cadence/Header";
import { RecordScreen } from "@/components/cadence/RecordScreen";
import { SourceScreen } from "@/components/cadence/SourceScreen";
import type { PracticePhrase, Stage } from "@/components/cadence/data";
import { useAnalysis } from "@/hooks/use-analysis";
import type { ClipSource } from "@/hooks/use-clip-player";
import { youtubeId, type AnalysisSource } from "@/lib/analysis";

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
  const [sourceMode, setSourceMode] = useState<"youtube" | "upload">("youtube");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState<"reference" | "you" | null>(null);
  const [selectedPhrase, setSelectedPhrase] = useState<PracticePhrase | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { analysis, status: analysisStatus, error: analysisError, submitting, start: startAnalysis } = useAnalysis();
  const phrases = analysis?.view?.phrases ?? [];
  const clipTitle = analysis?.view?.title ?? analysis?.title ?? "Reference clip";

  // Uploads play from the file the user just picked, whichever backend
  // analysed it. TODO: when past analyses can be reopened without the file,
  // play Supabase uploads from a signed Storage URL instead.
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
  const videoId = analysis?.source_key.startsWith("youtube:") ? analysis.source_key.slice("youtube:".length) : youtubeId(url);
  const clipSource: ClipSource = analysis?.source_type === "upload" ? (fileUrl ? { kind: "audio", url: fileUrl } : null) : videoId ? { kind: "youtube", videoId } : null;

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const go = (next: Stage) => {
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

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Header stage={stage} />
      {stage === "source" && (
        <SourceScreen mode={sourceMode} setMode={setSourceMode} url={url} setUrl={setUrl} file={file} setFile={setFile} fileRef={fileRef} submitError={analysisStatus === "failed" ? analysisError : null} submitting={submitting} onBack={() => navigate({ to: "/" })} onContinue={analyze} />
      )}
      {stage === "breakdown" && (
        <BreakdownScreen status={analysisStatus} error={analysisError} title={clipTitle} phrases={phrases} clipSource={clipSource} selectedPhrase={selectedPhrase} setSelectedPhrase={setSelectedPhrase} onBack={() => go("source")} onContinue={() => go("shadow")} />
      )}
      {stage === "shadow" && (
        <RecordScreen kind="shadow" recording={recording} seconds={seconds} onRecord={() => setRecording((value) => !value)} onBack={() => go("breakdown")} onAnalyze={() => go("shadowFeedback")} phrases={phrases} selectedPhrase={selectedPhrase} />
      )}
      {stage === "shadowFeedback" && <FeedbackScreen kind="shadow" playing={playing} setPlaying={setPlaying} onRetry={() => go("shadow")} onContinue={() => go("improvise")} />}
      {stage === "improvise" && (
        <RecordScreen kind="improvise" recording={recording} seconds={seconds} onRecord={() => setRecording((value) => !value)} onBack={() => go("shadowFeedback")} onAnalyze={() => go("improvFeedback")} />
      )}
      {stage === "improvFeedback" && <FeedbackScreen kind="improvise" playing={playing} setPlaying={setPlaying} onRetry={() => go("improvise")} onContinue={() => go("complete")} />}
      {stage === "complete" && <CompleteScreen onAgain={() => go("source")} />}
      <BottomBar active="practice" />
    </div>
  );
}
