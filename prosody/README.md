# Prosody Coach

A standalone American English prosody analysis engine with a command-line
client. It compares a learner's shadowing attempt against a native
reference recording and explains, in specific and actionable terms, how the
learner's rhythm differs.

This implements the algorithm described in
`../specs/american_english_prosody_coach_context.md`, scoped to the
"immediate implementation target" in section 34: the shadowing case, where
the learner repeats the same sentence as the reference.

It is not a pronunciation checker. It says nothing about individual sounds,
vowel quality, grammar, vocabulary, or how "native" someone sounds. It
measures rhythm, stress, reduction, pausing, phrase grouping and intonation.

---

## Quick start

No audio and no model download required:

```bash
cd prosody
pip install numpy
python demo.py
```

That synthesises a reference utterance and two learner attempts, then runs
the real analysis pipeline over them. Only the audio is synthetic; the
pitch tracker, prominence model, comparison layer and feedback generator
are the same code that runs on real recordings.

To compare two real recordings, install the transcription stack as well:

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
source .venv/bin/activate       # macOS / Linux

pip install -r requirements.txt
python -m prosody_coach compare reference.wav user.wav
```

The first real run downloads the Whisper model (about 500 MB for `small`)
and caches it under `~/.cache/huggingface`. Later runs skip that.

---

## What the output looks like

```
REFERENCE
  I THOUGHT↗ it'd be QUICK↘, | but it took way LONGER↘ than i expected.

YOU
  i THOUGHT IT | would BE QUICK, | BUT | IT took way longer than i expected.

RHYTHM
  reference  · THOUGHT ·· QUICK ···· LONGER ···
  you        · THOUGHT ··· QUICK ···· LONGER ···

FEEDBACK
  Good:      You put the beats on the right words: THOUGHT, QUICK and LONGER.
  Work on:   You are giving almost every word the same weight. The reference
             separates THOUGHT, QUICK and LONGER clearly from the words
             around them, and your version flattens that difference.
  Also:      You are giving "but it" more weight than the reference does.
  Try next:  Lean harder into THOUGHT -> QUICK -> LONGER and let everything
             else drop away.
```

Reading the display:

| Convention | Meaning |
|---|---|
| `BOLD CAPS` | an anchor, a main rhythmic beat |
| dim lowercase | reduced, low-prominence bridge material |
| `\|` | a prosodic phrase boundary |
| `↗` `↘` | pitch movement across a beat |
| red | a word the learner stressed that the reference does not |
| yellow | a reference beat the learner flattened |

---

## Commands

```bash
# Compare a learner attempt against a reference.
python -m prosody_coach compare reference.wav user.wav

# Add per-word measurements, speaker stats and the full ranked issue list.
python -m prosody_coach compare reference.wav user.wav --verbose

# Write the structured analysis for inspection or for another program.
python -m prosody_coach compare reference.wav user.wav --json analysis.json

# Have Claude word the feedback instead of the templates.
export ANTHROPIC_API_KEY=sk-...
python -m prosody_coach compare reference.wav user.wav --llm

# Inspect one recording's prosodic structure on its own.
python -m prosody_coach analyze reference.wav --verbose

# Larger model, better timings on accented speech, slower.
python -m prosody_coach compare ref.wav user.wav --model medium
```

Useful flags: `--ascii` for consoles that cannot render box-drawing
characters, `--no-color` to drop ANSI codes, `--language` for a non-English
reference.

Audio input can be any common format (WAV, MP3, M4A, WebM, FLAC, ...).
Non-WAV files are decoded with PyAV, which bundles FFmpeg's libraries, so no
ffmpeg executable needs to be installed.

---

## How it works

The design keeps measurement strictly separate from coaching prose. That is
the spec's section 19 requirement, and it is what stops the feedback layer
from inventing observations the acoustics do not support.

```
reference.wav ─┐
               ├─> transcribe ─> analyse ─┐
user.wav ──────┘                          ├─> compare ─> rank ─> feedback
                                          ┘
```

| Module | Responsibility |
|---|---|
| `audio.py` | Loading, resampling, F0 tracking, intensity |
| `transcribe.py` | Word-level timestamps via faster-whisper |
| `analysis.py` | Layer A: normalisation, prominence, anchors, bridges, phrases |
| `compare.py` | Layer A: alignment, rate correction, ranked issues |
| `feedback.py` | Layer B: coaching prose from measured facts only |
| `render.py` | Terminal display |
| `models.py` | The shared data model, fully JSON-serialisable |

### Three ideas do most of the work

**Speaker normalisation.** Raw Hertz is never compared between speakers. A
deep voice and a high voice have different ranges, so every measurement
that crosses speakers is converted to a z-score against that speaker's own
distribution, and pitch is measured in semitones above the speaker's
baseline. A learner with a higher voice than the reference produces
identical anchors when their rhythm matches.

**Rate normalisation.** A learner speaking 20 percent slower is not making
a rhythm error. Before comparing any duration, the global articulation-rate
difference is divided out, so only *disproportionate* timing is reported.
The test suite enforces this: a correct-but-slower attempt raises no rhythm
or bridge issues at all.

**Corroboration between cues.** A word is prominent when duration, pitch
and intensity agree. A short function word with a tall pitch spike is
almost always a phrase-initial pitch reset, which signals "new thought
group", not "this is the beat". Scoring that as prominence produced
spurious anchors on words like "it", so an unsupported pitch cue is damped.

### What counts as an issue

Issues are ranked by the spec's section 20 priority order: rhythm mismatch
first, then excessive prominence, phrase boundaries, reductions, pauses,
intonation, and small timing differences last. At most two are ever
reported, alongside one positive observation and one concrete instruction.

The reference speaker is the target throughout. The system does not consult
grammar rules to decide what "should" be stressed; if the reference
stresses LONGER, that is the goal.

---

## Feedback wording

Templates are the default. They are deterministic, run offline, cost
nothing, and are unit-tested for the properties the spec asks for: no bare
generic praise, at most two corrections, never contradicting themselves.

`--llm` sends the structured analysis to the Claude API for nicer wording.
Only the measurements are sent. Audio never leaves your machine. If the key
is missing or the call fails, it falls back to templates and says so, so
the tool always produces output.

---

## Worker (web app integration)

The Practice page does not call this package directly. The browser asks
Supabase for an analysis (`request_analysis` RPC in
`../supabase/migrations`), which either returns a stored one or queues a
`processing` row. `prosody_worker` claims queued rows, fetches the audio
(yt-dlp for YouTube, decoded to WAV with PyAV; the `reference-audio` Storage bucket for uploads),
runs `analyze_recording`, and writes the result back. The page then picks
the result up over Realtime.

YouTube downloads need a JavaScript runtime on PATH to pass YouTube's
challenge: Node (already required for the web app), Deno or Bun. Without
one, downloads fail with HTTP 403 now and then; the worker warns at startup.

```bash
pip install -r requirements-worker.txt       # no ffmpeg install needed
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY come from ../.env
python -m prosody_worker                      # poll forever
python -m prosody_worker --once               # drain both queues and exit
```

**Attempts.** When a learner submits a shadowing take, the browser uploads
it to the `attempt-audio` bucket (webm/ogg/mp4/wav, as the browser recorded
it) and calls `request_attempt`. The worker analyses the take, compares it
with the stored reference `Recording` (cut down to the practised phrase, if
any) using `build_comparison`, and writes a view model to `attempts.result`.
Attempts run on their own thread with their own Supabase client, so a
learner waiting on feedback never queues behind a long reference analysis.
Log lines are tagged `[analyses]` or `[attempts]`.

Analyses are cached per source (`youtube:<id>` or `upload:<sha256>`),
Whisper model and `ANALYZER_VERSION`. Bump the version in both
`prosody_worker/config.py` and `analysis_settings()` in the migration
when the engine's output changes, so clips get re-analysed.

Each `analyses` row keeps the speaker-level summary (transcript, duration,
pitch baseline and range, speech and articulation rate, total pause time)
in typed columns and the full `Recording.to_dict()` in `recording` (jsonb),
so new per-word measurements need no migration.

### Hosted project

```bash
npx supabase login
npx supabase link --project-ref <ref>        # from the dashboard URL
npx supabase db push                         # applies ../supabase/migrations
```

Copy `../.env.example` to `../.env` and fill it in from Settings > API.
The worker and importer load `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
from that file (via python-dotenv); variables set in the shell win.

### Importing CLI analyses

An `analyze --json` file can be saved to the table without re-running
Whisper. The row is keyed like the browser keys the same source, so asking
for that clip in the app returns it straight away:

```bash
python -m prosody_worker.importer analyses/clip.wav.json --audio clip.wav
python -m prosody_worker.importer analyses/<id>.json --youtube <url>
```

---

## Tests

```bash
python tests/test_prosody.py     # no pytest needed
python -m pytest tests/ -v       # if you have pytest
```

55 tests, all running on synthetic audio with known ground truth, so they
need no recordings and no model download. They cover the pitch tracker
against known frequencies, anchor and bridge detection, phrase
segmentation, alignment, rate normalisation, issue ranking, the feedback
constraints, rendering and JSON serialisation.

---

## Scope

Built, per section 34:

- transcription with word-level timing
- prosodic phrase segmentation
- pitch, intensity and duration extraction
- speaker-normalised prominence detection
- anchor and bridge identification
- reference/user alignment and comparison
- issue ranking and structured output
- coaching feedback, templated or LLM-worded
- visual terminal rendering

Deliberately not built, per section 23 and the answers given at the outset:

- syllable-level timing (word level only in v1)
- the spontaneous/paraphrase mode of section 24
- phoneme, vowel or consonant scoring
- any "percent native" figure

### Known limits

Whisper word timestamps are accurate to roughly 30 to 50 ms. That is fine
for word-level ratios and for locating a pitch peak, but it is not
phoneme-grade alignment.

The syllable counter is a spelling heuristic, including a rule for syllabic
consonants so "rhythm" counts as two. It feeds a z-score, so small errors
wash out across a sentence, but a pronouncing dictionary would be more
accurate.

Text-to-speech audio has flatter and less regular prosody than human
speech, so the detected anchors on synthesised references will not always
match what a person would stress. The engine is built for human recordings.
