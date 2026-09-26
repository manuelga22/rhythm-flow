import { ArrowRight, FileAudio, Link2, LoaderCircle, Play, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { validateSource, youtubeId, type AnalysisSource } from "@/lib/analysis";
import type { PracticeSession } from "@/lib/sessions";
import { ContinueSessions } from "./ContinueSessions";
import { BackButton } from "./primitives";
import { SignInPrompt } from "./SignInPrompt";

type SourceMode = AnalysisSource["kind"];
export type SourceTab = "new" | "continue";

const SAVE_PROMPT = { title: "Want to save your practice?", body: "Sign up or log in to save your practice sessions and continue them later." };

const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

export function SourceScreen({ tab, setTab, mode, setMode, url, setUrl, file, setFile, fileRef, submitError, submitting, onBack, onContinue, onResume }: { tab: SourceTab; setTab: (tab: SourceTab) => void; mode: SourceMode; setMode: (mode: SourceMode) => void; url: string; setUrl: (url: string) => void; file: File | null; setFile: (file: File | null) => void; fileRef: React.RefObject<HTMLInputElement | null>; submitError: string | null; submitting: boolean; onBack: () => void; onContinue: (source: AnalysisSource) => void; onResume: (session: PracticeSession) => void }) {
  const { user, loading } = useAuth();
  const source: AnalysisSource | null = mode === "youtube" ? { kind: "youtube", url } : file ? { kind: "upload", file } : null;
  const problem = source ? validateSource(source) : "Choose a WAV file to continue.";
  // Don't nag before the user has typed or picked anything.
  const showProblem = problem && (mode === "youtube" ? url.trim() !== "" : file !== null);
  const videoId = mode === "youtube" ? youtubeId(url) : null;

  const preview = mode === "youtube"
    ? { title: videoId ? "YouTube video" : "No video yet", detail: videoId ? `ID ${videoId}` : "Paste a link above" }
    : { title: file?.name ?? "No file yet", detail: file ? `WAV · ${formatSize(file.size)}` : "Choose a WAV file" };

  return (
    <main className="device-column px-5 pb-28 pt-6">
      <BackButton onClick={onBack} />
      <div className="mt-8 animate-rise">
        <p className="font-mono text-xs uppercase tracking-widest text-primary">01 · Source</p>
        <h1 className="mt-3 font-display text-5xl leading-none">CHOOSE A VOICE.</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">{tab === "new" ? "Paste a YouTube link or choose a clear WAV recording." : "Pick up a clip you've practiced before."}</p>
      </div>
      <div role="tablist" aria-label="Practice source" className="mt-6 grid grid-cols-2 rounded-2xl border border-ink/10 bg-card p-1">
        {(["new", "continue"] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`h-10 cursor-pointer rounded-xl text-sm font-medium transition-colors ${tab === value ? "bg-ink text-background" : "text-muted-foreground hover:text-foreground"}`}>
            {value === "new" ? "New clip" : "Continue"}
          </button>
        ))}
      </div>
      {tab === "continue" ? (
        <ContinueSessions className="mt-6" prompt={SAVE_PROMPT} onResume={onResume} onNew={() => setTab("new")} />
      ) : (
      <>
      {!loading && !user && <SignInPrompt className="mt-6" {...SAVE_PROMPT} />}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Button onClick={() => setMode("youtube")} variant="outline" className={`h-auto min-h-40 cursor-pointer flex-col items-stretch justify-start rounded-2xl border p-4 text-left shadow-none transition-colors ${mode === "youtube" ? "border-primary bg-primary/5" : "border-ink/15 bg-card hover:border-ink/30"}`}>
          <div style={{ whiteSpace: 'normal', overflowWrap: 'break-word', width: '100%' }}>
              <div className="flex items-center justify-between"><Link2 className="size-5" /><span className="font-mono text-[10px] uppercase tracking-widest">{mode === "youtube" ? "Selected" : "Select"}</span></div>
              <h2 className="mt-8 font-display text-2xl">YOUTUBE LINK</h2><p className="mt-1 text-sm text-muted-foreground">Paste a public video URL.</p>
          </div>
        </Button>
        <Button onClick={() => { setMode("upload"); fileRef.current?.click(); }} variant="outline" className={`h-auto min-h-40 cursor-pointer flex-col items-stretch justify-start rounded-2xl border p-4 text-left shadow-none transition-colors ${mode === "upload" ? "border-primary bg-primary/5" : "border-dashed border-ink/20 bg-card hover:border-ink/40"}`}>
          <div style={{ whiteSpace: 'normal', overflowWrap: 'break-word', width: '100%' }}>
              <div className="flex w-full items-center justify-between"><Upload className="size-5" /><span className="font-mono text-[10px] uppercase tracking-widest">WAV only</span></div>
              <h2 className="mt-8 font-display text-2xl">UPLOAD AUDIO</h2><p className="mt-1 text-sm text-muted-foreground">Choose a WAV file from your device.</p>
          </div>
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".wav,audio/wav,audio/x-wav"
          className="hidden"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            if (picked) setFile(picked);
            // Allow re-picking the same file after an error.
            event.target.value = "";
          }}
        />
      </div>
      <div className="mt-6 rounded-2xl border border-ink/10 bg-card p-5">
        <label htmlFor="source" className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{mode === "youtube" ? "Video URL" : "Selected file"}</label>
        {mode === "youtube" ? (
          <Input id="source" value={url} placeholder="https://youtube.com/watch?v=…" onChange={(event) => setUrl(event.target.value)} aria-invalid={Boolean(showProblem)} className="mt-2 h-12 rounded-xl border-ink/15 bg-background px-4 font-mono text-xs shadow-none" />
        ) : (
          <Button id="source" type="button" variant="outline" onClick={() => fileRef.current?.click()} className="mt-2 h-12 w-full justify-start rounded-xl border-ink/15 bg-background px-4 font-mono text-xs font-normal shadow-none">
            <FileAudio className="size-4" /><span className="truncate">{file?.name ?? "Choose a .wav file…"}</span>
          </Button>
        )}
        {showProblem && <p className="mt-2 text-xs text-destructive" role="alert">{problem}</p>}
        <div className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-t border-ink/10 pt-5">
          <div className="grid size-14 place-items-center rounded-xl bg-ink text-background"><Play className="size-5 fill-current" /></div>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">{preview.title}</p><p className="mt-1 truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{preview.detail}</p></div>
          {submitError && <p className="col-span-2 text-xs text-destructive" role="alert">{submitError}</p>}
          <Button onClick={() => source && onContinue(source)} disabled={Boolean(problem) || submitting} className="col-span-2 mt-2 h-13 w-full rounded-2xl bg-primary text-primary-foreground shadow-none">
            {submitting ? <><LoaderCircle className="animate-spin" /> Starting analysis</> : <>Analyze this clip <ArrowRight /></>}
          </Button>
        </div>
      </div>
      </>
      )}
    </main>
  );
}
