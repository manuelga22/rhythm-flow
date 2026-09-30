"""Audio loading and acoustic feature extraction.

Two features matter for prosody at the word level: fundamental frequency
(F0, perceived as pitch) and short-term intensity (perceived as loudness).
Both are extracted here on a fixed frame grid so that word-level statistics
are just slices of a pre-computed track.

Pitch tracking uses normalised autocorrelation with octave-error guarding.
That is deliberately a modest algorithm: it is implemented in numpy alone,
has no native dependencies, and is accurate enough for the question this
product actually asks, which is "did the pitch rise or fall across this
word, and was the peak here or there" rather than "what is the exact Hz".

This modules takes an audio file and hands back an AudioSignal guaranteed to be
mono, 16kHz and have normalized values (-1.0 to 1.0) in every frame.

Plain PCM .WAV files are read with the standard library. Other formats are
decoded in-process with PyAV, whose wheel bundles FFmpeg's libraries, so no
ffmpeg or ffprobe executable is needed on the machine.
"""

from __future__ import annotations

import math
import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np


# Frame grid. 10 ms hop is the usual choice for prosody work: fine enough to
# locate a pitch peak within a syllable, coarse enough to stay cheap.
FRAME_HOP = 0.010
FRAME_WINDOW = 0.040

# Human speech F0 bounds. Wide enough to cover low male and high female
# voices without inviting octave errors from outside the plausible range.
F0_MIN_HZ = 60.0
F0_MAX_HZ = 400.0

# Frames whose normalised autocorrelation peak falls below this are treated
# as unvoiced (silence, or a voiceless consonant) and excluded from pitch
# statistics rather than being recorded as 0 Hz, which would corrupt means.
VOICING_THRESHOLD = 0.35

# Every audio file that comes in will come out at 16kHz
# 16 kHz contains all the information we need to do prosodical analysis.
# The human voice mostly falls below 4 kHz, meaning 16 kHz is more than 
# enough for clear speech, voice calls, and voice recognition software.
TARGET_RATE = 16000


class AudioError(RuntimeError):
    """Raised when audio cannot be loaded or decoded."""


@dataclass
class AudioSignal:
    """Mono audio at a known sample rate, normalised to [-1, 1]."""

    samples: np.ndarray
    sample_rate: int
    path: str

    @property
    def duration(self) -> float:
        return len(self.samples) / self.sample_rate if self.sample_rate else 0.0


@dataclass
class FeatureTrack:
    """Frame-aligned acoustic features for a whole recording."""

    times: np.ndarray        # frame centre times, seconds
    f0: np.ndarray           # Hz, NaN where unvoiced
    intensity_db: np.ndarray # dB relative to full scale
    voiced: np.ndarray       # bool mask

    def slice(self, start: float, end: float) -> "FeatureTrack":
        """Frames whose centres fall within [start, end)."""
        mask = (self.times >= start) & (self.times < end)
        return FeatureTrack(
            times=self.times[mask],
            f0=self.f0[mask],
            intensity_db=self.intensity_db[mask],
            voiced=self.voiced[mask],
        )

    @property
    def voiced_f0(self) -> np.ndarray:
        """F0 values at voiced frames only, with NaNs removed."""
        values = self.f0[self.voiced]
        return values[~np.isnan(values)]


def load_audio(path: str | Path, target_rate: int = TARGET_RATE) -> AudioSignal:
    """Load any audio file as mono float32 at ``target_rate``.

    Plain PCM WAV is read with the standard library. Anything else is decoded
    with PyAV, which faster-whisper already depends on, so this adds no new
    install burden.
    """
    path = Path(path)
    if not path.exists():
        raise AudioError(f"Audio file not found: {path}")

    if path.suffix.lower() == ".wav":
        try:
            return _load_wav(path, target_rate)
        except (wave.Error, AudioError):
            # Fall through to PyAV: the extension may lie, or the file may
            # use a compressed WAV codec the wave module cannot read.
            pass
    # Anything that is not plain PCM WAV (m4a, webm, mp3, ...) is decoded by PyAV.
    return _load_via_av(path, target_rate)


def decode_to_wav(src: str | Path, dest: str | Path, target_rate: int = TARGET_RATE) -> Path:
    """Decode any audio file to 16-bit PCM mono WAV at ``target_rate``."""
    signal = load_audio(src, target_rate)
    pcm = (np.clip(signal.samples, -1.0, 1.0) * 32767.0).astype("<i2")
    dest = Path(dest)
    with wave.open(str(dest), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(target_rate)
        handle.writeframes(pcm.tobytes())
    return dest


# Speech-tuned Opus: a 16 kHz mono clip at this rate is about 0.24 MB a
# minute, an eighth of the WAV, and still clear enough for a listener to
# judge rhythm and intonation.
CLIP_BITRATE = 32000


def encode_clip(
    src: str | Path,
    dest: str | Path,
    start: float | None = None,
    end: float | None = None,
    target_rate: int = TARGET_RATE,
) -> Path:
    """Write ``src`` (optionally cut to ``start``..``end`` seconds) to
    ``dest`` as mono Ogg/Opus at ``target_rate``.

    Encoded with PyAV's bundled libopus, so no ffmpeg executable is needed.
    """
    signal = load_audio(src, target_rate)
    return _write_clip(signal, Path(src).name, Path(dest), start, end)


def encode_clips(
    src: str | Path,
    spans: list[tuple[str | Path, float, float]],
    target_rate: int = TARGET_RATE,
) -> list[Path]:
    """Like ``encode_clip`` for several ``(dest, start, end)`` cuts of the
    same source, decoding it once."""
    signal = load_audio(src, target_rate)
    return [_write_clip(signal, Path(src).name, Path(dest), start, end) for dest, start, end in spans]


def _write_clip(signal: AudioSignal, name: str, dest: Path, start: float | None, end: float | None) -> Path:
    import av

    rate = signal.sample_rate
    first = max(0, int((start or 0.0) * rate))
    last = len(signal.samples) if end is None else min(len(signal.samples), int(end * rate))
    if last <= first:
        raise AudioError(f"Empty clip requested from {name} ({start}..{end} s).")
    pcm = (np.clip(signal.samples[first:last], -1.0, 1.0) * 32767.0).astype(np.int16)

    frame = av.AudioFrame.from_ndarray(pcm.reshape(1, -1), format="s16", layout="mono")
    frame.sample_rate = rate
    try:
        with av.open(str(dest), mode="w", format="ogg") as container:
            stream = container.add_stream("libopus", rate=rate, layout="mono")
            stream.bit_rate = CLIP_BITRATE
            for packet in stream.encode(frame):
                container.mux(packet)
            # None flushes the samples the encoder is still buffering.
            for packet in stream.encode(None):
                container.mux(packet)
    except av.error.FFmpegError as exc:
        raise AudioError(f"Could not encode a clip of {name}: {exc}") from exc
    return dest


def _load_wav(path: Path, target_rate: int) -> AudioSignal:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        frames = handle.readframes(handle.getnframes())

    # Data will contain the frames respresented as normalized values (-1.0 to +1.0)
    # 1.0 means the audio was as loud as it could be, 0.0 means no sound.
    if width == 2:
        data = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        data = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    elif width == 1:
        data = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise AudioError(f"Unsupported WAV sample width: {width} bytes")

    # Collapse stereo to mono
    if channels > 1:
        data = data.reshape(-1, channels).mean(axis=1)

    # Convert to standard speed (16 kHz)
    if rate != target_rate:
        data = _resample(data, rate, target_rate)

    return AudioSignal(samples=data.astype(np.float32), sample_rate=target_rate, path=str(path))


def _load_via_av(path: Path, target_rate: int) -> AudioSignal:
    try:
        import av
    except ImportError as exc:
        raise AudioError(
            f"Cannot read {path.name}: it is not plain PCM WAV and PyAV is not installed.\n"
            "Run pip install -r requirements.txt, or convert the file to 16-bit PCM WAV first."
        ) from exc

    # The resampler does format conversion, downmixing and rate conversion in
    # one step, the same way faster-whisper decodes audio for transcription.
    resampler = av.audio.resampler.AudioResampler(format="s16", layout="mono", rate=target_rate)
    chunks: list[np.ndarray] = []
    try:
        with av.open(str(path), mode="r", metadata_errors="ignore") as container:
            if not container.streams.audio:
                raise AudioError(f"{path.name} has no audio track.")
            for frame in container.decode(audio=0):
                for out in resampler.resample(frame):
                    chunks.append(out.to_ndarray().reshape(-1))
            # Passing None drains the samples the resampler is still holding.
            for out in resampler.resample(None):
                chunks.append(out.to_ndarray().reshape(-1))
    except av.error.FFmpegError as exc:
        raise AudioError(f"Could not decode {path.name}: {exc}") from exc

    pcm = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.int16)
    samples = pcm.astype(np.float32) / 32768.0
    return AudioSignal(samples=samples, sample_rate=target_rate, path=str(path))


def _resample(data: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    """Linear-interpolation resampling.

    Good enough here because every downstream measurement is a frame-level
    statistic; we are not doing spectral analysis where interpolation
    artefacts would matter.
    """
    if source_rate == target_rate or len(data) == 0:
        return data
    duration = len(data) / source_rate
    target_len = int(round(duration * target_rate))
    if target_len <= 0:
        return np.zeros(0, dtype=np.float32)
    source_idx = np.linspace(0.0, len(data) - 1, num=target_len)
    return np.interp(source_idx, np.arange(len(data)), data).astype(np.float32)


def extract_features(signal: AudioSignal) -> FeatureTrack:
    """Compute the frame-level F0 and intensity tracks for a recording."""
    rate = signal.sample_rate

    # hop rate from seconds to sample numbers
    hop = max(1, int(round(FRAME_HOP * rate)))
    window = max(hop * 2, int(round(FRAME_WINDOW * rate)))
    samples = signal.samples

    if len(samples) < window:
        pad = np.zeros(window - len(samples), dtype=np.float32)
        samples = np.concatenate([samples, pad])

    # every frames starting position
    starts = np.arange(0, len(samples) - window + 1, hop)
    # every frames starting second
    times = (starts + window / 2.0) / rate

    f0 = np.full(len(starts), np.nan, dtype=np.float64)
    intensity = np.full(len(starts), -80.0, dtype=np.float64)
    voiced = np.zeros(len(starts), dtype=bool)

    # Hann window reduces spectral leakage at frame edges, which otherwise
    # shows up as spurious autocorrelation peaks.
    taper = np.hanning(window).astype(np.float32)
    min_lag = max(2, int(rate / F0_MAX_HZ))
    max_lag = min(window - 1, int(rate / F0_MIN_HZ))

    for i, start in enumerate(starts):
        frame = samples[start:start + window]
        rms = float(np.sqrt(np.mean(frame.astype(np.float64) ** 2)))
        intensity[i] = 20.0 * math.log10(max(rms, 1e-10))

        if rms < 1e-4:
            # Digital silence: no point running the pitch detector.
            continue

        pitch = _estimate_f0(frame * taper, rate, min_lag, max_lag)
        if pitch is not None:
            f0[i] = pitch
            voiced[i] = True

    f0 = _smooth_f0(f0, voiced)
    return FeatureTrack(times=times, f0=f0, intensity_db=intensity, voiced=voiced)


def _estimate_f0(frame: np.ndarray, rate: int, min_lag: int, max_lag: int) -> float | None:
    """Normalised autocorrelation pitch estimate for one frame.

    Returns None when the frame is unvoiced. The normalisation divides each
    lag's correlation by the energy of the two overlapping segments, which
    makes the peak height a voicing confidence in [0, 1] rather than an
    energy-dependent quantity.
    """
    frame = frame.astype(np.float64)
    frame = frame - frame.mean()
    energy = float(np.dot(frame, frame))
    if energy <= 1e-12 or max_lag <= min_lag:
        return None

    # FFT-based autocorrelation: O(n log n) instead of O(n * lags).
    size = 1 << (2 * len(frame) - 1).bit_length()
    spectrum = np.fft.rfft(frame, size)
    autocorr = np.fft.irfft(spectrum * np.conjugate(spectrum), size)[: max_lag + 1]

    # Normalise each lag by the geometric mean of the overlapping energies.
    cumulative = np.concatenate([[0.0], np.cumsum(frame ** 2)])
    total = cumulative[-1]
    lags = np.arange(min_lag, max_lag + 1)
    head = total - (cumulative[-1] - cumulative[len(frame) - lags])
    tail = cumulative[len(frame) - lags]
    denom = np.sqrt(np.maximum(head * tail, 1e-12))
    scores = autocorr[min_lag:max_lag + 1] / denom

    if len(scores) == 0:
        return None

    best = int(np.argmax(scores))
    peak = float(scores[best])
    if peak < VOICING_THRESHOLD:
        return None

    # Octave-error guard: autocorrelation peaks at the true period and at
    # every multiple of it. If a shorter lag scores nearly as well, the
    # longer lag is a subharmonic and the shorter one is the real period.
    best_lag = lags[best]
    for divisor in (2, 3):
        candidate_lag = best_lag // divisor
        if candidate_lag < min_lag:
            continue
        idx = candidate_lag - min_lag
        if 0 <= idx < len(scores) and scores[idx] > peak * 0.85:
            best_lag = candidate_lag
            peak = float(scores[idx])

    # Parabolic interpolation around the peak for sub-sample period accuracy.
    idx = best_lag - min_lag
    if 0 < idx < len(scores) - 1:
        left, centre, right = scores[idx - 1], scores[idx], scores[idx + 1]
        denominator = left - 2 * centre + right
        if abs(denominator) > 1e-12:
            best_lag = best_lag + 0.5 * (left - right) / denominator

    if best_lag <= 0:
        return None
    pitch = rate / float(best_lag)
    return pitch if F0_MIN_HZ <= pitch <= F0_MAX_HZ else None


def _smooth_f0(f0: np.ndarray, voiced: np.ndarray) -> np.ndarray:
    """Median-filter the voiced portions to remove isolated octave jumps.

    A single frame that doubles or halves is a tracker artefact, not a real
    pitch movement, and it would otherwise distort a word's pitch range.
    """
    out = f0.copy()
    indices = np.flatnonzero(voiced)
    if len(indices) < 3:
        return out
    values = f0[indices]
    smoothed = values.copy()
    for i in range(1, len(values) - 1):
        smoothed[i] = np.median(values[i - 1:i + 2])
    out[indices] = smoothed
    return out


def semitones(hz: np.ndarray | float, reference_hz: float) -> np.ndarray | float:
    """Convert Hz to semitones relative to a reference.

    Pitch is perceived logarithmically, so semitones are the right unit for
    comparing pitch *movement* across speakers with different ranges. A rise
    of 4 semitones sounds like the same gesture whether the speaker starts
    at 100 Hz or 200 Hz, which a raw Hz difference would completely miss.
    """
    reference_hz = max(reference_hz, 1e-6)
    return 12.0 * np.log2(np.maximum(np.asarray(hz, dtype=np.float64), 1e-6) / reference_hz)
