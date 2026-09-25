"""Layer B: coaching feedback.

Converts the ranked issues from the comparison layer into short, specific,
actionable prose. This layer receives only measured facts, never audio, so
it cannot invent an observation that the analysis did not support.

The template generator is the default and is fully deterministic. The
optional LLM generator sends the same structured facts to the Claude API
for nicer wording, and falls back to templates on any failure so the tool
always produces output.
"""

from __future__ import annotations

import json
import os
from typing import Any

from .models import (
    CategoryVerdict,
    Comparison,
    Feedback,
    Issue,
    IssueType,
    Prominence,
)


# The spec is explicit: roughly one positive, one or two corrections, one
# instruction. More than that overwhelms the user and buries the priority.
MAX_ISSUES_REPORTED = 2


def _join(items: list[str]) -> str:
    """Join words into readable English: "A", "A and B", "A, B and C"."""
    items = [i for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f" and {items[-1]}"


def generate(comparison: Comparison, use_llm: bool = False) -> Feedback:
    """Produce coaching feedback for a comparison."""
    template_feedback = _template_feedback(comparison)

    if not use_llm:
        return template_feedback

    try:
        return _llm_feedback(comparison, template_feedback)
    except Exception as exc:  # noqa: BLE001 - fall back on any failure
        template_feedback.categories.append(
            CategoryVerdict(
                name="Note",
                verdict="Info",
                comment=f"LLM feedback unavailable ({exc}); showing template feedback.",
            )
        )
        return template_feedback


# --------------------------------------------------------------------------
# Template generator
# --------------------------------------------------------------------------


def _template_feedback(comparison: Comparison) -> Feedback:
    reported = _select_issues(comparison.issues, comparison)

    positive = _positive_observation(comparison, reported)
    primary = _describe(reported[0], comparison) if len(reported) >= 1 else None
    secondary = _describe(reported[1], comparison) if len(reported) >= 2 else None
    next_attempt = _next_instruction(comparison, reported)

    return Feedback(
        positive=positive,
        primary_issue=primary,
        secondary_issue=secondary,
        next_attempt=next_attempt,
        categories=_categories(comparison),
        source="template",
    )


def _select_issues(issues: list[Issue], comparison: Comparison) -> list[Issue]:
    """Pick the issues to report, avoiding repetition.

    The ranked list can contain several issues that would produce the same
    sentence, most often the same word appearing twice in one utterance.
    Telling the user the same thing twice wastes one of the two correction
    slots the spec allows, so issues are deduplicated by the sentence they
    would generate, keeping the highest-ranked instance of each.
    """
    selected: list[Issue] = []
    seen: set[str] = set()

    for issue in issues:
        sentence = _describe(issue, comparison)
        key = sentence.strip().lower()
        if key in seen:
            continue
        seen.add(key)
        selected.append(issue)
        if len(selected) == MAX_ISSUES_REPORTED:
            break

    return selected


def _positive_observation(comparison: Comparison, reported: list[Issue]) -> str:
    """Find something specific and true to praise.

    The spec rejects generic praise, so this only ever cites a concrete
    match: anchors the user placed correctly, a bridge they compressed, or
    grouping that lined up.
    """
    flagged = {issue.detail.get("word") for issue in reported}

    # When the headline problem is that the user flattened the beat/bridge
    # contrast, praising the beats they "matched" would directly contradict
    # the correction. Suppress anchor praise in that case and find
    # something else true to say.
    contrast_flagged = any(
        issue.type is IssueType.RHYTHM_MISMATCH
        and issue.detail.get("aspect") == "prominence_contrast"
        for issue in reported
    )

    matched_anchors = [
        pair.user.text.strip(".,!?;:")
        for pair in comparison.pairs
        if pair.reference is not None
        and pair.user is not None
        and pair.reference.prominence is Prominence.ANCHOR
        and pair.user.prominence is Prominence.ANCHOR
        and pair.user.normalized not in flagged
    ]

    if matched_anchors and not contrast_flagged:
        words = _join([w.upper() for w in matched_anchors[:3]])
        return f"Your stress on {words} matched the reference."

    reported_types = {issue.type for issue in reported}

    if contrast_flagged and matched_anchors:
        # The beats landed on the right words even though the contrast was
        # weak. That is a real, specific thing the user got right, and it
        # is the foundation the correction builds on.
        words = _join([w.upper() for w in matched_anchors[:3]])
        return f"You put the beats on the right words: {words}."

    if IssueType.PHRASE_BOUNDARY not in reported_types and len(
        comparison.user.phrases
    ) == len(comparison.reference.phrases):
        return "Your phrase grouping matched the reference closely."

    if not any(
        issue.type in (IssueType.PAUSE_INSERTED, IssueType.PAUSE_MISSING)
        for issue in comparison.issues
    ):
        return "Your pause placement matched the reference."

    if not any(issue.type is IssueType.BRIDGE_TOO_LONG for issue in comparison.issues):
        return "You kept the connecting words light between the main beats."

    return "You reproduced the words and overall shape of the reference."


def _describe(issue: Issue, comparison: Comparison) -> str:
    """Turn one measured issue into a sentence the user can act on."""
    detail = issue.detail

    if issue.type is IssueType.RHYTHM_MISMATCH:
        beats = _join([w.upper() for w in detail["reference_beats"][:4]])

        if detail.get("aspect") == "prominence_contrast":
            return (
                f"You are giving almost every word the same weight. The reference "
                f"separates {beats} clearly from the words around them, and your "
                "version flattens that difference."
            )

        ref_count = detail["reference_beat_count"]
        user_count = detail["user_beat_count"]
        if detail["direction"] == "too_many":
            return (
                f"The reference has {ref_count} main beats ({beats}), "
                f"but your version creates {user_count}, which makes the line sound segmented."
            )
        return (
            f"The reference has {ref_count} main beats ({beats}), "
            f"but your version only lands {user_count}, so the rhythm sounds flat."
        )

    if issue.type is IssueType.EXCESSIVE_PROMINENCE:
        context = _context_phrase(comparison, detail.get("word"), detail.get("index"))
        if context:
            return f"You are giving \"{context}\" more weight than the reference does."
        return f"You are giving \"{issue.span.strip()}\" more weight than the reference does."

    if issue.type is IssueType.MISSING_PROMINENCE:
        word = issue.span.strip().strip(".,!?;:").upper()
        return f"{word} carries a main beat in the reference, but yours passes over it."

    if issue.type is IssueType.BRIDGE_TOO_LONG:
        ratio = detail["user_relative_duration"]
        return (
            f"\"{detail['segment'].strip()}\" takes {ratio:.1f}x as long as the reference, "
            "relative to your own speaking rate."
        )

    if issue.type is IssueType.PAUSE_INSERTED:
        ms = detail["user_pause_ms"]
        return (
            f"You paused for {ms} ms after \"{detail['after_word']}\" "
            "where the reference runs straight through."
        )

    if issue.type is IssueType.PAUSE_MISSING:
        ms = detail["reference_pause_ms"]
        return (
            f"The reference pauses {ms} ms after \"{detail['after_word']}\" "
            "and you run straight through it."
        )

    if issue.type is IssueType.PHRASE_BOUNDARY:
        if detail["direction"] == "too_many":
            return (
                f"You broke the line into {detail['user_count']} groups "
                f"where the reference uses {detail['reference_count']}."
            )
        return (
            f"You ran {detail['user_count']} group(s) together "
            f"where the reference uses {detail['reference_count']}."
        )

    if issue.type is IssueType.INTONATION_MISMATCH:
        if detail.get("aspect") == "final_contour":
            return (
                f"The reference ends with a {detail['reference_final_contour']} pitch, "
                f"but yours ends {detail['user_final_contour']}."
            )
        return (
            "The reference carries one pitch movement across the phrase, "
            f"but your pitch restarts on {detail['user_resets']} separate words."
        )

    return f"Difference detected around \"{issue.span.strip()}\"."


def _next_instruction(comparison: Comparison, reported: list[Issue]) -> str:
    """One concrete thing to do on the next attempt."""
    anchors = [
        w.text.strip(".,!?;:").upper() for w in comparison.reference.anchors
    ]
    # Plain ASCII: this string is also sent to the LLM and written to JSON,
    # where a box-drawing arrow would be noise.
    anchor_chain = " -> ".join(anchors[:3]) if anchors else ""

    if not reported:
        if anchor_chain:
            return f"Keep {anchor_chain} as your main beats and run the rest together."
        return "Keep that rhythm and try the next clip."

    top = reported[0]

    if top.type is IssueType.RHYTHM_MISMATCH and anchor_chain:
        if top.detail.get("aspect") == "prominence_contrast":
            return (
                f"Lean harder into {anchor_chain} and let everything else drop away. "
                "Exaggerate the difference more than feels natural at first."
            )
        return (
            f"Keep {anchor_chain} as your main beats. "
            "Let everything between them move more lightly."
        )

    if top.type is IssueType.EXCESSIVE_PROMINENCE:
        target = _following_anchor(
            comparison, top.detail.get("word"), top.detail.get("index")
        )
        word = _context_phrase(
            comparison, top.detail.get("word"), top.detail.get("index")
        ) or top.span.strip()
        if target:
            return f"Glide through \"{word}\" and save the emphasis for {target.upper()}."
        return f"Let \"{word}\" pass lightly instead of stressing it."

    if top.type is IssueType.MISSING_PROMINENCE:
        word = top.span.strip().strip(".,!?;:").upper()
        return f"Lengthen {word} and lift the pitch on it so it lands as a beat."

    if top.type is IssueType.BRIDGE_TOO_LONG:
        segment = top.detail["segment"].strip()
        target = _following_anchor(comparison, segment.split()[-1] if segment else None)
        if target:
            return f"Run \"{segment}\" together as one quick unit, then hit {target.upper()}."
        return f"Compress \"{segment}\" into a single quick movement."

    if top.type is IssueType.PAUSE_INSERTED:
        return (
            f"Run straight through after \"{top.detail['after_word']}\" "
            "without stopping."
        )

    if top.type is IssueType.PAUSE_MISSING:
        return f"Take a short break after \"{top.detail['after_word']}\" to group the phrase."

    if top.type is IssueType.PHRASE_BOUNDARY:
        groups = top.detail["reference_phrases"]
        shown = " | ".join(g.strip() for g in groups[:3])
        return f"Group it the way the reference does: {shown}"

    if top.type is IssueType.INTONATION_MISMATCH:
        if top.detail.get("aspect") == "final_contour":
            return (
                f"Let your pitch {top.detail['reference_final_contour'][:-3]} "
                "at the end of the sentence."
            )
        return "Carry one pitch movement across the whole phrase instead of restarting on each word."

    if anchor_chain:
        return f"Keep {anchor_chain} as your main beats."
    return "Focus on the main beats and let the rest glide."


def _context_phrase(
    comparison: Comparison, word: str | None, index: int | None
) -> str | None:
    """Quote a repeated word together with its neighbour.

    "it" alone is ambiguous when the sentence contains it twice. Widening
    to "thought it" or "but it" tells the user which one is meant, and
    matches how a human coach would point at the spot.
    """
    if word is None or index is None:
        return None

    occurrences = [
        p for p in comparison.pairs
        if p.user is not None and p.user.normalized == word
    ]
    if len(occurrences) < 2:
        return None

    if not (0 <= index < len(comparison.pairs)):
        return None

    target = comparison.pairs[index].user
    if target is None:
        return None

    # Prefer the preceding word for context, since English coaches point
    # forward ("glide through X and save it for Y").
    for offset in (index - 1, index + 1):
        if not (0 <= offset < len(comparison.pairs)):
            continue
        neighbour = comparison.pairs[offset].user
        if neighbour is None:
            continue
        left, right = (neighbour, target) if offset < index else (target, neighbour)
        return f"{left.text.strip()} {right.text.strip()}".strip()

    return None


def _following_anchor(
    comparison: Comparison, after_word: str | None, index: int | None = None
) -> str | None:
    """The next reference anchor after a given word.

    Used for "save the emphasis for X" advice. When ``index`` is supplied
    the search starts there, so a repeated word points at the anchor that
    actually follows *that* occurrence rather than the first one.
    """
    if not after_word and index is None:
        return None

    start = 0
    if index is not None and 0 <= index < len(comparison.pairs):
        start = index + 1
    else:
        for position, pair in enumerate(comparison.pairs):
            if pair.reference is not None and pair.reference.normalized == after_word:
                start = position + 1
                break
        else:
            return None

    for pair in comparison.pairs[start:]:
        if pair.reference is None:
            continue
        if pair.reference.prominence is Prominence.ANCHOR:
            return pair.reference.text.strip(".,!?;:")
    return None


def _categories(comparison: Comparison) -> list[CategoryVerdict]:
    """Per-dimension verdicts matching the example feedback UI."""
    by_type: dict[IssueType, list[Issue]] = {}
    for issue in comparison.issues:
        by_type.setdefault(issue.type, []).append(issue)

    def verdict(types: list[IssueType], good: str, bad: str) -> CategoryVerdict:
        hits = [issue for t in types for issue in by_type.get(t, [])]
        name = {
            IssueType.RHYTHM_MISMATCH: "Rhythm",
            IssueType.BRIDGE_TOO_LONG: "Reduction",
            IssueType.PAUSE_INSERTED: "Pausing",
            IssueType.INTONATION_MISMATCH: "Intonation",
        }[types[0]]
        if not hits:
            return CategoryVerdict(name=name, verdict="Good", comment=good)
        worst = max(hits, key=lambda i: i.severity)
        return CategoryVerdict(
            name=name,
            verdict="Needs work",
            comment=bad.format(span=worst.span.strip()),
        )

    return [
        verdict(
            [IssueType.RHYTHM_MISMATCH, IssueType.EXCESSIVE_PROMINENCE, IssueType.MISSING_PROMINENCE],
            "Your main stresses were close to the reference.",
            "Your beat pattern differs from the reference around \"{span}\".",
        ),
        verdict(
            [IssueType.BRIDGE_TOO_LONG],
            "You kept the connecting material light.",
            "\"{span}\" carried more weight than the reference gives it.",
        ),
        verdict(
            [IssueType.PAUSE_INSERTED, IssueType.PAUSE_MISSING, IssueType.PHRASE_BOUNDARY],
            "Your phrase boundaries matched the speaker.",
            "Your grouping differs from the reference around \"{span}\".",
        ),
        verdict(
            [IssueType.INTONATION_MISMATCH],
            "Your pitch movement was similar to the reference.",
            "Your pitch contour differs from the reference.",
        ),
    ]


# --------------------------------------------------------------------------
# Optional LLM generator
# --------------------------------------------------------------------------


COACH_SYSTEM_PROMPT = """\
You are a prosody coach for advanced non-native English speakers. The user \
already speaks fluently and pronounces individual words correctly. Your job \
is to comment ONLY on rhythm, stress, reductions, pausing, phrase grouping \
and intonation.

You will receive structured acoustic measurements comparing a reference \
recording to the user's attempt at the same sentence. Base every statement \
strictly on those measurements. Never invent an observation that is not \
supported by the data. Never comment on pronunciation of individual sounds, \
grammar, vocabulary, accent origin, or native-likeness as a percentage.

Respond with a JSON object containing exactly these keys:
  "positive"     - one specific thing the user did well, citing a real word
  "primary_issue"   - the most important correction, or null if none
  "secondary_issue" - a second correction, or null
  "next_attempt"    - one concrete instruction for the next take

Keep each field to one or two sentences. Be direct and encouraging without \
generic praise. Write stressed words in CAPS.
"""


def _llm_feedback(comparison: Comparison, fallback: Feedback) -> Feedback:
    """Generate feedback wording with the Claude API.

    Only the structured analysis is sent. Raw audio never leaves the
    machine, which is both a privacy property and the anti-hallucination
    measure the spec calls for.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")

    try:
        import anthropic
    except ImportError as exc:
        raise RuntimeError("the 'anthropic' package is not installed") from exc

    payload = _llm_payload(comparison)
    client = anthropic.Anthropic(api_key=api_key)

    response = client.messages.create(
        model=os.environ.get("PROSODY_LLM_MODEL", "claude-sonnet-5"),
        max_tokens=800,
        system=COACH_SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": (
                "Here are the prosodic measurements for this shadowing attempt:\n\n"
                + json.dumps(payload, indent=2)
                + "\n\nRespond with the JSON object only."
            ),
        }],
    )

    text = "".join(block.text for block in response.content if block.type == "text").strip()
    data = _parse_json_object(text)

    return Feedback(
        positive=str(data.get("positive") or fallback.positive),
        primary_issue=data.get("primary_issue") or fallback.primary_issue,
        secondary_issue=data.get("secondary_issue") or fallback.secondary_issue,
        next_attempt=str(data.get("next_attempt") or fallback.next_attempt),
        categories=fallback.categories,
        source="llm",
    )


def _llm_payload(comparison: Comparison) -> dict[str, Any]:
    """The measured facts, trimmed to what the coach needs to write."""
    return {
        "reference_transcript": comparison.reference.transcript,
        "user_transcript": comparison.user.transcript,
        "reference_beats": [w.text.strip(".,!?;:") for w in comparison.reference.anchors],
        "user_beats": [w.text.strip(".,!?;:") for w in comparison.user.anchors],
        "reference_phrases": [p.text for p in comparison.reference.phrases],
        "user_phrases": [p.text for p in comparison.user.phrases],
        "user_speaks_slower_by": round(comparison.rate_ratio, 2),
        "ranked_issues": [
            {
                "type": issue.type.value,
                "span": issue.span.strip(),
                "severity": round(issue.severity, 2),
                **issue.detail,
            }
            for issue in comparison.issues[:6]
        ],
    }


def _parse_json_object(text: str) -> dict[str, Any]:
    """Extract a JSON object from a model response."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end > start:
        return json.loads(text[start:end + 1])

    raise RuntimeError("could not parse JSON from the model response")
