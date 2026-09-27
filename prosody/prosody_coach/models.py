"""Core data model for the prosody coach.

This module defines the internal speech hierarchy described in the spec:

    Recording -> Sentence -> Prosodic phrase -> Word

Syllable-level structure is deliberately out of scope for v1; every
prominence and timing measurement is computed per word.

Everything here is a plain dataclass so the whole analysis is trivially
serialisable to JSON. That matters because the design separates the
*analysis* layer (measurable facts) from the *feedback* layer (coaching
prose): the feedback layer should only ever see the structures in this
file, never raw audio.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field, fields, asdict
from enum import Enum
from typing import Any


# Words that carry grammatical rather than lexical meaning. American English
# reduces these heavily in connected speech, so they are the usual occupants
# of "bridge" regions. This list is used only as a weak prior: the reference
# speaker, not the word class, is the source of truth for prominence.
FUNCTION_WORDS: frozenset[str] = frozenset(
    """
    a an the and or but nor so yet for
    of to in on at by with from into onto upon about over under
    as if than that then there here
    i you he she it we they me him her us them
    my your his its our their
    is am are was were be been being
    do does did done
    have has had having
    will would shall should can could may might must
    not no yes
    this these those
    what which who whom whose when where why how
    am re ve ll d s t
    """.split()
)


class Prominence(str, Enum):
    """Perceived rhythmic weight of a word.

    The three-way split mirrors the spec's categories. ``ANCHOR`` is a main
    rhythmic beat, ``MID`` is ordinary unreduced material, and ``BRIDGE`` is
    low-prominence connective material that should "glide".
    """

    ANCHOR = "anchor"
    MID = "mid"
    BRIDGE = "bridge"


class PitchMovement(str, Enum):
    """Coarse direction of the pitch contour across a span."""

    RISING = "rising"
    FALLING = "falling"
    LEVEL = "level"
    UNVOICED = "unvoiced"

    @property
    def arrow(self) -> str:
        return {
            PitchMovement.RISING: "↗",
            PitchMovement.FALLING: "↘",
            PitchMovement.LEVEL: "→",
            PitchMovement.UNVOICED: " ",
        }[self]


@dataclass
class Word:
    """A single word with its measured acoustic properties.

    All *_z fields are speaker-normalised z-scores. Raw values are kept
    alongside them for debugging, but comparison across speakers must only
    ever use the normalised forms, because two speakers have different pitch
    ranges, loudness and speaking rates.
    """

    text: str
    start: float
    end: float

    # Raw, speaker-specific measurements.
    pitch_mean_hz: float | None = None
    pitch_max_hz: float | None = None
    pitch_min_hz: float | None = None
    intensity_db: float | None = None

    # Speaker-normalised measurements. These are the comparable ones.
    pitch_z: float = 0.0
    pitch_range_z: float = 0.0
    intensity_z: float = 0.0
    duration_z: float = 0.0

    # Derived prosody.
    prominence_score: float = 0.0
    prominence: Prominence = Prominence.MID
    pitch_movement: PitchMovement = PitchMovement.UNVOICED

    # Silence between the end of this word and the start of the next one.
    pause_after: float = 0.0

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def normalized(self) -> str:
        """Lowercased, punctuation-stripped form used for text alignment."""
        return "".join(c for c in self.text.lower() if c.isalnum() or c == "'")

    @property
    def is_function_word(self) -> bool:
        stem = self.normalized.replace("'", " ").split()
        return bool(stem) and all(part in FUNCTION_WORDS for part in stem)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Word":
        """Inverse of ``to_dict`` for one word.

        Unknown keys are ignored and missing or null measurements fall back
        to the field default, so dicts written by other analyzer versions
        still load.
        """
        known = {f.name for f in fields(cls)}
        values = {k: v for k, v in data.items() if k in known and v is not None}
        if "prominence" in values:
            values["prominence"] = Prominence(values["prominence"])
        if "pitch_movement" in values:
            values["pitch_movement"] = PitchMovement(values["pitch_movement"])
        return cls(**values)


@dataclass
class Phrase:
    """A prosodic phrase / thought group: smaller than a sentence, larger
    than a word. Boundaries are placed on acoustic evidence alone - silence
    plus the pitch reset that opens a new group - since those are what
    listeners perceive as grouping, and they do not depend on how the
    recogniser happened to punctuate."""

    words: list[Word]

    @property
    def text(self) -> str:
        return " ".join(w.text for w in self.words)

    @property
    def start(self) -> float:
        return self.words[0].start if self.words else 0.0

    @property
    def end(self) -> float:
        return self.words[-1].end if self.words else 0.0

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def pause_after(self) -> float:
        return self.words[-1].pause_after if self.words else 0.0

    @property
    def anchors(self) -> list[Word]:
        return [w for w in self.words if w.prominence is Prominence.ANCHOR]

    @property
    def bridges(self) -> list[list[Word]]:
        """Maximal runs of low-prominence words between anchors."""
        runs: list[list[Word]] = []
        current: list[Word] = []
        for word in self.words:
            if word.prominence is Prominence.BRIDGE:
                current.append(word)
            else:
                if current:
                    runs.append(current)
                current = []
        if current:
            runs.append(current)
        return runs


@dataclass
class Recording:
    """A full analysed recording: the output of the analysis layer for one
    speaker."""

    label: str
    path: str
    transcript: str
    words: list[Word]
    phrases: list[Phrase]
    duration: float

    # Speaker-level baselines, retained so feedback can explain itself and so
    # normalisation is auditable.
    pitch_baseline_hz: float = 0.0
    pitch_range_hz: float = 0.0
    speech_rate_wps: float = 0.0
    articulation_rate_wps: float = 0.0
    total_pause_time: float = 0.0

    @property
    def anchors(self) -> list[Word]:
        return [w for w in self.words if w.prominence is Prominence.ANCHOR]

    def to_dict(self) -> dict[str, Any]:
        return _to_jsonable(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Recording":
        """Rebuild a Recording from ``to_dict`` output, e.g. a saved
        ``analyze --json`` file."""
        summary = {
            f.name: data[f.name]
            for f in fields(cls)
            if f.name not in {"words", "phrases"} and data.get(f.name) is not None
        }
        return cls(
            **summary,
            words=[Word.from_dict(w) for w in data.get("words", [])],
            phrases=[
                Phrase(words=[Word.from_dict(w) for w in p.get("words", [])])
                for p in data.get("phrases", [])
            ],
        )


class IssueType(str, Enum):
    """Categories of prosodic mismatch.

    Ordering here is not significance; ranking lives in the comparison layer
    and follows the spec's priority list.
    """

    RHYTHM_MISMATCH = "rhythm_mismatch"
    EXCESSIVE_PROMINENCE = "excessive_prominence"
    MISSING_PROMINENCE = "missing_prominence"
    PHRASE_BOUNDARY = "phrase_boundary"
    BRIDGE_TOO_LONG = "bridge_too_long"
    PAUSE_INSERTED = "pause_inserted"
    PAUSE_MISSING = "pause_missing"
    INTONATION_MISMATCH = "intonation_mismatch"
    TIMING_DIFFERENCE = "timing_difference"


@dataclass
class Issue:
    """One measurable difference between reference and user."""

    type: IssueType
    span: str
    severity: float          # 0..1, used for ranking within a priority tier
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def priority(self) -> int:
        """Spec section 20 priority order. Lower sorts first."""
        return {
            IssueType.RHYTHM_MISMATCH: 1,
            IssueType.EXCESSIVE_PROMINENCE: 2,
            IssueType.MISSING_PROMINENCE: 2,
            IssueType.PHRASE_BOUNDARY: 3,
            IssueType.BRIDGE_TOO_LONG: 4,
            IssueType.PAUSE_INSERTED: 5,
            IssueType.PAUSE_MISSING: 5,
            IssueType.INTONATION_MISMATCH: 6,
            IssueType.TIMING_DIFFERENCE: 7,
        }[self.type]

    @property
    def rank_key(self) -> tuple[int, float]:
        return (self.priority, -self.severity)


@dataclass
class CategoryVerdict:
    """A per-dimension verdict, matching the example feedback UI."""

    name: str
    verdict: str             # "Good" | "Needs work"
    comment: str


@dataclass
class Feedback:
    """Layer B output: coaching prose derived only from measured facts."""

    positive: str
    primary_issue: str | None
    secondary_issue: str | None
    next_attempt: str
    categories: list[CategoryVerdict] = field(default_factory=list)
    source: str = "template"   # "template", "llm" or "audio"
    model: str | None = None   # the model that wrote it, when not templates


@dataclass
class WordPair:
    """One aligned reference/user word, or a gap on either side."""

    reference: Word | None
    user: Word | None

    @property
    def text(self) -> str:
        word = self.reference or self.user
        return word.text if word else ""


@dataclass
class Comparison:
    """The complete analysis result for one shadowing attempt."""

    reference: Recording
    user: Recording
    pairs: list[WordPair]
    issues: list[Issue]
    feedback: Feedback
    rate_ratio: float = 1.0

    def to_dict(self) -> dict[str, Any]:
        return _to_jsonable(self)

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)


def _to_jsonable(obj: Any) -> Any:
    """Recursively convert dataclasses and enums to JSON-safe values.

    ``dataclasses.asdict`` alone leaves Enum members in place, which
    ``json.dumps`` cannot serialise, and it does not know about the computed
    properties we want in the output. Non-finite floats become ``None``.
    """
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, float) and not math.isfinite(obj):
        # Unvoiced words have no pitch. JSON (and Postgres jsonb) has no NaN.
        return None
    if isinstance(obj, (str, int, float, bool)) or obj is None:
        return obj
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_to_jsonable(v) for v in obj]
    if hasattr(obj, "__dataclass_fields__"):
        return {k: _to_jsonable(v) for k, v in asdict(obj).items()}
    return obj
