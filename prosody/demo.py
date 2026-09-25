"""Run the prosody algorithm on synthetic audio, with no model download.

This is the fastest way to see what the algorithm produces and to probe how
its output changes. It synthesises a reference utterance and two learner
attempts, then runs the real analysis, comparison and feedback pipeline
over them.

    python demo.py                 # compare both learner attempts
    python demo.py --verbose       # add per-word measurements
    python demo.py --case flat     # just the flat learner
    python demo.py --json out.json # dump the structured analysis

Nothing here is mocked: the same pitch tracker, prominence model,
comparison layer and feedback generator run as with real recordings. Only
the audio and the word timings are synthetic, which is what lets it run
without faster-whisper installed.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from prosody_coach.analysis import analyze
from prosody_coach.audio import load_audio
from prosody_coach.pipeline import build_comparison
from prosody_coach.render import (
    Glyphs,
    Style,
    render_report,
    supports_color,
    supports_unicode,
    use_utf8_stdout,
)
from prosody_coach.transcribe import TimedWord

from tests import synth


CASES = {
    "flat": (
        synth.flat_user_utterance,
        "Learner who gives every word equal weight, stretches the bridges "
        "and inserts extra pauses.",
    ),
    "good": (
        synth.good_user_utterance,
        "Learner with a higher voice, speaking 20% slower, but with the "
        "reference's rhythm intact.",
    ),
}


def build_recording(utterance: synth.SynthUtterance, label: str, directory: Path):
    """Synthesise and analyse one utterance with known word timings."""
    path = directory / f"{label}.wav"
    timings = utterance.write_wav(path)
    signal = load_audio(path)
    words = [TimedWord(text, start, end) for (text, start, end) in timings]
    return analyze(signal, words, utterance.transcript, label)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Demonstrate the prosody algorithm on synthetic audio.",
    )
    parser.add_argument(
        "--case", choices=sorted(CASES) + ["all"], default="all",
        help="Which learner attempt to compare (default: all).",
    )
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Show per-word measurements and the ranked issue list.")
    parser.add_argument("--no-color", action="store_true", help="Disable colour.")
    parser.add_argument("--ascii", action="store_true", help="Use ASCII glyphs only.")
    parser.add_argument("--json", metavar="PATH", dest="json_path",
                        help="Write the structured analysis for the first case.")
    parser.add_argument("--keep-audio", metavar="DIR",
                        help="Write the synthetic WAV files here so you can play them.")
    args = parser.parse_args(argv)

    use_utf8_stdout()
    style = Style(
        enabled=not args.no_color and supports_color(),
        glyphs=Glyphs(unicode_ok=not args.ascii and supports_unicode()),
    )

    directory = Path(args.keep_audio) if args.keep_audio else Path(tempfile.mkdtemp())
    directory.mkdir(parents=True, exist_ok=True)

    reference = build_recording(synth.reference_utterance(), "reference", directory)
    selected = sorted(CASES) if args.case == "all" else [args.case]

    for index, name in enumerate(selected):
        factory, description = CASES[name]
        user = build_recording(factory(), name, directory)
        comparison = build_comparison(reference, user)

        print("")
        print(style.bold(f"  CASE: {name}"))
        print(style.dim(f"  {description}"))
        print(render_report(comparison, style, verbose=args.verbose))

        if args.json_path and index == 0:
            Path(args.json_path).write_text(comparison.to_json(), encoding="utf-8")
            print(style.dim(f"  structured analysis written to {args.json_path}"))
            print("")

    if args.keep_audio:
        print(style.dim(f"  synthetic audio written to {directory}"))
        print("")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
