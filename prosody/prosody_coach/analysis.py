"""Layer A: speech analysis.

Turns audio plus word timings into a ``Recording`` carrying measurable
prosodic facts. This layer never produces prose and never makes a value
judgement about the user; it only measures. All judgement lives in
``compare`` and all wording lives in ``feedback``.

The central design constraint from the spec is speaker normalisation.
Every quantity that will later be compared across speakers is converted to
a z-score against that speaker's own distribution, so a deep voice is not
penalised against a high one and a slow talker is not penalised against a
fast one.
"""

from __future__ import annotations

import numpy as np

from .audio import AudioSignal, FeatureTrack, extract_features, semitones
from .models import (
    PitchMovement,
    Phrase,
    Prominence,
    Recording,
    Word,
)
from .transcribe import TimedWord


# A gap at least this long is heard as a pause rather than as the natural
# closure silence of a stop consonant.
PAUSE_THRESHOLD = 0.18

# A pause at least this long marks a prosodic phrase boundary.
PHRASE_PAUSE_THRESHOLD = 0.25

# Weights combining the acoustic correlates of prominence. Duration and
# pitch dominate in American English; intensity is a weaker cue and is
# weighted accordingly.
W_DURATION = 0.34
W_PITCH = 0.30
W_PITCH_RANGE = 0.18
W_INTENSITY = 0.18

# Prominence score thresholds on the normalised scale.
ANCHOR_THRESHOLD = 0.42
BRIDGE_THRESHOLD = -0.22

# How strongly to discount a pitch peak that duration does not corroborate.
# At 1.0 an entirely unsupported pitch cue contributes nothing.
PITCH_WITHOUT_DURATION_DAMPING = 0.85

# Penalty applied to function words when the acoustic evidence is ambiguous.
FUNCTION_WORD_PENALTY = 0.18

# How strongly to damp the pitch reset that marks a new thought group.
BOUNDARY_RESET_DAMPING = 0.5

# Pitch movement across a word, in semitones, below which it reads as level.
PITCH_MOVEMENT_SEMITONES = 1.4


def analyze(
    signal: AudioSignal,
    timed_words: list[TimedWord],
    transcript: str,
    label: str,
) -> Recording:
    """Produce a fully analysed ``Recording``."""
    track = extract_features(signal)
    words = [Word(text=w.text, start=w.start, end=w.end) for w in timed_words]

    if not words:
        return Recording(
            label=label, path=signal.path, transcript=transcript,
            words=[], phrases=[], duration=signal.duration,
        )

    _measure_words(words, track)
    baseline, pitch_range = _speaker_pitch_baseline(track)
    _normalize(words, baseline)

    # Pauses are measured before scoring because the prominence model needs
    # to know where thought groups begin in order to discount the pitch
    # reset that marks a new one.
    _measure_pauses(words)
    _score_prominence(words)
    _discount_boundary_resets(words)
    _classify_prominence(words)
    _measure_pitch_movement(words, track, baseline)

    phrases = _segment_phrases(words)
    speech_span = words[-1].end - words[0].start
    pause_time = sum(w.pause_after for w in words)
    speaking_time = max(speech_span - pause_time, 1e-6)

    return Recording(
        label=label,
        path=signal.path,
        transcript=transcript,
        words=words,
        phrases=phrases,
        duration=signal.duration,
        pitch_baseline_hz=baseline,
        pitch_range_hz=pitch_range,
        speech_rate_wps=len(words) / max(speech_span, 1e-6),
        articulation_rate_wps=len(words) / speaking_time,
        total_pause_time=pause_time,
    )


def _measure_words(words: list[Word], track: FeatureTrack) -> None:
    """Attach raw per-word acoustic measurements."""
    for word in words:
        window = track.slice(word.start, word.end)
        voiced = window.voiced_f0

        if len(voiced) > 0:
            word.pitch_mean_hz = float(np.mean(voiced))
            # Percentiles rather than min/max: a single stray frame should
            # not define a word's pitch range.
            word.pitch_max_hz = float(np.percentile(voiced, 90))
            word.pitch_min_hz = float(np.percentile(voiced, 10))

        if len(window.intensity_db) > 0:
            # Energy-weighted toward the loud part of the word: the vowel
            # nucleus is what carries perceived prominence, not the
            # surrounding consonants.
            values = window.intensity_db
            top = np.percentile(values, 75)
            loud = values[values >= top]
            word.intensity_db = float(np.mean(loud)) if len(loud) else float(np.mean(values))


def _speaker_pitch_baseline(track: FeatureTrack) -> tuple[float, float]:
    """Estimate a speaker's habitual pitch and range.

    The 20th percentile approximates the speaker's baseline (declination
    floor) far more robustly than the mean, which is pulled upward by
    emphatic peaks. Range is the 10th-to-90th percentile spread.
    """
    voiced = track.voiced_f0
    if len(voiced) < 5:
        return 0.0, 0.0
    baseline = float(np.percentile(voiced, 20))
    spread = float(np.percentile(voiced, 90) - np.percentile(voiced, 10))
    return baseline, spread


def _normalize(words: list[Word], baseline_hz: float) -> None:
    """Convert raw measurements into within-speaker z-scores.

    Duration is normalised per *syllable estimate* rather than per word, so
    that a long word is not automatically counted as prominent purely
    because it has more syllables in it.
    """
    durations = np.array([
        w.duration / max(_syllable_estimate(w.normalized), 1) for w in words
    ], dtype=np.float64)
    _assign_z(words, durations, "duration_z")

    if baseline_hz > 0:
        pitch_values = np.array([
            semitones(w.pitch_mean_hz, baseline_hz) if w.pitch_mean_hz else np.nan
            for w in words
        ], dtype=np.float64)
        _assign_z(words, pitch_values, "pitch_z")

        ranges = np.array([
            (semitones(w.pitch_max_hz, baseline_hz) - semitones(w.pitch_min_hz, baseline_hz))
            if (w.pitch_max_hz and w.pitch_min_hz) else np.nan
            for w in words
        ], dtype=np.float64)
        _assign_z(words, ranges, "pitch_range_z")

    intensities = np.array([
        w.intensity_db if w.intensity_db is not None else np.nan for w in words
    ], dtype=np.float64)
    _assign_z(words, intensities, "intensity_z")


def _assign_z(words: list[Word], values: np.ndarray, attribute: str) -> None:
    """Z-score ``values`` and write them onto ``words``.

    NaN entries (unvoiced words, missing measurements) receive 0.0, which is
    the neutral value: absent evidence should neither raise nor lower a
    word's prominence.
    """
    finite = values[np.isfinite(values)]
    if len(finite) < 2:
        for word in words:
            setattr(word, attribute, 0.0)
        return

    mean = float(np.mean(finite))
    std = float(np.std(finite))
    if std < 1e-9:
        for word in words:
            setattr(word, attribute, 0.0)
        return

    for word, value in zip(words, values):
        z = 0.0 if not np.isfinite(value) else float((value - mean) / std)
        # Clamp: a single extreme outlier should not dominate the weighted
        # prominence sum.
        setattr(word, attribute, max(-3.0, min(3.0, z)))


def _score_prominence(words: list[Word]) -> None:
    """Combine normalised cues into a single prominence score per word.

    Prominence in English is carried by several cues at once. A word that
    is long *and* high *and* loud is prominent; a word that is only high is
    usually something else, most often a phrase-initial pitch reset. The
    scoring therefore requires corroboration rather than letting a single
    extreme cue carry a word to anchor status on its own.
    """
    for word in words:
        pitch_cue = W_PITCH * word.pitch_z + W_PITCH_RANGE * word.pitch_range_z
        duration_cue = W_DURATION * word.duration_z
        intensity_cue = W_INTENSITY * word.intensity_z

        score = duration_cue + pitch_cue + intensity_cue

        # Pitch without duration is a boundary effect, not a beat. A short
        # word with a tall pitch spike is the classic signature of a phrase
        # -initial reset, so damp the pitch contribution when duration does
        # not support it.
        if pitch_cue > 0 and word.duration_z < 0:
            unsupported = pitch_cue * min(1.0, -word.duration_z)
            score -= PITCH_WITHOUT_DURATION_DAMPING * unsupported

        # Weak lexical prior. Function words are rarely the main beat, so a
        # small penalty helps when acoustic evidence is ambiguous. It is
        # deliberately small: the spec is explicit that the reference
        # speaker, not a word list, decides what is stressed.
        if word.is_function_word:
            score -= FUNCTION_WORD_PENALTY

        word.prominence_score = score


def _discount_boundary_resets(words: list[Word]) -> None:
    """Damp prominence on words that begin a new phrase.

    Speakers reset their pitch upward when starting a new thought group.
    That rise is structural, signalling "new phrase", not "this word is the
    beat". Without this correction the first word after any pause tends to
    be scored as an anchor purely because of the reset.

    Only short function words are discounted: a genuine content word at the
    start of a phrase can legitimately carry the beat.
    """
    for index, word in enumerate(words):
        starts_phrase = index == 0 or words[index - 1].pause_after > 0
        if not starts_phrase or index == 0:
            continue
        if word.duration_z >= 0 or not word.is_function_word:
            continue
        if word.prominence_score > 0:
            word.prominence_score *= 1.0 - BOUNDARY_RESET_DAMPING


def _classify_prominence(words: list[Word]) -> None:
    """Assign anchor / mid / bridge labels.

    Thresholds are applied to the raw score, then a local-maximum rule
    promotes the strongest word in any stretch that would otherwise have no
    anchor at all. Every phrase needs at least one beat; a sentence with no
    anchors is a measurement failure, not a real prosodic pattern.
    """
    for word in words:
        if word.prominence_score >= ANCHOR_THRESHOLD:
            word.prominence = Prominence.ANCHOR
        elif word.prominence_score <= BRIDGE_THRESHOLD:
            word.prominence = Prominence.BRIDGE
        else:
            word.prominence = Prominence.MID

    if not any(w.prominence is Prominence.ANCHOR for w in words):
        best = max(words, key=lambda w: w.prominence_score)
        best.prominence = Prominence.ANCHOR

    # Suppress adjacent anchors: English rhythm alternates, and two beats on
    # consecutive words is usually the detector splitting one beat in two.
    for i in range(1, len(words)):
        prev, current = words[i - 1], words[i]
        if prev.prominence is Prominence.ANCHOR and current.prominence is Prominence.ANCHOR:
            weaker = prev if prev.prominence_score < current.prominence_score else current
            # Only demote when one is clearly weaker; genuine double beats
            # such as "SOLD OUT" should survive.
            if abs(prev.prominence_score - current.prominence_score) > 0.25:
                weaker.prominence = Prominence.MID


def _measure_pitch_movement(words: list[Word], track: FeatureTrack, baseline: float) -> None:
    """Classify the pitch contour direction across each word."""
    for word in words:
        window = track.slice(word.start, word.end)
        mask = window.voiced & np.isfinite(window.f0)
        values = window.f0[mask]
        times = window.times[mask]

        if len(values) < 3 or baseline <= 0:
            word.pitch_movement = PitchMovement.UNVOICED
            continue

        st = np.asarray(semitones(values, baseline), dtype=np.float64)
        # Least-squares slope over the word, in semitones per second, then
        # scaled by the word's duration to get total movement.
        span = times[-1] - times[0]
        if span <= 1e-6:
            word.pitch_movement = PitchMovement.LEVEL
            continue
        slope = float(np.polyfit(times, st, 1)[0])
        total = slope * span

        if total >= PITCH_MOVEMENT_SEMITONES:
            word.pitch_movement = PitchMovement.RISING
        elif total <= -PITCH_MOVEMENT_SEMITONES:
            word.pitch_movement = PitchMovement.FALLING
        else:
            word.pitch_movement = PitchMovement.LEVEL


def _measure_pauses(words: list[Word]) -> None:
    """Record the silence following each word."""
    for i in range(len(words) - 1):
        gap = words[i + 1].start - words[i].end
        words[i].pause_after = gap if gap >= PAUSE_THRESHOLD else 0.0
    if words:
        words[-1].pause_after = 0.0


def _segment_phrases(words: list[Word]) -> list[Phrase]:
    """Group words into prosodic phrases.

    Boundaries are placed at pauses, and at punctuation in the transcript,
    which reflects the syntactic junctures a speaker tends to group around.
    """
    phrases: list[Phrase] = []
    current: list[Word] = []

    for word in words:
        current.append(word)
        ends_clause = word.text.rstrip().endswith((",", ".", "?", "!", ";", ":"))
        if word.pause_after >= PHRASE_PAUSE_THRESHOLD or ends_clause:
            phrases.append(Phrase(words=current))
            current = []

    if current:
        phrases.append(Phrase(words=current))

    # Merge runaway-short phrases into their neighbour: a one-word "phrase"
    # produced by a stray comma is not a thought group.
    merged: list[Phrase] = []
    for phrase in phrases:
        if merged and len(phrase.words) == 1 and phrase.words[0].pause_after == 0.0:
            merged[-1].words.extend(phrase.words)
        else:
            merged.append(phrase)

    return merged or [Phrase(words=list(words))]


def _syllable_estimate(word: str) -> int:
    """Estimate syllable count from spelling.

    v1 works at the word level, but duration must still be normalised by
    syllable count or long words masquerade as prominent ones. This vowel
    -group heuristic is approximate and that is acceptable: it feeds a
    z-score, so small errors wash out across a sentence.
    """
    word = word.lower().strip("'")
    if not word:
        return 1

    vowels = "aeiouy"
    count = 0
    previous_was_vowel = False
    for char in word:
        is_vowel = char in vowels
        if is_vowel and not previous_was_vowel:
            count += 1
        previous_was_vowel = is_vowel

    # Silent terminal 'e' as in "quite", but not "the", "be" or "little".
    if word.endswith("e") and count > 1 and not word.endswith(("le", "ee", "ye")):
        count -= 1

    # Syllabic consonants: English spells some syllable nuclei with no
    # vowel letter at all, as in "rhythm", "prism" or "chasm". The vowel
    # -group scan misses these entirely, so add one syllable when a word
    # ends in a consonant followed by a syllabic 'm' or 'n'.
    if len(word) >= 3 and word[-1] in "mn" and word[-2] not in vowels and word[-2] != word[-1]:
        count += 1

    return max(1, count)
