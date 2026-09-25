"""Terminal rendering of the analysis.

Implements the visual conventions from the spec:

    CAPS / bold   anchors (main rhythmic beats)
    dim text      reduced, low-prominence bridge material
    |             prosodic phrase boundary
    arrows        pitch movement on the beats
    colour        mismatch between user and reference

ANSI colour is used when the stream is a TTY and the platform supports it,
and silently degrades to plain text otherwise, so piping output to a file
produces something readable.
"""

from __future__ import annotations

import os
import sys

from .models import (
    Comparison,
    IssueType,
    PitchMovement,
    Prominence,
    Recording,
    Word,
    WordPair,
)


class Glyphs:
    """Display characters, with an ASCII fallback for limited consoles."""

    def __init__(self, unicode_ok: bool) -> None:
        self.unicode_ok = unicode_ok
        self.rule = "─" if unicode_ok else "-"
        self.bar = "|"
        self.beat_dot = "·" if unicode_ok else "."
        self.check = "✓" if unicode_ok else "+"
        self.arrow_to = "→" if unicode_ok else "->"
        self.dash = "—" if unicode_ok else "-"
        # ASCII fallbacks are parenthesised rather than bare slashes: a bare
        # backslash reads as an escape next to punctuation ("QUICK\,").
        self.rise = "↗" if unicode_ok else "(up)"
        self.fall = "↘" if unicode_ok else "(dn)"
        self.level = "→" if unicode_ok else "(--)"

    def pitch(self, movement: "PitchMovement") -> str:
        return {
            PitchMovement.RISING: self.rise,
            PitchMovement.FALLING: self.fall,
            PitchMovement.LEVEL: self.level,
            PitchMovement.UNVOICED: " ",
        }[movement]


class Style:
    """ANSI escape codes, blanked out when colour is unavailable."""

    def __init__(self, enabled: bool, glyphs: Glyphs | None = None) -> None:
        self.enabled = enabled
        self.glyphs = glyphs or Glyphs(unicode_ok=True)

    def _wrap(self, code: str, text: str) -> str:
        return f"\033[{code}m{text}\033[0m" if self.enabled else text

    def bold(self, text: str) -> str:
        return self._wrap("1", text)

    def dim(self, text: str) -> str:
        return self._wrap("2", text)

    def red(self, text: str) -> str:
        return self._wrap("31", text)

    def green(self, text: str) -> str:
        return self._wrap("32", text)

    def yellow(self, text: str) -> str:
        return self._wrap("33", text)

    def cyan(self, text: str) -> str:
        return self._wrap("36", text)

    def bold_green(self, text: str) -> str:
        return self._wrap("1;32", text)

    def bold_red(self, text: str) -> str:
        return self._wrap("1;31", text)

    def bold_cyan(self, text: str) -> str:
        return self._wrap("1;36", text)


def supports_unicode(stream=None) -> bool:
    """Whether the stream can encode the box-drawing and arrow characters.

    Windows consoles often default to cp1252, which cannot represent them
    and raises UnicodeEncodeError mid-print. Callers use this to pick an
    ASCII glyph set instead of crashing.
    """
    stream = stream or sys.stdout
    encoding = getattr(stream, "encoding", None) or ""
    if not encoding:
        return False
    try:
        "─→·✓".encode(encoding)
    except (UnicodeEncodeError, LookupError):
        return False
    return True


def use_utf8_stdout() -> None:
    """Try to switch stdout/stderr to UTF-8 so the glyphs survive.

    Safe to call unconditionally: on streams that do not support
    reconfiguration this is a no-op and the ASCII fallback takes over.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            pass


def supports_color(stream=None) -> bool:
    stream = stream or sys.stdout
    if os.environ.get("NO_COLOR"):
        return False
    if os.environ.get("FORCE_COLOR"):
        return True
    if not hasattr(stream, "isatty") or not stream.isatty():
        return False
    if sys.platform == "win32":
        # Windows 10+ terminals support ANSI once virtual terminal
        # processing is enabled; enable it and report accordingly.
        return _enable_windows_ansi()
    return True


def _enable_windows_ansi() -> bool:
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        # ENABLE_VIRTUAL_TERMINAL_PROCESSING
        return bool(kernel32.SetConsoleMode(handle, mode.value | 0x0004))
    except Exception:  # noqa: BLE001
        return False


def render_recording(recording: Recording, style: Style, show_pitch: bool = True) -> str:
    """Render one recording's prosodic structure as a single line.

    Anchors appear in bold caps, bridges in dim lowercase, and phrase
    boundaries as vertical bars, so the rhythmic architecture is visible at
    a glance.
    """
    chunks: list[str] = []

    for index, phrase in enumerate(recording.phrases):
        rendered = [_render_word(w, style, show_pitch) for w in phrase.words]
        chunks.append(" ".join(rendered))
        if index < len(recording.phrases) - 1:
            pause = phrase.pause_after
            bar = style.cyan(style.glyphs.bar) if pause else style.dim("/")
            chunks.append(bar)

    return " ".join(chunks)


def _render_word(word: Word, style: Style, show_pitch: bool) -> str:
    text = word.text.strip()
    trailing = ""
    while text and text[-1] in ".,!?;:":
        trailing = text[-1] + trailing
        text = text[:-1]

    if word.prominence is Prominence.ANCHOR:
        body = style.bold(text.upper())
        if show_pitch and word.pitch_movement in (PitchMovement.RISING, PitchMovement.FALLING):
            body += style.cyan(style.glyphs.pitch(word.pitch_movement))
    elif word.prominence is Prominence.BRIDGE:
        body = style.dim(text.lower())
    else:
        body = text

    return body + trailing


def render_comparison_line(comparison: Comparison, style: Style) -> str:
    """Render the user's line with mismatches coloured.

    Red marks a word the user stressed that the reference does not; yellow
    marks a reference beat the user flattened; green marks a beat they hit.
    """
    flagged_excess = {
        issue.detail.get("word")
        for issue in comparison.issues
        if issue.type is IssueType.EXCESSIVE_PROMINENCE
    }
    flagged_missing = {
        issue.detail.get("word")
        for issue in comparison.issues
        if issue.type is IssueType.MISSING_PROMINENCE
    }

    parts: list[str] = []
    for pair in comparison.pairs:
        if pair.user is None:
            # Word present in the reference but missing from the attempt.
            if pair.reference is not None:
                parts.append(style.dim(f"({pair.reference.text.strip()})"))
            continue

        word = pair.user
        text = word.text.strip()
        key = word.normalized

        if key in flagged_excess:
            parts.append(style.bold_red(text.upper()))
        elif key in flagged_missing:
            parts.append(style.yellow(text.lower()))
        elif word.prominence is Prominence.ANCHOR:
            matched = (
                pair.reference is not None
                and pair.reference.prominence is Prominence.ANCHOR
            )
            parts.append(style.bold_green(text.upper()) if matched else style.bold(text.upper()))
        elif word.prominence is Prominence.BRIDGE:
            parts.append(style.dim(text.lower()))
        else:
            parts.append(text)

        if word.pause_after > 0:
            parts.append(style.cyan(style.glyphs.bar))

    return " ".join(parts)


def render_beats(recording: Recording, style: Style) -> str:
    """Render the rhythm as a sequence of beats and gaps.

    Matches the spec's notation: THOUGHT . . QUICK . . . LONGER, where each
    dot is one intervening unstressed word.
    """
    parts: list[str] = []
    gap = 0

    for word in recording.words:
        if word.prominence is Prominence.ANCHOR:
            if gap:
                parts.append(style.dim(style.glyphs.beat_dot * gap))
            parts.append(style.bold(word.text.strip(".,!?;:").upper()))
            gap = 0
        else:
            gap += 1

    if gap:
        parts.append(style.dim(style.glyphs.beat_dot * gap))

    return " ".join(parts)


def render_report(comparison: Comparison, style: Style, verbose: bool = False) -> str:
    """The full terminal report for one shadowing attempt."""
    lines: list[str] = []
    ref, user = comparison.reference, comparison.user

    lines.append("")
    lines.append(style.bold(style.glyphs.rule * 68))
    lines.append(style.bold(f"  PROSODY COACH {style.glyphs.dash} shadowing feedback"))
    lines.append(style.bold(style.glyphs.rule * 68))
    lines.append("")

    lines.append(style.cyan("REFERENCE"))
    lines.append("  " + render_recording(ref, style))
    lines.append("")

    lines.append(style.cyan("YOU"))
    lines.append("  " + render_comparison_line(comparison, style))
    lines.append("")

    lines.append(style.cyan("RHYTHM"))
    lines.append("  reference  " + render_beats(ref, style))
    lines.append("  you        " + render_beats(user, style))
    lines.append("")

    feedback = comparison.feedback
    lines.append(style.cyan("FEEDBACK"))
    lines.append(f"  {style.green('Good:')} {feedback.positive}")
    if feedback.primary_issue:
        lines.append(f"  {style.yellow('Work on:')} {feedback.primary_issue}")
    if feedback.secondary_issue:
        lines.append(f"  {style.yellow('Also:')} {feedback.secondary_issue}")
    lines.append(f"  {style.bold_cyan('Try next:')} {feedback.next_attempt}")
    lines.append("")

    if feedback.categories:
        lines.append(style.cyan("BREAKDOWN"))
        for category in feedback.categories:
            mark = style.green(style.glyphs.check) if category.verdict == "Good" else style.yellow("!")
            label = f"{category.name}:".ljust(12)
            lines.append(f"  {mark} {label} {category.comment}")
        lines.append("")

    if verbose:
        lines.extend(_render_verbose(comparison, style))

    lines.append(style.dim(
        f"  legend: {style.bold('BEAT')}  {style.dim('reduced')}  "
        f"{style.cyan('|')} phrase break  "
        f"{style.bold_red('RED')} too much stress  "
        f"{style.yellow('yellow')} missing beat"
    ))
    lines.append("")

    return "\n".join(lines)


def _render_verbose(comparison: Comparison, style: Style) -> list[str]:
    """Per-word measurements and the full ranked issue list."""
    lines: list[str] = []
    ref, user = comparison.reference, comparison.user

    lines.append(style.cyan("SPEAKER STATS"))
    lines.append(
        f"  reference  baseline {ref.pitch_baseline_hz:6.1f} Hz   "
        f"range {ref.pitch_range_hz:5.1f} Hz   "
        f"articulation {ref.articulation_rate_wps:4.2f} w/s   "
        f"pauses {ref.total_pause_time:4.2f} s"
    )
    lines.append(
        f"  you        baseline {user.pitch_baseline_hz:6.1f} Hz   "
        f"range {user.pitch_range_hz:5.1f} Hz   "
        f"articulation {user.articulation_rate_wps:4.2f} w/s   "
        f"pauses {user.total_pause_time:4.2f} s"
    )
    lines.append(f"  rate correction applied to your timings: {comparison.rate_ratio:.2f}x")
    lines.append("")

    lines.append(style.cyan("WORD MEASUREMENTS"))
    header = (
        f"  {'word':<14}{'ref dur':>8}{'you dur':>9}"
        f"{'ref prom':>10}{'you prom':>10}  {'ref':<7}{'you':<7}"
    )
    lines.append(style.dim(header))

    for pair in comparison.pairs:
        lines.append("  " + _measurement_row(pair))
    lines.append("")

    if comparison.issues:
        lines.append(style.cyan("RANKED ISSUES"))
        for index, issue in enumerate(comparison.issues, start=1):
            lines.append(
                f"  {index}. [{issue.priority}] {issue.type.value:<22} "
                f"sev {issue.severity:.2f}  \"{issue.span.strip()}\""
            )
        lines.append("")

    return lines


def _measurement_row(pair: WordPair) -> str:
    ref, usr = pair.reference, pair.user
    text = (ref or usr).text.strip() if (ref or usr) else ""

    ref_dur = f"{ref.duration * 1000:6.0f}ms" if ref else "      -"
    usr_dur = f"{usr.duration * 1000:6.0f}ms" if usr else "      -"
    ref_prom = f"{ref.prominence_score:>9.2f}" if ref else "        -"
    usr_prom = f"{usr.prominence_score:>9.2f}" if usr else "        -"
    ref_label = ref.prominence.value[:6] if ref else "-"
    usr_label = usr.prominence.value[:6] if usr else "-"

    return (
        f"{text:<14}{ref_dur:>8}{usr_dur:>9}"
        f"{ref_prom:>10}{usr_prom:>10}  {ref_label:<7}{usr_label:<7}"
    )
