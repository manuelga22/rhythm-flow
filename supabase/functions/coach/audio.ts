/**
 * Checks on the learner's take before it reaches the model. Models happily
 * "hear" rhythm in silence, so a take with no voice in it never gets that
 * far. Pure, so it is tested without the network (audio_test.ts).
 */

import { decodeBase64 } from "jsr:@std/encoding@1/base64";

/** Shorter than this and there is nothing to compare. */
export const MIN_SECONDS = 0.4;
/** Peak level, 0 to 1, below which a take is treated as silent (about -34 dBFS). */
export const SILENCE_PEAK = 0.02;

export type TakeLevel = { seconds: number; peak: number };

/**
 * Length and loudest sample of a PCM16 WAV, as the browser encodes takes
 * (src/lib/wav.ts). Throws on anything else.
 */
export function measureWav(base64: string): TakeLevel {
  const bytes = decodeBase64(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("take is not a WAV file");

  // Walk the chunks rather than assume a 44-byte header.
  let offset = 12;
  let rate = 0;
  let bits = 0;
  let channels = 0;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (view.getUint16(body, true) !== 1) throw new Error("take is not PCM");
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      if (bits !== 16 || !rate || !channels) throw new Error("take is not 16-bit PCM");
      const end = Math.min(bytes.length, body + size);
      let peak = 0;
      for (let at = body; at + 1 < end; at += 2) peak = Math.max(peak, Math.abs(view.getInt16(at, true)));
      return { seconds: (end - body) / (2 * channels * rate), peak: peak / 32768 };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("take has no audio data");
}

/** Why a take can't be coached, in the coach's voice, or null when it can. */
export function unusableTake({ seconds, peak }: TakeLevel): string | null {
  if (peak < SILENCE_PEAK) return "I couldn't hear you in that take. Check your microphone and try again, a little closer.";
  if (seconds < MIN_SECONDS) return "That take was too short for me to compare. Say the whole phrase and try again.";
  return null;
}
