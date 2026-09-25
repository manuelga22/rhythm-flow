import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { loadYouTubeApi, YT_STATE, type YTPlayer } from "@/lib/youtube-iframe";

export type ClipSource = { kind: "audio"; url: string } | { kind: "youtube"; videoId: string } | null;
export type ClipPlayerStatus = "idle" | "loading" | "ready" | "error";
export type ClipRange = { start: number; end: number };

/** What each backend (HTML audio, YouTube embed) has to provide. */
type Backend = {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  time(): number;
  destroy(): void;
};

type BackendEvents = {
  onReady(duration: number): void;
  onPlayingChange(playing: boolean): void;
  onEnded(): void;
  onError(): void;
};

function createAudioBackend(url: string, events: BackendEvents): Backend {
  const audio = new Audio();
  audio.preload = "auto";
  audio.addEventListener("loadedmetadata", () => events.onReady(audio.duration));
  audio.addEventListener("play", () => events.onPlayingChange(true));
  audio.addEventListener("pause", () => events.onPlayingChange(false));
  audio.addEventListener("ended", () => events.onEnded());
  audio.addEventListener("error", () => events.onError());
  audio.src = url;
  return {
    play: () => void audio.play().catch(() => events.onPlayingChange(false)),
    pause: () => audio.pause(),
    seek: (seconds) => { audio.currentTime = seconds; },
    time: () => audio.currentTime,
    destroy: () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    },
  };
}

function createYouTubeBackend(videoId: string, mount: HTMLElement, events: BackendEvents, isCancelled: () => boolean): Backend {
  // The API replaces its target element with an iframe, so give it a child
  // node React doesn't own.
  const target = document.createElement("div");
  mount.replaceChildren(target);
  let player: YTPlayer | null = null;

  loadYouTubeApi()
    .then((YT) => {
      if (isCancelled()) return;
      new YT.Player(target, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { controls: 0, playsinline: 1, rel: 0, modestbranding: 1, disablekb: 1 },
        events: {
          onReady: ({ target: ready }) => {
            player = ready;
            events.onReady(ready.getDuration());
          },
          onStateChange: ({ data, target: current }) => {
            if (data === YT_STATE.PLAYING) {
              events.onReady(current.getDuration());
              events.onPlayingChange(true);
            } else if (data === YT_STATE.ENDED) {
              events.onEnded();
            } else if (data === YT_STATE.PAUSED || data === YT_STATE.CUED) {
              events.onPlayingChange(false);
            }
          },
          onError: () => events.onError(),
        },
      });
    })
    .catch(() => events.onError());

  return {
    play: () => player?.playVideo(),
    pause: () => player?.pauseVideo(),
    seek: (seconds) => player?.seekTo(seconds, true),
    time: () => player?.getCurrentTime() ?? 0,
    destroy: () => {
      player?.destroy();
      mount.replaceChildren();
    },
  };
}

/**
 * Plays a reference clip from an audio URL or a YouTube embed and reports
 * its position every animation frame, so phrase highlighting and
 * single-phrase playback (playRange) stay in step with the audio.
 */
export function useClipPlayer(source: ClipSource, youtubeMount: RefObject<HTMLElement | null>) {
  const [status, setStatus] = useState<ClipPlayerStatus>("idle");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<ClipRange | null>(null);
  const backendRef = useRef<Backend | null>(null);
  const rangeRef = useRef<ClipRange | null>(null);

  const setActiveRange = useCallback((next: ClipRange | null) => {
    rangeRef.current = next;
    setRange(next);
  }, []);

  const sourceKey = source ? `${source.kind}:${source.kind === "audio" ? source.url : source.videoId}` : null;

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setActiveRange(null);
    if (!source) {
      setStatus("idle");
      return;
    }
    setStatus("loading");

    let cancelled = false;
    const events: BackendEvents = {
      onReady: (seconds) => {
        if (cancelled) return;
        if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds);
        setStatus("ready");
      },
      onPlayingChange: (next) => {
        if (cancelled) return;
        setPlaying(next);
        if (!next && backendRef.current) setCurrentTime(backendRef.current.time());
      },
      onEnded: () => {
        if (cancelled) return;
        setPlaying(false);
        setActiveRange(null);
        if (backendRef.current) setCurrentTime(backendRef.current.time());
      },
      onError: () => {
        if (!cancelled) setStatus("error");
      },
    };

    const mount = youtubeMount.current;
    if (source.kind === "audio") {
      backendRef.current = createAudioBackend(source.url, events);
    } else if (mount) {
      backendRef.current = createYouTubeBackend(source.videoId, mount, events, () => cancelled);
    } else {
      setStatus("error");
    }

    return () => {
      cancelled = true;
      backendRef.current?.destroy();
      backendRef.current = null;
    };
    // sourceKey captures every change to `source` that needs a new backend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  // Follow the playhead while playing, and stop at the end of a phrase range.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const backend = backendRef.current;
      if (!backend) return;
      const time = backend.time();
      setCurrentTime(time);
      const active = rangeRef.current;
      if (active && time >= active.end) {
        backend.pause();
        setActiveRange(null);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, setActiveRange]);

  const seek = useCallback((seconds: number) => {
    const backend = backendRef.current;
    if (!backend) return;
    const clamped = Math.max(0, duration ? Math.min(seconds, duration) : seconds);
    backend.seek(clamped);
    setCurrentTime(clamped);
  }, [duration]);

  const play = useCallback(() => {
    const backend = backendRef.current;
    if (!backend) return;
    setActiveRange(null);
    if (duration && backend.time() >= duration - 0.05) seek(0);
    backend.play();
  }, [duration, seek, setActiveRange]);

  const pause = useCallback(() => {
    setActiveRange(null);
    backendRef.current?.pause();
  }, [setActiveRange]);

  const playRange = useCallback((start: number, end: number) => {
    const backend = backendRef.current;
    if (!backend) return;
    setActiveRange({ start, end });
    seek(start);
    backend.play();
  }, [seek, setActiveRange]);

  return { status, playing, currentTime, duration, range, play, pause, seek, playRange };
}
