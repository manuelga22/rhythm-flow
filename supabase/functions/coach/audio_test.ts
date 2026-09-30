// Run with: npx deno test supabase/functions/coach/

import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { measureWav, unusableTake } from "./audio.ts";

/** A 16 kHz mono PCM16 WAV of `seconds` at a constant `level` (0 to 1). */
function wav(seconds: number, level: number): string {
  const samples = Math.round(seconds * 16000);
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index += 1) view.setInt16(44 + index * 2, (index % 2 ? 1 : -1) * level * 32767, true);
  return encodeBase64(bytes);
}

Deno.test("measureWav reads length and peak", () => {
  const level = measureWav(wav(1.5, 0.5));
  assertEquals(level.seconds, 1.5);
  assertEquals(Math.round(level.peak * 100), 50);
});

Deno.test("measureWav rejects other formats", () => {
  assertThrows(() => measureWav(encodeBase64(new TextEncoder().encode("not a wav file at all, just some text"))));
});

Deno.test("unusableTake catches silence and very short takes", () => {
  assertEquals(typeof unusableTake(measureWav(wav(1, 0))), "string");
  assertEquals(typeof unusableTake(measureWav(wav(0.2, 0.5))), "string");
  assertEquals(unusableTake(measureWav(wav(2, 0.3))), null);
});
