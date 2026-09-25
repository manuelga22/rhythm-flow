import { ArrowRight, Link2, Play, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BackButton } from "./primitives";

export function SourceScreen({ mode, setMode, url, setUrl, fileRef, onBack, onContinue }: { mode: "youtube" | "upload"; setMode: (mode: "youtube" | "upload") => void; url: string; setUrl: (url: string) => void; fileRef: React.RefObject<HTMLInputElement | null>; onBack: () => void; onContinue: () => void }) {
  return (
    <main className="device-column px-5 pb-28 pt-6">
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
