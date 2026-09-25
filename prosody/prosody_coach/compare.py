"""Reference/user comparison and issue ranking.

Two principles from the spec govern everything here:

1. Never compare by absolute timestamp. Align by linguistic unit first,
   then compare.
2. Never punish a user for speaking more slowly. Divide out the global rate
   difference and compare the *relative* allocation of time.

The output is a ranked list of ``Issue`` objects: measurable facts with a
severity, ordered by the spec's priority list. The feedback layer consumes
this list and nothing else.
"""

from __future__ import annotations

from difflib import SequenceMatcher

from prosody_coach.audio import semitones
from prosody_coach.models import (
    Comparison,
    Issue,
    IssueType,
    PitchMovement,
    Prominence,
    Recording,
    Word,
    WordPair,
)


# A user span must exceed the rate-normalised reference span by this factor
# before its timing counts as disproportionate.
BRIDGE_RATIO_THRESHOLD = 1.45

# Difference in prominence score required to call a word over- or
# under-stressed relative to the reference.
PROMINENCE_DELTA = 0.55

# Pause differences below this are inaudible as grouping changes.
PAUSE_DELTA = 0.16

# Beat-count difference that constitutes a rhythm mismatch.
BEAT_COUNT_DELTA = 2

# Prominence contrast is the spread between a speaker's beats and their
# bridges. Because prominence is z-scored within each speaker, a flat
# delivery still yields labelled anchors; what actually distinguishes it
# from good rhythm is that the anchors barely rise above the bridges in
# absolute acoustic terms. This ratio is what catches "every word equal".
CONTRAST_RATIO_THRESHOLD = 0.62


def compare(reference: Recording, user: Recording) -> Comparison:
    """Compare a user attempt against the reference and rank the issues."""
    pairs = align_words(reference, user)
    rate_ratio = _rate_ratio(reference, user)

    issues: list[Issue] = []
    issues.extend(_rhythm_issues(reference, user, pairs))
    issues.extend(_prominence_issues(pairs))
    issues.extend(_bridge_issues(pairs, rate_ratio))
    issues.extend(_pause_issues(pairs, rate_ratio))
    issues.extend(_phrase_boundary_issues(reference, user))
    issues.extend(_intonation_issues(reference, user, pairs))

    issues.sort(key=lambda issue: issue.rank_key)

    # Feedback is constructed by the caller; a placeholder keeps the
    # dataclass total so ``Comparison`` is always valid.
    from prosody_coach.models import Feedback

    return Comparison(
        reference=reference,
        user=user,
        pairs=pairs,
        issues=issues,
        feedback=Feedback(positive="", primary_issue=None, secondary_issue=None, next_attempt=""),
        rate_ratio=rate_ratio,
    )


def align_words(reference: Recording, user: Recording) -> list[WordPair]:
    """Align reference and user words by text.

    Uses ``SequenceMatcher`` over normalised word tokens. In the shadowing
    case the two sequences are nearly identical, so this resolves cleanly;
    insertions and deletions surface as pairs with a ``None`` on one side,
    which the issue detectors then skip rather than mis-compare.
    """
    ref_tokens = [w.normalized for w in reference.words]
    user_tokens = [w.normalized for w in user.words]

    matcher = SequenceMatcher(a=ref_tokens, b=user_tokens, autojunk=False)
    pairs: list[WordPair] = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(i2 - i1):
                pairs.append(WordPair(reference.words[i1 + offset], user.words[j1 + offset]))
        elif tag == "replace":
            # Pair positionally as far as both sides go, then report the
            # remainder as one-sided.
            length = max(i2 - i1, j2 - j1)
            for offset in range(length):
                ref_word = reference.words[i1 + offset] if i1 + offset < i2 else None
                user_word = user.words[j1 + offset] if j1 + offset < j2 else None
                pairs.append(WordPair(ref_word, user_word))
        elif tag == "delete":
            for index in range(i1, i2):
                pairs.append(WordPair(reference.words[index], None))
        elif tag == "insert":
            for index in range(j1, j2):
                pairs.append(WordPair(None, user.words[index]))

    return pairs


def _rate_ratio(reference: Recording, user: Recording) -> float:
    """How much slower the user is, excluding pause time.

    Articulation rate (words per second of actual speech) rather than
    speech rate, because pausing differences are reported separately and
    should not be folded into the rate correction.
    """
    if user.articulation_rate_wps <= 0 or reference.articulation_rate_wps <= 0:
        return 1.0
    return reference.articulation_rate_wps / user.articulation_rate_wps


def _matched(pairs: list[WordPair]) -> list[WordPair]:
    return [p for p in pairs if p.reference is not None and p.user is not None]


def _rhythm_issues(
    reference: Recording, user: Recording, pairs: list[WordPair]
) -> list[Issue]:
    """Detect a mismatch in the number of main rhythmic beats.

    This is the spec's top-priority issue: the reference has three beats,
    the user creates six, and the sentence consequently sounds segmented.
    """
    ref_anchors = reference.anchors
    user_anchors = user.anchors
    if not ref_anchors:
        return []

    issues: list[Issue] = []
    delta = len(user_anchors) - len(ref_anchors)

    if abs(delta) >= BEAT_COUNT_DELTA:
        issues.append(
            Issue(
                type=IssueType.RHYTHM_MISMATCH,
                span=" ".join(w.text for w in ref_anchors),
                severity=min(1.0, abs(delta) / max(len(ref_anchors), 1)),
                detail={
                    "aspect": "beat_count",
                    "reference_beats": [w.normalized for w in ref_anchors],
                    "user_beats": [w.normalized for w in user_anchors],
                    "reference_beat_count": len(ref_anchors),
                    "user_beat_count": len(user_anchors),
                    "direction": "too_many" if delta > 0 else "too_few",
                },
            )
        )

    contrast_issue = _contrast_issue(reference, user, ref_anchors)
    if contrast_issue is not None:
        issues.append(contrast_issue)

    return issues


def _contrast_issue(
    reference: Recording, user: Recording, ref_anchors: list[Word]
) -> Issue | None:
    """Detect a delivery that gives every word near-equal weight.

    Compares how far each speaker separates their beats from their bridges,
    using ratios (anchor duration over bridge duration, anchor pitch height
    over bridge pitch height). Ratios are inherently speaker-independent, so
    this works across different voices and speaking rates without further
    normalisation.
    """
    ref_contrast = _prominence_contrast(reference)
    user_contrast = _prominence_contrast(user)

    if ref_contrast is None or user_contrast is None or ref_contrast <= 1e-6:
        return None

    ratio = user_contrast / ref_contrast
    if ratio >= CONTRAST_RATIO_THRESHOLD:
        return None

    return Issue(
        type=IssueType.RHYTHM_MISMATCH,
        span=" ".join(w.text.strip(".,!?;:") for w in ref_anchors),
        severity=min(1.0, (CONTRAST_RATIO_THRESHOLD - ratio) / CONTRAST_RATIO_THRESHOLD),
        detail={
            "aspect": "prominence_contrast",
            "reference_beats": [w.normalized for w in ref_anchors],
            "user_beats": [w.normalized for w in user.anchors],
            "reference_contrast": round(ref_contrast, 3),
            "user_contrast": round(user_contrast, 3),
            "contrast_ratio": round(ratio, 2),
        },
    )


def _prominence_contrast(recording: Recording) -> float | None:
    """How strongly a speaker separates beats from connecting material.

    Returns a unitless figure combining the anchor-to-bridge duration ratio
    with the anchor-to-bridge pitch-height ratio. Higher means more
    pronounced rhythm.
    """
    from prosody_coach.analysis import _syllable_estimate

    anchors = [w for w in recording.words if w.prominence is Prominence.ANCHOR]
    others = [w for w in recording.words if w.prominence is not Prominence.ANCHOR]
    if not anchors or not others:
        return None

    def per_syllable(words: list[Word]) -> float:
        values = [w.duration / max(_syllable_estimate(w.normalized), 1) for w in words]
        return sum(values) / len(values)

    anchor_dur = per_syllable(anchors)
    other_dur = per_syllable(others)
    duration_ratio = anchor_dur / other_dur if other_dur > 1e-6 else 1.0

    baseline = recording.pitch_baseline_hz
    pitch_ratio = 1.0
    if baseline > 0:
        anchor_pitch = [w.pitch_mean_hz for w in anchors if w.pitch_mean_hz]
        other_pitch = [w.pitch_mean_hz for w in others if w.pitch_mean_hz]
        if anchor_pitch and other_pitch:
            # Height above the speaker's own baseline, in semitones. Using
            # the baseline as the zero point is what makes this comparable
            # between a low voice and a high one.
            anchor_st = sum(semitones(p, baseline) for p in anchor_pitch) / len(anchor_pitch)
            other_st = sum(semitones(p, baseline) for p in other_pitch) / len(other_pitch)
            pitch_ratio = max(0.1, anchor_st - other_st)

    return duration_ratio * max(pitch_ratio, 0.1)


def _prominence_issues(pairs: list[WordPair]) -> list[Issue]:
    """Detect individual words stressed too much or too little."""
    issues: list[Issue] = []

    for index, pair in enumerate(pairs):
        if pair.reference is None or pair.user is None:
            continue
        ref, usr = pair.reference, pair.user
        delta = usr.prominence_score - ref.prominence_score

        # ``index`` is the position in the aligned sequence. The feedback
        # layer uses it to disambiguate a word that occurs more than once,
        # so the user is not told twice about two different instances of
        # the same word.
        detail = {
            "word": usr.normalized,
            "index": index,
            "reference_prominence": ref.prominence.value,
            "user_prominence": usr.prominence.value,
            "delta": round(delta, 3),
        }

        if delta >= PROMINENCE_DELTA and ref.prominence is not Prominence.ANCHOR:
            issues.append(
                Issue(
                    type=IssueType.EXCESSIVE_PROMINENCE,
                    span=usr.text,
                    severity=min(1.0, delta / 2.0),
                    detail=detail,
                )
            )
        elif -delta >= PROMINENCE_DELTA and ref.prominence is Prominence.ANCHOR:
            issues.append(
                Issue(
                    type=IssueType.MISSING_PROMINENCE,
                    span=usr.text,
                    severity=min(1.0, -delta / 2.0),
                    detail=detail,
                )
            )

    return issues


def _bridge_issues(pairs: list[WordPair], rate_ratio: float) -> list[Issue]:
    """Detect bridges the user failed to compress.

    A bridge is a run of low-prominence reference words. The user's version
    of that run is compared after dividing out the global rate difference,
    so only *disproportionate* length is reported.
    """
    issues: list[Issue] = []
    matched = _matched(pairs)

    run: list[WordPair] = []
    for pair in matched + [WordPair(None, None)]:
        is_bridge = (
            pair.reference is not None
            and pair.reference.prominence is Prominence.BRIDGE
        )
        if is_bridge:
            run.append(pair)
            continue

        if len(run) >= 2:
            issue = _evaluate_bridge(run, rate_ratio)
            if issue:
                issues.append(issue)
        run = []

    return issues


def _evaluate_bridge(run: list[WordPair], rate_ratio: float) -> Issue | None:
    ref_span = sum(p.reference.duration for p in run)
    user_span = sum(p.user.duration for p in run)
    if ref_span <= 1e-6:
        return None

    # Rate-normalise: multiply the user's duration by how much faster they
    # would need to speak to match the reference's overall articulation.
    normalized_user = user_span * rate_ratio
    ratio = normalized_user / ref_span

    if ratio < BRIDGE_RATIO_THRESHOLD:
        return None

    text = " ".join(p.user.text for p in run)
    return Issue(
        type=IssueType.BRIDGE_TOO_LONG,
        span=text,
        severity=min(1.0, (ratio - 1.0) / 1.5),
        detail={
            "segment": text,
            "reference_duration_ms": round(ref_span * 1000),
            "user_duration_ms": round(user_span * 1000),
            "user_relative_duration": round(ratio, 2),
        },
    )


def _pause_issues(pairs: list[WordPair], rate_ratio: float) -> list[Issue]:
    """Detect pauses the user added or omitted."""
    issues: list[Issue] = []

    for pair in _matched(pairs):
        ref_pause = pair.reference.pause_after
        user_pause = pair.user.pause_after * rate_ratio
        delta = user_pause - ref_pause

        if delta >= PAUSE_DELTA and ref_pause == 0.0:
            issues.append(
                Issue(
                    type=IssueType.PAUSE_INSERTED,
                    span=pair.user.text,
                    severity=min(1.0, delta / 0.6),
                    detail={
                        "after_word": pair.user.normalized,
                        "user_pause_ms": round(pair.user.pause_after * 1000),
                        "reference_pause_ms": round(ref_pause * 1000),
                    },
                )
            )
        elif -delta >= PAUSE_DELTA and user_pause == 0.0:
            issues.append(
                Issue(
                    type=IssueType.PAUSE_MISSING,
                    span=pair.reference.text,
                    severity=min(1.0, -delta / 0.6),
                    detail={
                        "after_word": pair.reference.normalized,
                        "user_pause_ms": 0,
                        "reference_pause_ms": round(ref_pause * 1000),
                    },
                )
            )

    return issues


def _phrase_boundary_issues(reference: Recording, user: Recording) -> list[Issue]:
    """Detect differences in how the sentence was grouped.

    Grouping is what makes long speech sound non-native even when every word
    is pronounced correctly, so a count mismatch is reported on its own,
    separately from the individual pauses that caused it.
    """
    ref_count = len(reference.phrases)
    user_count = len(user.phrases)
    if abs(user_count - ref_count) < 1 or ref_count == 0:
        return []

    return [
        Issue(
            type=IssueType.PHRASE_BOUNDARY,
            span=" | ".join(p.text for p in user.phrases),
            severity=min(1.0, abs(user_count - ref_count) / max(ref_count, 1)),
            detail={
                "reference_phrases": [p.text for p in reference.phrases],
                "user_phrases": [p.text for p in user.phrases],
                "reference_count": ref_count,
                "user_count": user_count,
                "direction": "too_many" if user_count > ref_count else "too_few",
            },
        )
    ]


def _intonation_issues(
    reference: Recording, user: Recording, pairs: list[WordPair]
) -> list[Issue]:
    """Compare pitch behaviour, never raw Hz.

    Two checks: the final contour of the utterance, and the number of pitch
    resets, which is what distinguishes one sweeping phrase-level movement
    from a series of word-by-word restarts.
    """
    issues: list[Issue] = []

    ref_final = _final_contour(reference)
    user_final = _final_contour(user)
    if (
        ref_final is not PitchMovement.UNVOICED
        and user_final is not PitchMovement.UNVOICED
        and ref_final is not user_final
    ):
        issues.append(
            Issue(
                type=IssueType.INTONATION_MISMATCH,
                span=reference.words[-1].text if reference.words else "",
                severity=0.6 if ref_final is PitchMovement.FALLING else 0.45,
                detail={
                    "aspect": "final_contour",
                    "reference_final_contour": ref_final.value,
                    "user_final_contour": user_final.value,
                },
            )
        )

    ref_resets = _pitch_resets(reference)
    user_resets = _pitch_resets(user)
    if user_resets - ref_resets >= 2:
        issues.append(
            Issue(
                type=IssueType.INTONATION_MISMATCH,
                span=user.transcript,
                severity=min(1.0, (user_resets - ref_resets) / 4.0),
                detail={
                    "aspect": "pitch_resets",
                    "reference_resets": ref_resets,
                    "user_resets": user_resets,
                },
            )
        )

    return issues


def _final_contour(recording: Recording) -> PitchMovement:
    """Pitch direction over the last voiced stretch of the utterance."""
    for word in reversed(recording.words):
        if word.pitch_movement is not PitchMovement.UNVOICED:
            return word.pitch_movement
    return PitchMovement.UNVOICED


def _pitch_resets(recording: Recording) -> int:
    """Count upward pitch restarts.

    A reset is a word whose pitch jumps well above the previous word's after
    a fall. Many resets in one sentence is the acoustic signature of
    word-by-word delivery.
    """
    resets = 0
    previous: Word | None = None
    for word in recording.words:
        if word.pitch_mean_hz is None:
            continue
        if previous is not None and word.pitch_z - previous.pitch_z >= 0.9:
            resets += 1
        previous = word
    return resets
