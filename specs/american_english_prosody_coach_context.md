# American English Prosody Coach — Product + Algorithm Context

## Purpose of this document

This document captures the current product vision, training method, UX direction, and technical plan for an app that helps fluent English speakers improve their American English rhythm, stress, intonation, pausing, reductions, and connected speech.

It is intended to give an implementation-focused coding model enough context to begin building the system without needing to reconstruct the product goals from prior conversation.

The central idea is:

> This is not primarily a pronunciation app. It is a prosody and connected-speech coaching app.

The target user can already speak English fluently and can usually pronounce individual words correctly. The problem appears when the user has to connect words, clauses, and sentences in real time.

The app should help the user sound more natural by training the prosodic structure of American English.

---

# 1. Product vision

The app should help advanced non-native English speakers improve:

- sentence stress
- rhythm
- intonation
- reductions
- linking
- pausing
- phrase grouping
- connected speech
- spontaneous transfer of those skills into unscripted speech

The product should focus on speakers who do **not** need basic English lessons and do **not** primarily struggle with isolated word pronunciation.

The typical user may:

- pronounce most English words correctly in isolation
- speak English fluently
- have strong grammar and vocabulary
- still sound noticeably non-native during longer stretches of speech
- give too many words equal emphasis
- pause in unusual places
- fail to reduce function words naturally
- use rhythm patterns influenced by their first language
- sound more natural while reading or shadowing than while speaking spontaneously

The goal is to help those users improve speech-level prosody.

---

# 2. Core training philosophy

The training method should follow this progression:

1. **Listen to a native reference**
2. **Shadow it**
3. **Receive feedback**
4. **Repeat if needed**
5. **Paraphrase or improvise the same idea**
6. **Receive feedback on spontaneous speech**
7. **Gradually move into longer, freer speech**

The key insight is that successful imitation does not guarantee spontaneous transfer.

A learner may be able to perfectly mimic:

> I thought it'd be quick, but it took way longer than I expected.

but revert to their old rhythm when they have to generate their own sentence.

Therefore the app should explicitly train the transition from:

> imitation → controlled paraphrase → spontaneous speech

This transfer step is a core differentiator.

---

# 3. Core practice loop

The high-level user flow should be:

**Choose clip → Shadow → Feedback → Retry if needed → Improvise → Feedback → Session complete**

## Stage 1 — Shadow

The user selects a native speaker to imitate.

Possible sources:

- YouTube link
- uploaded audio file
- uploaded video file
- eventually, built-in curated clips

The app presents a short segment.

The user listens and records themselves imitating:

- rhythm
- stress
- pausing
- reductions
- linking
- pitch movement
- overall delivery

The purpose is not merely to pronounce the same words correctly.

The user should attempt to reproduce the **prosodic architecture** of the speaker.

---

## Stage 2 — Feedback on shadowing

The user's recording is compared to the native reference.

The app should eventually give feedback such as:

- which words/syllables carried the main stress
- which words should have been reduced
- where the user added unnecessary stress
- where the user inserted pauses
- where the reference used a pause and the user did not
- where the user's pitch contour differed
- whether the user gave too much time to unstressed material
- whether the user segmented the sentence too heavily
- whether important words lacked prominence

The feedback should be concise and actionable.

Do not overwhelm the user with every measurable difference.

A good result should contain roughly:

- one thing done well
- one or two major issues
- one specific instruction for the next attempt

Example:

> **Good:** Your emphasis on QUICK matched the reference well.
>
> **Work on:** You're giving "it would be" too much rhythmic weight.
>
> **Try next:** Glide through "it would be" and save the emphasis for QUICK.

---

## Stage 3 — Improvise / paraphrase

After shadowing, remove the script.

Ask the user to express the same idea in their own words.

Example:

Reference:

> I thought it was sold out, but then a spot opened, so I grabbed it.

Paraphrase:

> I thought all the seats were taken, but then I found one free seat on the website, so I booked it.

The user should receive prosody feedback again.

The purpose is to see whether the user's improved rhythm survives when the user must think and speak at the same time.

---

# 4. UX direction

The app should feel:

- modern
- clean
- minimal
- adult
- premium
- focused

Avoid making it feel like a children's language-learning app.

The recording experience should be central.

Avoid clutter and avoid excessive gamification.

The interface should make the practice flow obvious.

Potential screens:

1. Dashboard / home
2. Start Practice
3. Add YouTube URL or upload media
4. Clip selection
5. Shadowing screen
6. Shadowing feedback screen
7. Retry screen
8. Paraphrase / spontaneous speech screen
9. Spontaneous speech feedback
10. Session complete / summary

---

# 5. Key product principle: do not reduce everything to a "native score"

A generic score such as:

> Native similarity: 82%

is not sufficient.

A user needs to know **why** their speech sounds different and what to change.

The app may eventually show summary scores, but the core experience should remain interpretable.

For example:

### Reference

I **THOUGHT** it'd be **QUICK**, but it took way **LONGER** than I expected.

### User

I **THOUGHT** **IT** would **BE QUICK**, **BUT** it took way **LONGER** than I expected.

Feedback:

- **Good:** THOUGHT, QUICK, and LONGER were emphasized well.
- **Too much stress:** IT, BE, BUT
- **Reduction:** "it would be" should move more lightly.
- **Pausing:** good.
- **Intonation:** mostly matched the reference.
- **Next attempt:** keep THOUGHT → QUICK → LONGER as the main rhythmic anchors.

---

# 6. Core conceptual model: anchors and bridges

The training system should use an intuitive model:

## Anchors

Anchors are the stressed syllables or words that carry the main rhythmic beats.

Example:

> **THOUGHT** → **QUICK** → **LONGER**

## Bridges

Bridges are the lower-prominence material connecting those anchors.

Example:

> **THOUGHT** → *it'd be* → **QUICK**

A bridge usually has:

- shorter duration
- lower relative prominence
- less pitch movement
- lower intensity
- fewer pauses
- more connected articulation

The UI can use language like:

> Glide through "it'd be."

Internally, the system should treat "gliding" as measurable prosodic compression.

---

# 7. Recommended internal speech hierarchy

Represent speech at several levels:

**Recording**
→ Sentence
→ Prosodic phrase / thought group
→ Word
→ Syllable

Eventually phoneme-level information may be useful, but it is not required for the first version.

---

# 8. High-level algorithm

The system takes two audio inputs:

1. reference/native audio
2. user audio

The pipeline should conceptually look like this.

## Reference side

Reference audio  
→ transcription  
→ sentence segmentation  
→ prosodic phrase segmentation  
→ word timing  
→ syllable timing  
→ acoustic feature extraction  
→ stress/prominence detection  
→ anchor/bridge detection  
→ pitch contour extraction  
→ pause structure

## User side

User audio  
→ transcription  
→ sentence segmentation  
→ word/syllable timing  
→ acoustic feature extraction  
→ stress/prominence detection  
→ pitch contour extraction  
→ pause structure

## Comparison

Reference ↔ User  
→ textual alignment  
→ temporal alignment  
→ prominence comparison  
→ relative-duration comparison  
→ pause comparison  
→ pitch-contour comparison  
→ phrase-boundary comparison  
→ error ranking  
→ structured feedback  
→ natural-language coaching feedback

---

# 9. Reference transcription and segmentation

The reference audio should first be transcribed.

Example:

> I thought it would be quick, but it took way longer than I expected.

Do not rely only on grammatical sentence boundaries.

For prosody, the system also needs meaningful speech groups.

A possible segmentation:

> I thought it'd be **QUICK**  
> but it took way **LONGER**  
> than I expected

These are prosodic phrases or thought groups.

The exact terminology used internally is flexible, but the system needs a representation of speech chunks smaller than a sentence and larger than a word.

---

# 10. Word and syllable timing

Precise timing is critical.

For each word, track:

| Word | Start | End |
|---|---:|---:|
| I | 0.00 | 0.11 |
| thought | 0.11 | 0.39 |
| it'd | 0.39 | 0.51 |
| be | 0.51 | 0.59 |
| quick | 0.59 | 0.94 |

Eventually syllable timing is preferable.

Example:

> ex-**PEC**-ted

Timing enables:

- word-duration analysis
- syllable-duration analysis
- pause detection
- phrase timing
- rhythm comparison
- reduction detection
- detection of unnecessary segmentation

---

# 11. Acoustic features to extract

## Pitch / F0

Track pitch over time.

Important rule:

**Do not compare raw Hz directly between speakers.**

Different speakers naturally have different pitch ranges.

Normalize pitch relative to each speaker's range or baseline.

The goal is to compare pitch behavior such as:

- rising
- falling
- peak location
- pitch range
- final fall
- local pitch emphasis

The relevant question is:

> Did both speakers create a pitch peak in the same linguistic area?

not:

> Did both speakers reach exactly 180 Hz?

---

## Intensity

Measure relative energy / loudness.

Intensity can contribute to perceived prominence.

Again, normalize within the speaker.

---

## Duration

Measure duration at the:

- phrase
- word
- syllable

levels.

Duration is especially important for reductions and "gliding."

Example:

Reference:

> **THOUGHT** | it'd-be | **QUICK**

User:

> **THOUGHT** | **IT** | **WOULD** | **BE** | **QUICK**

The user may be allocating too much time and prominence to bridge material.

---

## Pauses

Track:

- where pauses occur
- how long they last
- unnecessary pauses
- missing pauses
- phrase boundaries

Example:

Reference:

> I thought it'd be quick | but it took longer than expected.

User:

> I thought | it would be | quick | but | it took longer...

This can make the user's speech sound segmented even if pronunciation is correct.

---

# 12. Prominence / stress detection

The system should assign a prominence value to each word or syllable.

A first version can use a combination of:

- pitch movement
- duration
- intensity
- position in phrase
- surrounding context

The exact model can evolve later.

Possible categories:

- primary stress
- secondary stress
- reduced / low prominence

Important principle:

**The reference speaker is the target.**

Do not initially try to infer the "correct" stress entirely from grammar rules.

If the reference stresses LONGER, the user should generally aim to reproduce that prominence pattern.

---

# 13. Detecting bridges / reduction regions

Once prominence peaks are identified, low-prominence material between them becomes a candidate bridge.

Example:

> **THOUGHT** → *it'd be* → **QUICK**

For bridge regions, measure:

- total duration
- syllable duration
- pitch movement
- intensity
- internal pauses
- degree of connectedness

The feedback system can then say:

> You are giving "it would be" almost as much rhythmic weight as "quick."

or:

> Glide through "but then I" and save the stress for the next content word.

---

# 14. User/reference alignment

This is essential.

Do not compare audio by absolute timestamp.

The user may speak slower or faster.

Instead align the recordings by linguistic units.

## Textual alignment

Map:

reference "quick" ↔ user "quick"

reference "longer" ↔ user "longer"

## Temporal alignment

Account for overall differences in timing.

Dynamic time warping or a similar technique may eventually be useful for comparing pitch/rhythm contours that have similar shapes at different speeds.

---

# 15. Normalize for overall speech rate

Do not punish users simply for speaking more slowly.

A slower speaker can still have good rhythm.

Compare **relative allocation of time**.

Example:

Reference:

- stressed word: 300 ms
- bridge: 350 ms
- stressed word: 320 ms

User:

- stressed word: 350 ms
- bridge: 800 ms
- stressed word: 370 ms

The important problem is not merely that the user is slower.

The bridge is disproportionately long.

That is a rhythm issue.

---

# 16. Rhythm representation

It may be useful to represent a phrase as a sequence of prominence peaks.

Reference:

> **THOUGHT** · · **QUICK** · · · **LONGER**

User:

> **THOUGHT** · **IT** · **BE** · **QUICK** · **BUT** · · **LONGER**

This can expose excessive stress peaks.

Example feedback:

> The reference has three main rhythmic beats:
>
> **THOUGHT → QUICK → LONGER**
>
> Your version creates six.
>
> Try letting the words between those anchors move more lightly.

This is much more actionable than a generic "rhythm score."

---

# 17. Intonation comparison

Compare pitch contours at the phrase level.

Useful measurements may include:

- starting pitch
- ending pitch
- maximum pitch
- minimum pitch
- pitch range
- peak position
- slope
- rise/fall direction
- number of local pitch resets

Example:

Reference:

> But this is by **FAR** the **COOL**est thing that showed **UP** ↘

User:

> **BUT** ↗ **THIS** ↗ **IS** ↗ **BY** ↗ **FAR** ↗ ...

Possible feedback:

> The reference uses one larger pitch movement across the phrase. Your version resets the pitch on several individual words, which makes the sentence sound more segmented.

---

# 18. Phrase-boundary comparison

Longer speech often sounds non-native because of phrase grouping rather than word pronunciation.

Reference:

> I was ready to leave | but then I realized my keys were still inside | and by the time I found them | it was already late.

User:

> I was ready | to leave but then | I realized | my keys | were still inside...

The system should detect differences in:

- pause placement
- pause length
- phrase boundaries
- grouping

This is especially important for the target audience.

---

# 19. Separate analysis from feedback generation

Do not allow a language model to simply listen to raw audio and invent feedback.

Use two layers.

## Layer A — Speech analysis

Produce structured observations.

Example:

```text
user_stressed_words:
  - thought
  - it
  - be
  - quick
  - but
  - longer

reference_stressed_words:
  - thought
  - quick
  - longer

bridge_duration_ratio:
  segment: "it would be"
  user_relative_duration: 1.84

pause_difference:
  user_pause_after: "would"
  duration_ms: 280

intonation:
  reference_final_contour: falling
  user_final_contour: level
```

The exact data structure can be redesigned, but the important idea is that the feedback layer receives measurable facts.

## Layer B — Coaching feedback

Convert those observations into friendly advice.

Example:

> **Good:** Your emphasis on QUICK matched the speaker well.
>
> **Work on:** You're giving "it would be" too much weight.
>
> **Try:** Glide through "it would be" and save your emphasis for QUICK.

This separation reduces hallucination risk and makes the system more debuggable.

---

# 20. Feedback prioritization

The system should rank issues.

Example priority order:

1. major rhythm mismatch
2. excessive prominence
3. incorrect phrase boundaries
4. reduction issue
5. pause mismatch
6. major intonation mismatch
7. small timing differences

Do not report everything.

Per attempt, aim for roughly:

- 1 positive observation
- 1–2 major corrections
- 1 concrete instruction

---

# 21. Example feedback UI

## Reference

I **THOUGHT** it'd be **QUICK**, but it took way **LONGER** than I expected.

## You

I **THOUGHT** **IT** would **BE QUICK**, **BUT** it took way **LONGER** than I expected.

### Rhythm
Good

Your main stress on THOUGHT, QUICK, and LONGER was close to the reference.

### Reduction
Needs work

You gave "it would be" and "but" more prominence than the reference.

### Pausing
Good

Your phrase boundaries closely matched the speaker.

### Intonation
Good

Your final pitch movement was similar to the reference.

### Next attempt

Keep:

> **THOUGHT → QUICK → LONGER**

as the three main beats.

Let everything between them move more lightly.

---

# 22. Suggested MVP scope

The first algorithm should focus on:

1. transcription
2. sentence segmentation
3. word alignment
4. syllable timing if feasible
5. pause detection
6. pitch extraction
7. duration analysis
8. relative prominence detection
9. anchor/bridge detection
10. reference/user comparison
11. issue ranking
12. structured feedback generation
13. natural-language coaching feedback

Do **not** try to solve every accent problem initially.

---

# 23. Explicit non-goals for the MVP

Do not prioritize:

- phoneme-level pronunciation scoring
- vowel quality scoring
- consonant scoring
- detecting the user's first language
- guessing nationality or ethnicity
- "percent native" classification
- accent elimination
- grammar correction
- vocabulary correction

Those may eventually be separate modules.

The first product should remain focused on **prosody and connected speech**.

---

# 24. Spontaneous-speech mode

Eventually, the system must support speech that is not identical to the reference.

This is the purpose of the paraphrase stage.

The comparison problem is different.

For shadowing:

> same words → direct prosodic alignment

For paraphrasing:

> different words → evaluate whether the learned prosodic behavior transferred

The spontaneous mode should therefore evaluate general traits such as:

- number of prominence peaks per phrase
- function-word reduction
- phrase duration
- pause placement
- pause frequency
- pitch resets
- final intonation
- average prominence contrast
- speech chunking
- rhythm consistency

This mode should compare the user less literally to the source sentence and more to target American-English prosodic behavior.

---

# 25. Practice progression

The training experience should become progressively harder.

Possible progression:

### Level 1
Short shadowing phrase

### Level 2
Longer shadowing sentence

### Level 3
Two connected sentences

### Level 4
Paraphrase the source

### Level 5
30-second spontaneous response

### Level 6
60-second spontaneous story

### Level 7
Opinion response

### Level 8
Back-and-forth conversation

### Level 9
Technical or professional explanation

### Level 10
Emotionally expressive / high-speed conversation

The purpose is to move the learner from conscious imitation to automatic use.

---

# 26. Feedback style

Feedback should be:

- concise
- specific
- actionable
- encouraging without being vague
- comparative when a reference exists
- focused on one or two improvements at a time

Avoid generic praise such as:

> Nice!
> Great!
> Sounds good!

unless it is paired with a concrete observation.

Prefer:

> **Great:** your stress on QUICK and LONGER matched the reference, and "but it" stayed light.

or:

> **Good:** the phrase was clear, but "it would be" still had too much weight. Compress that bridge on the next attempt.

The user should understand **why** a take was good or bad.

---

# 27. Training-session philosophy

Do not make users repeat the exact same sentence indefinitely.

A good session should mix:

- imitation
- correction
- paraphrase
- unscripted speech
- longer connected speech
- varied topics

The purpose is transfer.

A possible session structure:

1. reference sentence
2. shadow once
3. receive feedback
4. shadow again
5. paraphrase
6. receive feedback
7. 30-second related spontaneous response
8. receive feedback
9. new reference sentence
10. repeat

Over time reduce direct imitation and increase spontaneous speech.

---

# 28. Example training round

## Reference

> I thought it was sold out, but then a spot opened, so I grabbed it.

## Shadow attempt

User repeats the exact sentence.

System evaluates:

- stressed anchors
- bridge compression
- timing
- pause placement
- pitch contour

## Shadow feedback

> **Good:** SOLD OUT and GRABBED carried the main stress well.
>
> **Work on:** "but then a" was too prominent.
>
> **Try:** Let "but then a" pass quickly and save the next beat for SPOT.

## Paraphrase prompt

> Say the same idea in your own words.

## User paraphrase

> I thought all the seats were taken, but then I found one free seat on the website, so I booked it.

## Spontaneous feedback

> Your rhythm held up well even without the script.
>
> The phrase "one free seat on the website" became slightly even in stress.
>
> Keep one main beat on FREE SEAT and let "on the website" trail more lightly.

This is the core behavior the product should eventually support.

---

# 29. Engineering principle: interpretable metrics first

Before trying to train a complicated end-to-end "accent score" model, prioritize interpretable signals.

Useful first-order measurements:

- word duration
- syllable duration
- pause timing
- F0 contour
- relative F0 peak
- relative intensity
- local prominence
- prominence contrast
- speaking rate
- relative bridge duration
- phrase-boundary location
- number of prominence peaks
- final pitch movement

These measurements are easier to debug and easier to turn into user-facing feedback.

---

# 30. Engineering principle: speaker normalization

Always account for differences between speakers.

Normalize:

- pitch
- loudness
- speech rate
- overall duration

The system should compare **patterns**, not raw values.

For example:

Wrong comparison:

> Native pitch = 130 Hz
> User pitch = 200 Hz
> Difference = bad

Correct comparison:

> Reference raises pitch 18% above local baseline on QUICK.
> User raises pitch only 3%.
> The user may not be giving QUICK enough prominence.

---

# 31. Engineering principle: relative rhythm matters more than raw speed

A user speaking 15% slower than the reference may still have excellent rhythm.

Focus on the relative timing structure.

For example:

Reference:

> anchor: 300 ms
> bridge: 350 ms
> anchor: 320 ms

User:

> anchor: 350 ms
> bridge: 800 ms
> anchor: 370 ms

The main issue is the bridge-to-anchor ratio, not absolute speaking speed.

---

# 32. Potential structured output model

A useful analysis result could eventually include:

```text
sentence:
  transcript: ...
  start_time: ...
  end_time: ...

phrases:
  - text: ...
    start_time: ...
    end_time: ...
    reference:
      anchors: [...]
      bridges: [...]
      pause_after_ms: ...
      pitch_pattern: ...
    user:
      anchors: [...]
      bridges: [...]
      pause_after_ms: ...
      pitch_pattern: ...
    differences:
      - type: excessive_prominence
        span: ...
        severity: ...
      - type: bridge_too_long
        span: ...
        severity: ...
      - type: pause_mismatch
        span: ...
        severity: ...

feedback:
  positive: ...
  primary_issue: ...
  secondary_issue: ...
  next_attempt_instruction: ...
```

This is only conceptual. The implementation may use different schemas.

---

# 33. Product differentiation

The app should not position itself as:

> another app that tells you whether you pronounced a word correctly

Instead:

> a coach that teaches fluent English speakers how to sound more natural across entire sentences and spontaneous conversation.

The unique promise is:

> Learn the rhythm of native speech, then learn to keep that rhythm when you stop reading and start thinking.

---

# 34. Immediate implementation target

The first technical prototype should support one narrow scenario extremely well:

1. user provides a short reference recording
2. reference is transcribed
3. user records the same sentence
4. system aligns the same words
5. system identifies:
   - major stress peaks
   - low-prominence bridges
   - pauses
   - relative timing
   - pitch movement
6. system compares reference and user
7. system generates 1–3 pieces of useful feedback
8. system visually highlights stress and glide regions

Example visual output:

> I **THOUGHT** it'd be **QUICK**, but it took way **LONGER** than I expected.

Possible visual conventions:

- bold / caps = anchors
- lighter text = reduced words
- vertical bars = phrase boundaries
- arrows = pitch movement
- color or underline = mismatch with user

The exact visual system can be refined later.

---

# 35. Questions that can be deferred

The following decisions do not need to be finalized before building the first prototype:

- exact ML model for prominence detection
- exact pitch-normalization method
- whether syllable alignment is mandatory in v1
- whether to use an LLM for feedback wording
- exact scoring formula
- whether to provide a numeric score
- long-form spontaneous speech evaluation
- accent-specific phoneme feedback
- built-in curriculum design
- social/gamification features

The first goal is to prove that the system can produce feedback that feels as useful as a good human pronunciation/prosody coach.

---

# 36. Success criterion for the first prototype

Given:

- a short native reference recording
- a user recording of the same sentence

the system should be able to produce feedback of approximately this quality:

> **Good:** Your stress on QUICK and LONGER closely matched the reference.
>
> **Work on:** You're giving "but it would be" too much weight, which makes the phrase sound more segmented.
>
> **Try next:** Treat QUICK and LONGER as your main beats. Let the words between them glide together more lightly.

If the prototype can reliably produce feedback of this type from measurable acoustic differences, the core concept is working.

---

# 37. Longer-term vision

Once shadowing works reliably, expand into:

- paraphrasing
- spontaneous monologues
- conversational back-and-forth
- professional speaking
- storytelling
- interviews
- presentations
- domain-specific speaking practice

Eventually the system should recognize when the user is reverting to old rhythm patterns during longer unscripted speech and surface those moments.

That is the long-term training objective:

> make improved prosody automatic, not merely reproducible during imitation.
