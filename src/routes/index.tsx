import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BarChart3, Check, Home, Link2, Mic, Pause, Play, RotateCcw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cadence — American English Prosody Studio" },
      { name: "description", content: "Practice natural American English rhythm, stress, intonation, and connected speech." },
      { property: "og:title", content: "Cadence — American English Prosody Studio" },
      { property: "og:description", content: "A focused studio for practicing natural rhythm and connected speech." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CadenceApp,
});

type Stage = "home" | "source" | "shadow" | "shadowFeedback" | "improvise" | "improvFeedback" | "complete";

const transcript = "That's the thing about natural speech — we don't stress every word. We let the small words slip into the next one.";
const waveA = [36,62,43,88,55,29,72,47,94,58,34,77,52,85,43,65,31,76,48,91,54,37,70,44,82,40,68,33,73,49];
const waveB = [42,70,39,91,61,35,79,50,96,64,40,81,55,89,49,71,34,72,52,87,60,41,75,48,78,45,63,37,69,54];

const stepLabels = ["Source", "Shadow", "Compare", "Improvise", "Complete"];
const stageStep: Record<Stage, number> = { home: 0, source: 0, shadow: 1, shadowFeedback: 2, improvise: 3, improvFeedback: 3, complete: 4 };

function CadenceApp() {
  const [stage, setStage] = useState<Stage>("home");
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
    <div className="min-h-screen bg-muted/60 py-0 text-foreground antialiased sm:py-5">
      <div className="relative mx-auto min-h-screen max-w-[430px] overflow-hidden bg-background sm:min-h-[900px] sm:rounded-[2.75rem] sm:border-[6px] sm:border-ink sm:shadow-2xl">
      <Header stage={stage} onHome={() => go("home")} />
      {stage === "home" && <Dashboard onStart={() => go("source")} />}
      {stage === "source" && (
        <SourceScreen mode={sourceMode} setMode={setSourceMode} url={url} setUrl={setUrl} fileRef={fileRef} onBack={() => go("home")} onContinue={() => go("shadow")} />
      )}
      {stage === "shadow" && (
        <RecordScreen kind="shadow" recording={recording} seconds={seconds} playing={playing} setPlaying={setPlaying} onRecord={() => setRecording((value) => !value)} onBack={() => go("source")} onAnalyze={() => go("shadowFeedback")} />
      )}
      {stage === "shadowFeedback" && <FeedbackScreen kind="shadow" playing={playing} setPlaying={setPlaying} onRetry={() => go("shadow")} onContinue={() => go("improvise")} />}
      {stage === "improvise" && (
        <RecordScreen kind="improvise" recording={recording} seconds={seconds} playing={playing} setPlaying={setPlaying} onRecord={() => setRecording((value) => !value)} onBack={() => go("shadowFeedback")} onAnalyze={() => go("improvFeedback")} />
      )}
      {stage === "improvFeedback" && <FeedbackScreen kind="improvise" playing={playing} setPlaying={setPlaying} onRetry={() => go("improvise")} onContinue={() => go("complete")} />}
      {stage === "complete" && <CompleteScreen onAgain={() => go("source")} onHome={() => go("home")} />}
      <BottomBar stage={stage} onHome={() => go("home")} onPractice={() => go(stage === "home" ? "source" : stage)} />
      </div>
    </div>
  );
}

function Header({ stage, onHome }: { stage: Stage; onHome: () => void }) {
  const step = stageStep[stage];
  return (
    <header className="sticky top-0 z-20 border-b border-ink/10 bg-background/95 backdrop-blur-md">
      <div className="grid h-7 grid-cols-[1fr_auto_1fr] items-center px-6 font-mono text-[9px] font-medium">
        <span>9:41</span><span className="h-1.5 w-20 rounded-full bg-ink/90" /><span className="text-right">● ▮▮▮</span>
      </div>
      <div className="grid h-14 grid-cols-[minmax(0,1fr)_auto] items-center px-5">
        <button onClick={onHome} className="flex cursor-pointer items-baseline gap-2" aria-label="Cadence home">
          <span className="font-display text-xl">CADENCE</span>
        </button>
        {stage !== "home" && (
          <div className="flex items-center gap-1.5" aria-label={`${stepLabels[step]} step`}>
            {stepLabels.map((label, index) => (
              <span key={label} title={label} className={`h-1.5 rounded-full transition-all ${index === step ? "w-7 bg-primary" : index < step ? "w-2 bg-accent" : "w-2 bg-ink/15"}`} />
            ))}
          </div>
        )}
      </div>
    </header>
  );
}

function Dashboard({ onStart }: { onStart: () => void }) {
  return (
    <main className="px-5 pb-28 pt-10">
      <section className="border-b border-ink/10 pb-10">
        <div className="animate-rise">
          <p className="font-mono text-xs uppercase tracking-widest text-primary">Your voice, in motion</p>
          <h1 className="mt-4 font-display text-[3.45rem] leading-[0.98]">SOUND NATURAL<br />BEYOND THE WORDS.</h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">Train the rhythm, stress, and melody that fluent speakers use when words become conversation.</p>
          <Button onClick={onStart} size="lg" className="mt-8 h-14 w-full rounded-2xl bg-primary px-6 text-primary-foreground shadow-none hover:bg-primary/90">Start practice <ArrowRight /></Button>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3">
          <Metric label="Last rhythm match" value="82" suffix="/100" dark />
          <Metric label="Sessions" value="14" suffix="total" />
          <div className="col-span-2 rounded-2xl border border-accent/25 bg-accent/10 p-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent">Last improvement</p>
            <p className="mt-2 text-sm font-medium">Your phrase-final intonation was 12% closer to the reference.</p>
          </div>
        </div>
      </section>
      <section className="grid gap-7 py-9">
        <div><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">01 · Choose</p><h2 className="mt-2 font-display text-2xl">BRING A VOICE</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Use a short video or audio clip from a speaker you want to sound more like.</p></div>
        <div><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">02 · Shadow</p><h2 className="mt-2 font-display text-2xl">MATCH THE MUSIC</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Mirror the whole phrase: its strong beats, reductions, links, pauses, and pitch.</p></div>
        <div><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">03 · Improvise</p><h2 className="mt-2 font-display text-2xl">MAKE IT YOURS</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Remove the script and carry the same natural rhythm into your own words.</p></div>
      </section>
    </main>
  );
}

function SourceScreen({ mode, setMode, url, setUrl, fileRef, onBack, onContinue }: { mode: "youtube" | "upload"; setMode: (mode: "youtube" | "upload") => void; url: string; setUrl: (url: string) => void; fileRef: React.RefObject<HTMLInputElement | null>; onBack: () => void; onContinue: () => void }) {
  return (
    <main className="px-5 pb-28 pt-6">
      <BackButton onClick={onBack} />
      <div className="mt-8 animate-rise">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">01 · Source</p>
        <h1 className="mt-3 font-display text-5xl leading-none">CHOOSE A VOICE.</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">Pick a clear, conversational clip between 5 and 20 seconds.</p>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-3">
        <button onClick={() => setMode("youtube")} className={`min-h-40 cursor-pointer rounded-2xl border p-4 text-left transition-colors ${mode === "youtube" ? "border-primary bg-primary/5" : "border-ink/15 bg-card hover:border-ink/30"}`}>
          <div className="flex items-center justify-between"><Link2 className="size-5" /><span className="font-mono text-[10px] uppercase tracking-widest">{mode === "youtube" ? "Selected" : "Select"}</span></div>
          <h2 className="mt-8 font-display text-2xl">YOUTUBE LINK</h2><p className="mt-1 text-sm text-muted-foreground">Paste a public video URL.</p>
        </button>
        <button onClick={() => { setMode("upload"); fileRef.current?.click(); }} className={`min-h-40 cursor-pointer rounded-2xl border p-4 text-left transition-colors ${mode === "upload" ? "border-primary bg-primary/5" : "border-dashed border-ink/20 bg-card hover:border-ink/40"}`}>
          <div className="flex items-center justify-between"><Upload className="size-5" /><span className="font-mono text-[10px] uppercase tracking-widest">MP3 · WAV · MP4</span></div>
          <h2 className="mt-8 font-display text-2xl">UPLOAD MEDIA</h2><p className="mt-1 text-sm text-muted-foreground">Choose audio or video from your device.</p>
        </button>
        <input ref={fileRef} type="file" accept="audio/*,video/*" className="hidden" />
      </div>
      <div className="mt-6 rounded-2xl border border-ink/10 bg-card p-5">
        <label htmlFor="source" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{mode === "youtube" ? "Video URL" : "Selected file"}</label>
        <Input id="source" value={mode === "youtube" ? url : "weekend-interview.mp3"} onChange={(event) => setUrl(event.target.value)} readOnly={mode === "upload"} className="mt-2 h-12 rounded-xl border-ink/15 bg-background px-4 font-mono text-xs shadow-none" />
        <div className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-t border-ink/10 pt-5">
          <div className="grid size-14 place-items-center rounded-xl bg-ink text-background"><Play className="size-5 fill-current" /></div>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">How creative work changes under pressure</p><p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">0:42–0:54 · 12 sec · Conversational</p></div>
          <Button onClick={onContinue} className="col-span-2 mt-2 h-13 w-full rounded-2xl bg-primary text-primary-foreground shadow-none">Use this clip <ArrowRight /></Button>
        </div>
      </div>
    </main>
  );
}

function RecordScreen({ kind, recording, seconds, playing, setPlaying, onRecord, onBack, onAnalyze }: { kind: "shadow" | "improvise"; recording: boolean; seconds: number; playing: "reference" | "you" | null; setPlaying: (value: "reference" | "you" | null) => void; onRecord: () => void; onBack: () => void; onAnalyze: () => void }) {
  const isShadow = kind === "shadow";
  const hasTake = seconds > 0;
  return (
    <main className="px-5 pb-28 pt-5">
      <BackButton onClick={onBack} />
      <div className="mt-5 grid gap-5">
        <section className="animate-rise rounded-3xl bg-ink p-5 text-background">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5"><span className={`size-2.5 rounded-full ${recording ? "animate-record bg-primary" : "bg-background/30"}`} /><span className={`font-mono text-xs uppercase tracking-widest ${recording ? "text-primary" : "text-background/50"}`}>{recording ? "Recording" : hasTake ? "Take ready" : "Ready"}</span></div>
            <span className="font-mono text-lg tabular-nums">00:{String(seconds).padStart(2, "0")} / 00:{isShadow ? "12" : "30"}</span>
          </div>
          <div className="mt-8">
            <Waveform bars={hasTake || recording ? waveA : waveA.map(() => 7)} tone="primary" tall />
            <div className="mt-3 flex justify-between font-mono text-[10px] uppercase tracking-widest text-background/40"><span>You</span><span>{isShadow ? "Match the reference" : "Explain it your way"}</span></div>
          </div>
          {isShadow ? (
            <div className="mt-8 rounded-xl border border-background/10 bg-background/5 p-4">
              <span className="font-mono text-[10px] uppercase tracking-widest text-background/50">Transcript · bold words carry the beat</span>
              <p className="mt-2 text-lg leading-relaxed text-background/85">“That's the thing about <strong className="text-background">natural speech</strong> — we don't <span className="text-caution">stress every word</span>. We let the <strong className="text-background">small words</strong> <span className="text-accent underline decoration-accent/50 underline-offset-4">slip into</span> the next one.”</p>
            </div>
          ) : (
            <div className="mt-8 min-h-32 rounded-xl border border-dashed border-background/20 p-5 text-center">
              <X className="mx-auto size-5 text-background/40" /><p className="mt-3 font-display text-2xl">NO SCRIPT THIS TIME.</p><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-background/55">Explain the same idea in your own words. Keep the relaxed rhythm and let small words stay small.</p>
            </div>
          )}
          <div className="mt-7 flex flex-col items-center">
            <Button onClick={onRecord} aria-label={recording ? "Stop recording" : "Start recording"} className={`size-20 rounded-full border-4 border-background/15 p-0 shadow-none ${recording ? "bg-background text-foreground hover:bg-background/90" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>{recording ? <Pause className="size-7" /> : <Mic className="size-7" />}</Button>
            <span className="mt-3 font-mono text-[10px] uppercase tracking-widest text-background/50">{recording ? "Tap to stop" : hasTake ? "Tap to record again" : "Tap to record"}</span>
            {hasTake && !recording && <Button onClick={onAnalyze} className="mt-5 h-12 w-full rounded-2xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">See feedback <ArrowRight /></Button>}
          </div>
        </section>
        <aside className="space-y-5">
          <section className="rounded-3xl border border-ink/10 p-5">
            <p className="font-mono text-[10px] uppercase tracking-widest text-primary">{isShadow ? "Reference" : "Idea to paraphrase"}</p>
            <h2 className="mt-2 font-display text-3xl">{isShadow ? "LISTEN FOR THE BEATS." : "KEEP THE MEANING."}</h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{isShadow ? "Notice how the speaker compresses the words between the main stresses." : "Natural speech does not give every word equal weight; smaller words connect into the stronger ones."}</p>
            <Button onClick={() => setPlaying(playing === "reference" ? null : "reference")} variant="outline" className="mt-5 h-11 w-full rounded-xl border-ink/15 bg-transparent shadow-none"><Play className={playing === "reference" ? "fill-current" : ""} /> {playing === "reference" ? "Pause reference" : "Play reference"}</Button>
            <div className="mt-4"><Waveform bars={waveB} tone="ink" /></div>
          </section>
          <section className="rounded-3xl border border-accent/25 bg-accent/10 p-5"><p className="font-mono text-[10px] uppercase tracking-widest text-accent">Listen for</p><ul className="mt-3 space-y-2 text-sm"><li>Strong beats on <strong>natural, stress, small, next</strong></li><li>A short pause after <strong>speech</strong></li><li>A low, finished pitch on <strong>one</strong></li></ul></section>
        </aside>
      </div>
    </main>
  );
}

function FeedbackScreen({ kind, playing, setPlaying, onRetry, onContinue }: { kind: "shadow" | "improvise"; playing: "reference" | "you" | null; setPlaying: (value: "reference" | "you" | null) => void; onRetry: () => void; onContinue: () => void }) {
  const improv = kind === "improvise";
  const score = improv ? 78 : 82;
  return (
    <main className="px-5 pb-28 pt-5">
      <div className="grid grid-cols-3 gap-3">
        <Metric label={improv ? "Natural rhythm" : "Rhythm match"} value={String(score)} suffix="/100" dark />
        <Metric label="Stress timing" value={improv ? "76" : "84"} suffix="%" accent />
        <Metric label="Intonation" value={improv ? "81" : "73"} suffix="%" caution />
      </div>
      <div className="mt-5 grid gap-5">
        <section className="animate-rise rounded-3xl bg-ink p-5 text-background">
          <div><p className="font-mono text-[10px] uppercase tracking-widest text-primary">{improv ? "Spontaneous speech" : "Reference comparison"}</p><h1 className="mt-2 font-display text-4xl leading-none">{improv ? "THE RHYTHM HELD." : "CLOSE. NOW SHAPE IT."}</h1><div className="mt-4 flex gap-2"><AudioButton label="Reference" active={playing === "reference"} onClick={() => setPlaying(playing === "reference" ? null : "reference")} /><AudioButton label="You" active={playing === "you"} onClick={() => setPlaying(playing === "you" ? null : "you")} /></div></div>
          <div className="mt-8 space-y-5">
            <Timeline label="REF" bars={waveB} tone="light" markers={["natural", "stress", "small", "next"]} />
            <Timeline label="YOU" bars={waveA} tone="primary" markers={improv ? ["usually", "emphasize", "meaning", "connect"] : ["natural", "stress", "small", "next"]} />
          </div>
          <div className="mt-7 rounded-xl border border-background/10 bg-background/5 p-4">
            <div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-widest text-background/50">{improv ? "Your transcript" : "Stress map"}</span><span className="font-mono text-[10px] text-background/40">● stress · ↗ rise · ↘ fall</span></div>
            <p className="mt-3 text-base leading-8 text-background/80">{improv ? <>“Usually we <strong className="text-caution">emphasize</strong> the words that carry the <strong>meaning</strong>, and the rest can <span className="text-accent underline underline-offset-4">connect together</span> more easily.” <span className="text-primary">↘</span></> : <>“That's the thing about <strong>natural speech</strong> — we don't <span className="rounded bg-caution/20 px-1 text-caution">stress every word</span>. We let the <strong>small words</strong> <span className="text-accent underline underline-offset-4">slip into</span> the next one. <span className="text-primary">↘</span>”</>}</p>
          </div>
          <div className="mt-6 grid grid-cols-[auto_1fr] gap-3"><Button onClick={onRetry} variant="outline" aria-label="Try again" className="size-12 rounded-2xl border-background/20 bg-transparent p-0 text-background shadow-none hover:bg-background/10 hover:text-background"><RotateCcw /></Button><Button onClick={onContinue} className="h-12 rounded-2xl bg-primary text-primary-foreground shadow-none hover:bg-primary/90">{improv ? "Complete session" : "Improvise the idea"} <ArrowRight /></Button></div>
        </section>
        <aside className="space-y-5">
          <section className="rounded-3xl border border-ink/10 p-5"><div className="flex items-center gap-2"><span className="font-mono text-xs text-primary">03</span><h2 className="font-display text-3xl">COACHING</h2></div><ol className="mt-5 space-y-5">
            {(improv ? [
              ["Keep", "the relaxed pace you found in the middle phrase — it sounded conversational."],
              ["Reduce", "“the words that” a little more so “carry the meaning” becomes the clear focus."],
              ["Finish", "with the same confident pitch drop you used in the reference."],
            ] : [
              ["Soften", "“every” — it received more weight than the reference and slowed the phrase."],
              ["Link", "“slip into” as one breath unit, with no reset before “into.”"],
              ["Fall", "after “one” — close the thought with a lower, steadier pitch."],
            ]).map(([lead, copy], index) => <li key={lead} className="flex gap-3"><span className={`mt-0.5 font-mono text-xs ${index === 0 ? "text-caution" : index === 1 ? "text-accent" : "text-primary"}`}>{index + 1}</span><p className="text-sm leading-relaxed"><strong>{lead}</strong> {copy}</p></li>)}
          </ol></section>
          <section className="rounded-3xl border border-ink/10 p-5"><p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Timing notes</p><div className="mt-4 space-y-3 text-sm"><DataRow label="Speech rate" value={improv ? "146 wpm" : "151 wpm"} /><DataRow label="Longest pause" value={improv ? "0.5 sec" : "0.7 sec"} /><DataRow label="Pitch range" value={improv ? "118 Hz" : "104 Hz"} /></div></section>
        </aside>
      </div>
    </main>
  );
}

function CompleteScreen({ onAgain, onHome }: { onAgain: () => void; onHome: () => void }) {
  return (
    <main className="px-5 pb-28 pt-10 text-center">
      <div className="animate-rise"><div className="mx-auto grid size-14 place-items-center rounded-full bg-accent text-accent-foreground"><Check className="size-6" /></div><p className="mt-6 font-mono text-xs uppercase tracking-widest text-accent">Session complete · 6 min</p><h1 className="mt-3 font-display text-6xl sm:text-7xl">YOU KEPT THE BEAT.</h1><p className="mx-auto mt-5 max-w-lg leading-relaxed text-muted-foreground">Your spontaneous speech preserved the reference's phrasing and final pitch drop. That transfer is the skill that matters.</p></div>
      <div className="mt-10 grid grid-cols-3 gap-2 text-left"><Metric label="Shadow" value="82" suffix="/100" dark /><Metric label="Improvise" value="78" suffix="/100" accent /><Metric label="Strongest" value="Pitch" suffix="fall" caution /></div>
      <section className="mt-6 rounded-3xl border border-ink/10 p-6 text-left"><p className="font-mono text-[10px] uppercase tracking-widest text-primary">Next focus</p><h2 className="mt-2 font-display text-3xl">REDUCE THE WORDS BETWEEN THE BEATS.</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">In your next session, keep function words lighter so the important words can carry the rhythm without extra effort.</p></section>
      <div className="mt-8 grid gap-3"><Button onClick={onAgain} className="h-14 rounded-2xl bg-primary px-6 text-primary-foreground shadow-none">Practice another clip <ArrowRight /></Button><Button onClick={onHome} variant="ghost" className="h-11 rounded-xl text-muted-foreground shadow-none">Back to home</Button></div>
    </main>
  );
}

function Metric({ label, value, suffix, dark, accent, caution }: { label: string; value: string; suffix: string; dark?: boolean; accent?: boolean; caution?: boolean }) {
  const tone = dark ? "bg-ink text-background" : accent ? "border-accent/25 bg-accent/10 text-accent" : caution ? "border-caution/30 bg-caution/10 text-caution" : "border-ink/10 bg-card";
  return <div className={`min-w-0 rounded-2xl border border-transparent p-4 ${tone}`}><p className="truncate font-mono text-[9px] uppercase tracking-widest opacity-65 sm:text-[10px]">{label}</p><div className="mt-1 flex items-baseline gap-1"><span className="font-display text-3xl sm:text-4xl">{value}</span><span className="font-mono text-[10px] opacity-60 sm:text-xs">{suffix}</span></div></div>;
}

function Waveform({ bars, tone, tall }: { bars: number[]; tone: "primary" | "ink"; tall?: boolean }) {
  return <div className={`flex items-center gap-[3px] ${tall ? "h-28" : "h-14"}`} aria-label="Audio waveform">{bars.map((height, index) => <span key={index} className={`w-full rounded-sm ${tone === "primary" ? "bg-primary/80" : "bg-ink/50"}`} style={{ height: `${height}%` }} />)}</div>;
}

function Timeline({ label, bars, tone, markers }: { label: string; bars: number[]; tone: "light" | "primary"; markers: string[] }) {
  return <div className="grid grid-cols-[42px_1fr] items-center gap-3"><span className={`font-mono text-[10px] ${tone === "primary" ? "text-primary" : "text-background/50"}`}>{label}</span><div><div className="flex h-14 items-center gap-[3px]">{bars.map((height, index) => <span key={index} className={`w-full rounded-sm ${tone === "primary" ? "bg-primary/75" : "bg-background/35"}`} style={{ height: `${height}%` }} />)}</div><div className="mt-1 grid grid-cols-4 font-mono text-[9px] text-background/40">{markers.map((word) => <span key={word}>{word}</span>)}</div></div></div>;
}

function AudioButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <Button onClick={onClick} variant="outline" size="sm" className="rounded-full border-background/20 bg-transparent text-background shadow-none hover:bg-background/10 hover:text-background">{active ? <Pause /> : <Play />} {label}</Button>;
}

function BackButton({ onClick }: { onClick: () => void }) { return <Button onClick={onClick} variant="ghost" size="sm" className="-ml-3 rounded-full text-muted-foreground hover:bg-ink/5"><ArrowLeft /> Back</Button>; }
function DataRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between border-b border-ink/10 pb-3 last:border-0 last:pb-0"><span className="text-muted-foreground">{label}</span><span className="font-mono text-xs">{value}</span></div>; }

function BottomBar({ stage, onHome, onPractice }: { stage: Stage; onHome: () => void; onPractice: () => void }) {
  return (
    <nav className="fixed bottom-3 left-1/2 z-30 grid w-[calc(100%-1.5rem)] max-w-[400px] -translate-x-1/2 grid-cols-3 rounded-[1.4rem] border border-ink/10 bg-card/95 px-3 pb-[max(0.7rem,env(safe-area-inset-bottom))] pt-2 shadow-lg backdrop-blur-md" aria-label="App navigation">
      <Button onClick={onHome} variant="ghost" className={`h-12 flex-col gap-0.5 rounded-xl text-[9px] ${stage === "home" ? "text-primary" : "text-muted-foreground"}`}><Home className="size-5" />Home</Button>
      <Button onClick={onPractice} variant="ghost" className={`h-12 flex-col gap-0.5 rounded-xl text-[9px] ${stage !== "home" && stage !== "complete" ? "text-primary" : "text-muted-foreground"}`}><Mic className="size-5" />Practice</Button>
      <Button variant="ghost" className="h-12 flex-col gap-0.5 rounded-xl text-[9px] text-muted-foreground"><BarChart3 className="size-5" />Progress</Button>
    </nav>
  );
}
