import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useBlocker, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BottomBar } from "@/components/cadence/BottomBar";
import { CompleteScreen } from "@/components/cadence/CompleteScreen";
import { FeedbackScreen } from "@/components/cadence/FeedbackScreen";
import { Header } from "@/components/cadence/Header";
import { PracticeScreen } from "@/components/cadence/PracticeScreen";
import { RecordScreen } from "@/components/cadence/RecordScreen";
import { SourceScreen, type SourceTab } from "@/components/cadence/SourceScreen";
import type { PracticePhrase, Stage } from "@/components/cadence/data";
import { useAnalysis } from "@/hooks/use-analysis";
import { useAuth } from "@/hooks/use-auth";
import type { ClipSource } from "@/hooks/use-clip-player";
import { useRecorder } from "@/hooks/use-recorder";
import { usePracticeSession } from "@/hooks/use-practice-session";
import { useTakeHistory } from "@/hooks/use-take-history";
import { youtubeId, type AnalysisSource, type SourceType } from "@/lib/analysis";
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
  const [sourceMode, setSourceMode] = useState<SourceType>("youtube");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState<"reference" | "you" | null>(null);
  const [selectedPhrase, setSelectedPhrase] = useState<PracticePhrase | null>(null);
  // When the current clip was requested, for the processing screen's progress bar.
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const fileRef = useRef<HTMLInputElement>(null);
  // Shadow takes come from the microphone; improvise still runs on the simulated timer.
  const recorder = useRecorder();
  const { analysis, status: analysisStatus, error: analysisError, submitting, start: startAnalysis, retry: retryAnalysis, open: openAnalysis } = useAnalysis();
  const { user } = useAuth();
  // Signed-in practice is saved to a session per clip; guests get none.
  const { sessionId, savedTakes } = usePracticeSession(analysis?.status === "ready" ? analysis.id : undefined);
  // Shadow takes for every phrase of the current clip: saved ones plus those submitted this visit.
  const history = useTakeHistory(analysis?.id, { sessionId, saved: savedTakes });
  const phrases = analysis?.view?.phrases ?? [];
  const clipTitle = analysis?.view?.title ?? analysis?.title ?? "Reference clip";

  // Uploads play from the file the user just picked. A saved session reopened
  // without the file plays the stored upload from a signed Storage URL.
  // Generated clips always play from Storage, for guests too, once the
  // worker has stored them.
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const generated = analysis?.source_type === "generated";
  const storedAudioPath = generated
    ? (analysis.status === "ready" ? analysis.audio_path : null)
    : analysis?.source_type === "upload" && !file && user ? analysis.audio_path : null;
  const { data: storedAudioUrl } = useQuery({
    queryKey: ["reference-audio", storedAudioPath],
    queryFn: () => referenceAudioUrl(storedAudioPath as string),
    enabled: Boolean(storedAudioPath),
    // Signed URLs expire after an hour.
    staleTime: 30 * 60 * 1000,
  });
  const storedUrl = storedAudioPath ? (storedAudioUrl ?? null) : null;
  const audioUrl = generated ? storedUrl : (fileUrl ?? storedUrl);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
  const videoId = analysis?.source_key.startsWith("youtube:") ? analysis.source_key.slice("youtube:".length) : youtubeId(url);
  const clipSource: ClipSource = analysis?.source_type === "upload" || generated
    ? (audioUrl ? { kind: "audio", url: audioUrl } : null)
    : videoId ? { kind: "youtube", videoId } : null;

  // Nothing saves a clip until it is ready, so leaving now loses it.
  const processing = stage === "breakdown" && analysisStatus === "processing";
  useBlocker({
    shouldBlockFn: () => !window.confirm("Your clip is still being prepared. Leave and lose it?"),
    enableBeforeUnload: () => processing,
    disabled: !processing,
  });

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  const go = (next: Stage) => {
    // An unsent shadow take doesn't survive leaving the Practice step.
    recorder.reset();
    // Feedback history belongs to one clip; Improvise → Back keeps it.
    if (next === "source") history.clear();
    setStage(next);
    setRecording(false);
    setPlaying(null);
    setSeconds(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const analyze = (source: AnalysisSource) => {
    setSelectedPhrase(null);
    setStartedAt(Date.now());
    startAnalysis(source);
    go("breakdown");
  };

  const retry = retryAnalysis && (() => {
    setStartedAt(Date.now());
    retryAnalysis();
  });

  // Reopen a saved clip on the Structure step; its takes load with the session.
  const resume = (session: PracticeSession) => {
    setSelectedPhrase(null);
    setSourceMode(session.sourceType);
    // The picked file (if any) belongs to another clip.
    setFile(null);
    setStartedAt(Date.now());
    openAnalysis(session.analysisId);
    go("breakdown");
  };

  return (
    <div className="min-h-screen bg-background text-foreground antialiased lg:pl-56">
      <Header stage={stage} />
      {stage === "source" && (
        <SourceScreen tab={sourceTab} setTab={setSourceTab} mode={sourceMode} setMode={setSourceMode} url={url} setUrl={setUrl} file={file} setFile={setFile} fileRef={fileRef} submitError={analysisStatus === "failed" ? analysisError : null} submitting={submitting} onBack={() => navigate({ to: "/" })} onContinue={analyze} onResume={resume} />
      )}
      {stage === "breakdown" && (
        <PracticeScreen analysisId={analysis?.status === "ready" ? analysis.id : undefined} status={analysisStatus} error={analysisError} title={clipTitle} phrases={phrases} clipSource={clipSource} kind={analysis?.source_type ?? sourceMode} voice={analysis?.generation?.voice_name ?? null} startedAt={startedAt} selectedPhrase={selectedPhrase} setSelectedPhrase={setSelectedPhrase} recorder={recorder} history={history} onBack={() => go("source")} onRetry={retry} onContinue={() => go("improvise")} />
      )}
      {stage === "improvise" && (
        <RecordScreen kind="improvise" recording={recording} seconds={seconds} onRecord={() => setRecording((value) => !value)} onBack={() => go("breakdown")} onAnalyze={() => go("improvFeedback")} />
      )}
      {stage === "improvFeedback" && <FeedbackScreen kind="improvise" playing={playing} setPlaying={setPlaying} onRetry={() => go("improvise")} onContinue={() => go("complete")} />}
      {stage === "complete" && <CompleteScreen onAgain={() => go("source")} />}
      <BottomBar active="practice" />
    </div>
  );
}
