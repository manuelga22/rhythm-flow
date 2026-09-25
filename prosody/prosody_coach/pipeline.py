"""End-to-end pipeline wiring.

Ties together the stages described in the spec:

    audio -> transcription -> segmentation -> features -> prominence
          -> anchors/bridges -> comparison -> ranked issues -> feedback
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from . import feedback as feedback_layer
from .analysis import analyze
from .audio import load_audio
from .compare import compare
from .models import Comparison, Recording
from .transcribe import DEFAULT_COMPUTE, DEFAULT_MODEL, TimedWord, Transcript, transcribe


@dataclass
class PipelineOptions:
    model_size: str = DEFAULT_MODEL
    compute_type: str = DEFAULT_COMPUTE
    language: str = "en"
    use_llm: bool = False
    reference_text: str | None = None
    user_text: str | None = None


def analyze_recording(
    path: str | Path,
    label: str,
    options: PipelineOptions,
    *,
    initial_prompt: str | None = None,
) -> Recording:
    """Load, transcribe and analyse one recording."""
    signal = load_audio(path)
    transcript: Transcript = transcribe(
        path,
        model_size=options.model_size,
        compute_type=options.compute_type,
        language=options.language,
        initial_prompt=initial_prompt,
    )
    return analyze(signal, transcript.words, transcript.text, label)


def run_shadowing(
    reference_path: str | Path,
    user_path: str | Path,
    options: PipelineOptions | None = None,
) -> Comparison:
    """Run the full shadowing comparison for two recordings."""
    options = options or PipelineOptions()

    reference = analyze_recording(
        reference_path, "reference", options,
        initial_prompt=options.reference_text,
    )

    # Bias the user transcription toward the reference wording. In shadowing
    # the words are known in advance, and this measurably improves word
    # timing accuracy on accented speech.
    user = analyze_recording(
        user_path, "user", options,
        initial_prompt=options.user_text or reference.transcript,
    )

    comparison = compare(reference, user)
    comparison.feedback = feedback_layer.generate(comparison, use_llm=options.use_llm)
    return comparison


def build_comparison(reference: Recording, user: Recording, use_llm: bool = False) -> Comparison:
    """Compare two already-analysed recordings."""
    comparison = compare(reference, user)
    comparison.feedback = feedback_layer.generate(comparison, use_llm=use_llm)
    return comparison


def analyze_from_timings(
    path: str | Path,
    words: list[TimedWord],
    transcript: str,
    label: str,
) -> Recording:
    """Analyse a recording whose word timings are already known."""
    signal = load_audio(path)
    return analyze(signal, words, transcript, label)
