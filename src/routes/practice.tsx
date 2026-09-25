import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { BottomBar } from "@/components/cadence/BottomBar";
import { CompleteScreen } from "@/components/cadence/CompleteScreen";
import { FeedbackScreen } from "@/components/cadence/FeedbackScreen";
import { Header } from "@/components/cadence/Header";
import { RecordScreen } from "@/components/cadence/RecordScreen";
import { SourceScreen } from "@/components/cadence/SourceScreen";
import type { Stage } from "@/components/cadence/data";

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
  const [url, setUrl] = useState("https://youtube.com/watch?v=prosody-0142");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState<"reference" | "you" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <Header stage={stage} />
      {stage === "source" && (
        <SourceScreen mode={sourceMode} setMode={setSourceMode} url={url} setUrl={setUrl} fileRef={fileRef} onBack={() => navigate({ to: "/" })} onContinue={() => go("shadow")} />
      )}
      {stage === "shadow" && (
        <RecordScreen kind="shadow" recording={recording} seconds={seconds} playing={playing} setPlaying={setPlaying} onRecord={() => setRecording((value) => !value)} onBack={() => go("source")} onAnalyze={() => go("shadowFeedback")} />
      )}
      {stage === "shadowFeedback" && <FeedbackScreen kind="shadow" playing={playing} setPlaying={setPlaying} onRetry={() => go("shadow")} onContinue={() => go("improvise")} />}
      {stage === "improvise" && (
        <RecordScreen kind="improvise" recording={recording} seconds={seconds} playing={playing} setPlaying={setPlaying} onRecord={() => setRecording((value) => !value)} onBack={() => go("shadowFeedback")} onAnalyze={() => go("improvFeedback")} />
      )}
      {stage === "improvFeedback" && <FeedbackScreen kind="improvise" playing={playing} setPlaying={setPlaying} onRetry={() => go("improvise")} onContinue={() => go("complete")} />}
      {stage === "complete" && <CompleteScreen onAgain={() => go("source")} />}
      <BottomBar active="practice" />
    </div>
  );
}
