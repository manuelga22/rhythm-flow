import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderStatus = "idle" | "requesting" | "recording" | "ready" | "error";

export type Take = {
  blob: Blob;
  url: string;
  /** Seconds. */
  duration: number;
  /** Waveform bar heights, 0–100. */
  peaks: number[];
};

const BAR_COUNT = 30;
const SAMPLE_MS = 120;
const FLAT = 7;

/**
 * Record one take from the microphone.
 * Live `levels` feed a waveform while recording; the finished take carries
 * an object URL for playback and peaks decoded from the audio itself.
 */
export function useRecorder({ maxSeconds = 120 }: { maxSeconds?: number } = {}) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => flatBars());
  const [take, setTake] = useState<Take | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const takeUrlRef = useRef<string | null>(null);
  // Bumped by reset/start so a stop that finishes late doesn't resurrect a discarded take.
  const generationRef = useRef(0);

  const releaseInputs = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => {});
    contextRef.current = null;
  }, []);

  const dropTake = useCallback(() => {
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    setTake(null);
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    releaseInputs();
    dropTake();
    setElapsed(0);
    setLevels(flatBars());
    setError(null);
    setStatus("idle");
  }, [dropTake, releaseInputs]);

  const start = useCallback(async () => {
    reset();
    const generation = generationRef.current;
    if (typeof window === "undefined" || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Recording needs a secure (https) connection.");
      setStatus("error");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("This browser can't record audio.");
      setStatus("error");
      return;
    }

    setStatus("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      if (generation !== generationRef.current) return;
      setError(microphoneError(err));
      setStatus("error");
      return;
    }
    if (generation !== generationRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    streamRef.current = stream;
    const context = new AudioContext();
    contextRef.current = context;
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    const startedAt = performance.now();
    recorder.onstop = async () => {
      // reset() already released a discarded take's inputs, and they may now belong to a newer take.
      if (generation !== generationRef.current) return;
      const seconds = (performance.now() - startedAt) / 1000;
      releaseInputs();
      recorderRef.current = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || "audio/webm" });
      const decoded = await decodePeaks(blob);
      if (generation !== generationRef.current) return;
      const url = URL.createObjectURL(blob);
      takeUrlRef.current = url;
      setTake({ blob, url, duration: decoded?.duration ?? seconds, peaks: decoded?.peaks ?? flatBars() });
      setElapsed(decoded?.duration ?? seconds);
      setStatus("ready");
    };

    recorder.start();
    setStatus("recording");
    timerRef.current = window.setInterval(() => {
      const seconds = (performance.now() - startedAt) / 1000;
      setElapsed(seconds);
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      setLevels((bars) => [...bars.slice(1), toBar(peak)]);
      if (seconds >= maxSeconds) stop();
    }, SAMPLE_MS);
  }, [maxSeconds, releaseInputs, reset, stop]);

  useEffect(() => () => {
    generationRef.current += 1;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    releaseInputs();
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
  }, [releaseInputs]);

  return { status, error, elapsed, levels, take, start, stop, reset };
}

function flatBars() {
  return Array.from({ length: BAR_COUNT }, () => FLAT);
}

/** Map a 0–1 amplitude onto a bar height with a floor so silence still shows. */
function toBar(amplitude: number) {
  return Math.round(FLAT + Math.min(1, amplitude * 1.6) * (100 - FLAT));
}

async function decodePeaks(blob: Blob): Promise<{ duration: number; peaks: number[] } | null> {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const data = buffer.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / BAR_COUNT));
    const raw = Array.from({ length: BAR_COUNT }, (_, bar) => {
      let peak = 0;
      for (let i = bar * size; i < Math.min(data.length, (bar + 1) * size); i++) peak = Math.max(peak, Math.abs(data[i] ?? 0));
      return peak;
    });
    const loudest = Math.max(...raw, 1e-3);
    return { duration: buffer.duration, peaks: raw.map((peak) => Math.round(FLAT + (peak / loudest) * (100 - FLAT))) };
  } catch {
    return null;
  } finally {
    void context.close().catch(() => {});
  }
}

function microphoneError(err: unknown) {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access was blocked. Allow it in your browser settings and try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found.";
  if (name === "NotReadableError") return "Your microphone is in use by another app.";
  return "Couldn't start the microphone.";
}
