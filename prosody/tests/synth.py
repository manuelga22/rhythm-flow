"""Synthetic speech-like audio for testing.

Generates audio with controllable pitch, duration, intensity and pauses per
word, so the analysis layer can be verified against known ground truth
without needing real recordings or a transcription model.

The signal is a sawtooth-like harmonic stack shaped by an amplitude
envelope. It is not intelligible speech, but it carries exactly the
acoustic properties the prosody analysis measures: a tracked F0, an energy
contour and word-boundary timing.
"""

from __future__ import annotations

import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000


@dataclass
class SynthWord:
    """One word to synthesise."""

    text: str
    duration: float = 0.25
    f0_start: float = 120.0
    f0_end: float | None = None
    amplitude: float = 0.3
    pause_after: float = 0.0

    @property
    def end_pitch(self) -> float:
        return self.f0_end if self.f0_end is not None else self.f0_start


@dataclass
class SynthUtterance:
    """A sequence of synthetic words forming one utterance."""

    words: list[SynthWord] = field(default_factory=list)

    def render(self) -> tuple[np.ndarray, list[tuple[str, float, float]]]:
        """Return the audio samples and the ground-truth word timings."""
        chunks: list[np.ndarray] = []
        timings: list[tuple[str, float, float]] = []
        cursor = 0.0

        # Brief lead-in silence so the first word is not clipped at frame 0.
        lead = 0.12
        chunks.append(np.zeros(int(lead * SAMPLE_RATE), dtype=np.float32))
        cursor += lead

        for word in self.words:
            tone = _voiced_segment(word)
            chunks.append(tone)
            start = cursor
            end = cursor + word.duration
            timings.append((word.text, start, end))
            cursor = end

            if word.pause_after > 0:
                silence = np.zeros(int(word.pause_after * SAMPLE_RATE), dtype=np.float32)
                chunks.append(silence)
                cursor += word.pause_after

        chunks.append(np.zeros(int(0.15 * SAMPLE_RATE), dtype=np.float32))
        return np.concatenate(chunks), timings

    def write_wav(self, path: str | Path) -> list[tuple[str, float, float]]:
        samples, timings = self.render()
        pcm = np.clip(samples, -1.0, 1.0)
        data = (pcm * 32767).astype("<i2")

        with wave.open(str(path), "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(SAMPLE_RATE)
            handle.writeframes(data.tobytes())

        return timings

    @property
    def transcript(self) -> str:
        return " ".join(w.text for w in self.words)


def _voiced_segment(word: SynthWord) -> np.ndarray:
    """Synthesise one word as a harmonic stack with a glide and envelope."""
    count = max(1, int(word.duration * SAMPLE_RATE))
    t = np.arange(count) / SAMPLE_RATE

    # Linear F0 glide across the word.
    f0 = np.linspace(word.f0_start, word.end_pitch, count)
    phase = 2 * np.pi * np.cumsum(f0) / SAMPLE_RATE

    # A few harmonics with falling amplitude approximates a voiced source
    # closely enough for autocorrelation pitch tracking to lock on.
    signal = np.zeros(count, dtype=np.float64)
    for harmonic in range(1, 8):
        signal += np.sin(harmonic * phase) / harmonic

    signal /= np.max(np.abs(signal)) if np.max(np.abs(signal)) > 0 else 1.0

    # Raised-cosine envelope: avoids clicks and gives the word a natural
    # energy peak in the middle, like a vowel nucleus.
    ramp = max(1, int(0.02 * SAMPLE_RATE))
    envelope = np.ones(count)
    ramp = min(ramp, count // 2)
    if ramp > 0:
        fade = 0.5 * (1 - np.cos(np.linspace(0, np.pi, ramp)))
        envelope[:ramp] = fade
        envelope[-ramp:] = fade[::-1]

    return (signal * envelope * word.amplitude).astype(np.float32)


# --------------------------------------------------------------------------
# Ready-made fixtures based on the spec's running example
# --------------------------------------------------------------------------


def reference_utterance() -> SynthUtterance:
    """A well-formed reference: three beats, compressed bridges.

    "I THOUGHT it'd be QUICK, but it took way LONGER than I expected."
    Anchors get longer duration, higher pitch and more amplitude; bridge
    words are short, low and quiet.
    """
    return SynthUtterance(words=[
        SynthWord("I",         duration=0.10, f0_start=112, amplitude=0.18),
        SynthWord("thought",   duration=0.32, f0_start=150, f0_end=138, amplitude=0.42),
        SynthWord("it'd",      duration=0.09, f0_start=108, amplitude=0.15),
        SynthWord("be",        duration=0.08, f0_start=106, amplitude=0.14),
        SynthWord("quick,",    duration=0.34, f0_start=158, f0_end=140, amplitude=0.45,
                   pause_after=0.28),
        SynthWord("but",       duration=0.09, f0_start=110, amplitude=0.16),
        SynthWord("it",        duration=0.07, f0_start=107, amplitude=0.14),
        SynthWord("took",      duration=0.16, f0_start=120, amplitude=0.24),
        SynthWord("way",       duration=0.14, f0_start=124, amplitude=0.26),
        SynthWord("longer",    duration=0.38, f0_start=162, f0_end=132, amplitude=0.46),
        SynthWord("than",      duration=0.08, f0_start=106, amplitude=0.14),
        SynthWord("I",         duration=0.07, f0_start=104, amplitude=0.13),
        SynthWord("expected.", duration=0.30, f0_start=118, f0_end=96, amplitude=0.28),
    ])


def flat_user_utterance() -> SynthUtterance:
    """A learner attempt with the classic failure mode.

    Every word gets similar weight, the bridge "it would be" is stretched,
    and extra pauses segment the line. This should trigger rhythm,
    excessive-prominence, bridge and pause issues.
    """
    return SynthUtterance(words=[
        SynthWord("I",         duration=0.18, f0_start=190, amplitude=0.34),
        SynthWord("thought",   duration=0.30, f0_start=205, amplitude=0.40),
        SynthWord("it",        duration=0.24, f0_start=200, amplitude=0.38,
                   pause_after=0.22),
        SynthWord("would",     duration=0.26, f0_start=203, amplitude=0.39),
        SynthWord("be",        duration=0.22, f0_start=198, amplitude=0.37),
        SynthWord("quick,",    duration=0.30, f0_start=208, amplitude=0.41,
                   pause_after=0.30),
        SynthWord("but",       duration=0.24, f0_start=202, amplitude=0.38,
                   pause_after=0.24),
        SynthWord("it",        duration=0.18, f0_start=196, amplitude=0.34),
        SynthWord("took",      duration=0.22, f0_start=199, amplitude=0.36),
        SynthWord("way",       duration=0.20, f0_start=197, amplitude=0.35),
        SynthWord("longer",    duration=0.34, f0_start=210, amplitude=0.42),
        SynthWord("than",      duration=0.20, f0_start=195, amplitude=0.34),
        SynthWord("I",         duration=0.16, f0_start=193, amplitude=0.33),
        SynthWord("expected.", duration=0.32, f0_start=196, f0_end=190, amplitude=0.36),
    ])


def good_user_utterance() -> SynthUtterance:
    """A learner attempt that matches the reference rhythm.

    Same prosodic architecture as the reference, but a higher voice and
    about 20 percent slower. Rate normalisation and pitch normalisation
    should make this come out clean.
    """
    scale = 1.2
    words = []
    for word in reference_utterance().words:
        words.append(SynthWord(
            text=word.text,
            duration=word.duration * scale,
            f0_start=word.f0_start * 1.55,
            f0_end=None if word.f0_end is None else word.f0_end * 1.55,
            amplitude=word.amplitude,
            pause_after=word.pause_after * scale,
        ))
    return SynthUtterance(words=words)
