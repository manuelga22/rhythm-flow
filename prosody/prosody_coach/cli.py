"""Command-line client for the prosody coach.

Usage:

    python -m prosody_coach compare reference.wav user.wav
    python -m prosody_coach compare ref.wav you.wav --verbose --json out.json
    python -m prosody_coach analyze reference.wav
    python -m prosody_coach devices
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .audio import AudioError
from .models import Comparison
from .pipeline import PipelineOptions, analyze_recording, run_shadowing
from .render import (
    Glyphs,
    Style,
    render_beats,
    render_recording,
    render_report,
    supports_color,
    supports_unicode,
    use_utf8_stdout,
)
from .transcribe import DEFAULT_COMPUTE, DEFAULT_MODEL, TranscriptionError


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="prosody_coach",
        description=(
            "American English prosody coach. Compares a user's shadowing attempt "
            "against a native reference recording and reports rhythm, stress, "
            "reduction, pausing and intonation differences."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  prosody_coach compare reference.wav user.wav\n"
            "  prosody_coach compare reference.wav user.wav --verbose\n"
            "  prosody_coach compare reference.wav user.wav --llm\n"
            "  prosody_coach analyze reference.wav --verbose\n"
        ),
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # ---- shared options -------------------------------------------------
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--model", default=DEFAULT_MODEL,
        help=f"Whisper model size (default: {DEFAULT_MODEL}). "
             "Options: tiny, base, small, medium, large-v3.",
    )
    common.add_argument(
        "--compute", default=DEFAULT_COMPUTE,
        help=f"Compute type for the model (default: {DEFAULT_COMPUTE}).",
    )
    common.add_argument(
        "--language", default="en",
        help="Spoken language code (default: en).",
    )
    common.add_argument(
        "--no-color", action="store_true",
        help="Disable ANSI colour output.",
    )
    common.add_argument(
        "--ascii", action="store_true",
        help="Use plain ASCII instead of box-drawing and arrow characters.",
    )
    common.add_argument(
        "-v", "--verbose", action="store_true",
        help="Show per-word measurements, speaker stats and the full ranked issue list.",
    )

    # ---- compare --------------------------------------------------------
    compare_parser = subparsers.add_parser(
        "compare", parents=[common],
        help="Compare a user recording against a reference recording.",
    )
    compare_parser.add_argument("reference", help="Path to the native reference audio.")
    compare_parser.add_argument("user", help="Path to the user's attempt.")
    compare_parser.add_argument(
        "--llm", action="store_true",
        help="Use the Claude API to word the feedback. Requires ANTHROPIC_API_KEY. "
             "Only the structured analysis is sent; audio never leaves your machine.",
    )
    compare_parser.add_argument(
        "--json", metavar="PATH", dest="json_path",
        help="Write the full structured analysis to a JSON file.",
    )
    compare_parser.add_argument(
        "--reference-text", metavar="TEXT",
        help="Known wording of the reference, used to improve timing accuracy.",
    )

    # ---- analyze --------------------------------------------------------
    analyze_parser = subparsers.add_parser(
        "analyze", parents=[common],
        help="Analyse a single recording and show its prosodic structure.",
    )
    analyze_parser.add_argument("audio", help="Path to the audio file.")
    analyze_parser.add_argument(
        "--json", metavar="PATH", dest="json_path",
        help="Write the structured analysis to a JSON file.",
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    # Prefer real UTF-8 output; fall back to ASCII glyphs where the console
    # cannot encode them, rather than crashing mid-report.
    use_utf8_stdout()
    style = Style(
        enabled=not args.no_color and supports_color(),
        glyphs=Glyphs(unicode_ok=not args.ascii and supports_unicode()),
    )

    options = PipelineOptions(
        model_size=args.model,
        compute_type=args.compute,
        language=args.language,
        use_llm=getattr(args, "llm", False),
        reference_text=getattr(args, "reference_text", None),
    )

    try:
        if args.command == "compare":
            return _run_compare(args, options, style)
        if args.command == "analyze":
            return _run_analyze(args, options, style)
    except (AudioError, TranscriptionError) as exc:
        print(f"\n{style.red('Error:')} {exc}\n", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130

    parser.print_help()
    return 1


def _run_compare(args, options: PipelineOptions, style: Style) -> int:
    for path in (args.reference, args.user):
        if not Path(path).exists():
            print(f"\n{style.red('Error:')} file not found: {path}\n", file=sys.stderr)
            return 1

    print(style.dim(f"  loading model '{options.model_size}' and transcribing..."), file=sys.stderr)

    comparison = run_shadowing(args.reference, args.user, options)

    print(render_report(comparison, style, verbose=args.verbose))

    if args.json_path:
        _write_json(comparison, args.json_path, style)

    return 0


def _run_analyze(args, options: PipelineOptions, style: Style) -> int:
    if not Path(args.audio).exists():
        print(f"\n{style.red('Error:')} file not found: {args.audio}\n", file=sys.stderr)
        return 1

    print(style.dim(f"  loading model '{options.model_size}' and transcribing..."), file=sys.stderr)

    recording = analyze_recording(args.audio, "reference", options)

    print("")
    print(style.bold(style.glyphs.rule * 68))
    print(style.bold(f"  PROSODIC STRUCTURE {style.glyphs.dash} {Path(args.audio).name}"))
    print(style.bold(style.glyphs.rule * 68))
    print("")
    print(style.cyan("TRANSCRIPT"))
    print("  " + recording.transcript)
    print("")
    print(style.cyan("STRUCTURE"))
    print("  " + render_recording(recording, style))
    print("")
    print(style.cyan("RHYTHM"))
    print("  " + render_beats(recording, style))
    print("")
    print(style.cyan("PHRASES"))
    for index, phrase in enumerate(recording.phrases, start=1):
        pause = f"  (pause {phrase.pause_after * 1000:.0f} ms)" if phrase.pause_after else ""
        print(f"  {index}. {phrase.text}{style.dim(pause)}")
    print("")

    if args.verbose:
        print(style.cyan("SPEAKER STATS"))
        print(f"  pitch baseline      {recording.pitch_baseline_hz:.1f} Hz")
        print(f"  pitch range         {recording.pitch_range_hz:.1f} Hz")
        print(f"  speech rate         {recording.speech_rate_wps:.2f} words/s")
        print(f"  articulation rate   {recording.articulation_rate_wps:.2f} words/s")
        print(f"  total pause time    {recording.total_pause_time:.2f} s")
        print("")
        print(style.cyan("WORD MEASUREMENTS"))
        print(style.dim(f"  {'word':<14}{'start':>8}{'dur':>9}{'prom':>9}  {'class':<8}{'pitch':<8}"))
        for word in recording.words:
            print(
                f"  {word.text.strip():<14}{word.start:>7.2f}s"
                f"{word.duration * 1000:>7.0f}ms{word.prominence_score:>9.2f}  "
                f"{word.prominence.value:<8}{word.pitch_movement.value:<8}"
            )
        print("")

    if args.json_path:
        Path(args.json_path).write_text(
            json.dumps(recording.to_dict(), indent=2), encoding="utf-8"
        )
        print(style.dim(f"  structured analysis written to {args.json_path}"))
        print("")

    return 0


def _write_json(comparison: Comparison, path: str, style: Style) -> None:
    Path(path).write_text(comparison.to_json(), encoding="utf-8")
    print(style.dim(f"  structured analysis written to {path}"))
    print("")


if __name__ == "__main__":
    raise SystemExit(main())
