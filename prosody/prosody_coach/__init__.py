"""American English prosody coach.

A standalone analysis engine that compares a user's shadowing attempt
against a native reference recording and reports rhythm, stress,
reduction, pausing and intonation differences.

The design keeps measurement strictly separate from coaching prose:

    analysis.py   Layer A - measures acoustic facts
    compare.py    Layer A - ranks differences between two recordings
    feedback.py   Layer B - turns ranked facts into coaching language

Layer B never sees audio, only the structured output of Layer A.
"""

from .models import (
    Comparison,
    Feedback,
    Issue,
    IssueType,
    Phrase,
    PitchMovement,
    Prominence,
    Recording,
    Word,
    WordPair,
)
from .pipeline import PipelineOptions, build_comparison, run_shadowing

__version__ = "0.1.0"

__all__ = [
    "Comparison",
    "Feedback",
    "Issue",
    "IssueType",
    "Phrase",
    "PipelineOptions",
    "PitchMovement",
    "Prominence",
    "Recording",
    "Word",
    "WordPair",
    "build_comparison",
    "run_shadowing",
    "__version__",
]
