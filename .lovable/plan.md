# Phrase-by-phrase practice

## Goal
Add a mocked phrase-analysis step after choosing a source, so learners can understand the clip’s rhythm before recording either the full clip or one phrase at a time.

## What will change
- Limit media uploads to `.wav` and update all upload labels and sample file details accordingly.
- Add a new analysis screen between source selection and recording, with a short loading state followed by the supplied eight mocked phrases and their pause lengths.
- Show an accent structure view using clear rise and fall arrows on emphasized words.
- Make every phrase a large, accessible selection control with a clear selected state and a quick reference-play action.
- Add a simple practice scope switch: **Full clip** or **Selected phrase**.
- Carry the selected scope into the recording screen, including the matching transcript, duration, waveform context, and back navigation.
- Keep the existing comparison, improvise, and completion screens mocked and intact.

## Usability details
- Default to **Full clip** so the main path remains one tap away.
- Selecting a phrase automatically switches to phrase practice; choosing **Full clip** clears the phrase selection.
- Keep the phrase list vertically scannable, with pause timing secondary to the spoken text.
- Preserve the centered mobile-first layout and existing editorial visual style.

## Technical details
- Add a `breakdown` stage and mocked phrase data to the cadence data module.
- Build a focused breakdown component and pass the chosen practice target through the existing practice page state.
- Update source upload acceptance to `.wav,audio/wav,audio/x-wav` without adding storage, processing, or analysis services.

## Validation
- Test YouTube and WAV source paths through breakdown, full-clip recording, and individual-phrase recording.
- Verify the selected transcript and timing appear correctly on the recording screen.
- Check desktop and mobile layouts for centered content, readable phrase controls, no overflow, and no browser errors.
