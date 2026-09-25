# Rhythm Flow

I want to build an initial UI/UX mock-up for a web app that helps fluent English speakers develop more natural American English rhythm, stress, intonation, and connected speech.

Target user

The primary users are advanced/non-native English speakers who are already fluent and can generally pronounce individual English words correctly. Their main difficulty appears during continuous or spontaneous speech: their rhythm, sentence stress, pauses, reductions, linking, or intonation can make them sound less native even when every individual word is pronounced correctly.

The app should therefore focus primarily on prosody and connected speech rather than basic pronunciation.

Core practice loop

The main training session consists of three stages:

1. Shadow

The user chooses a native speaker they want to imitate by:

 Pasting a YouTube link

 Uploading an audio/video file

 Eventually choosing from example speakers provided by the app

The app presents a short segment of that speaker's speech. The user listens to it and records themselves imitating not only the words, but also the speaker's rhythm, stress, pauses, reductions, and intonation.

2. Compare & get feedback

After recording, the user sees a comparison between the reference speaker and their recording.

For the mock-up, simulate the AI analysis with placeholder data. Do NOT implement actual speech analysis or AI functionality yet.

Design a feedback screen that could eventually show:

 Overall rhythm/intonation similarity

 Which words/syllables received major stress

 Places where the user over-stressed words

 Places where words should have been reduced or linked

 Pauses that differed from the reference

 Intonation/pitch differences

 A waveform or timeline comparing the two recordings

 1–3 specific, actionable suggestions rather than overwhelming the user with corrections

The user should be able to listen to the native recording, listen to their own recording, and try the sentence again.

3. Improvise

This is a critical part of the training method.

After successfully shadowing the reference, remove the script and ask the user to explain or paraphrase the same idea in their own words.

The purpose is to determine whether the rhythm and intonation patterns practiced during shadowing transfer to spontaneous, unscripted speech.

The user records their spontaneous response and receives another simulated feedback screen focused on whether they maintained natural rhythm, stress, pauses, and intonation without having a script to copy.

UX priorities

For this first version, prioritize usability and the practice experience over feature quantity.

I want the practice flow to feel extremely simple:

Choose clip → Shadow → Feedback → Try again if needed → Improvise → Feedback → Session complete

Avoid clutter and avoid making the app feel like a traditional language-learning course with dozens of lessons and menus.

The recording experience should be the central focus of the interface.

The visual style should feel modern, polished, minimal, and slightly premium rather than playful or childish. This product is aimed primarily at adults who already speak English well.

For this mock-up, design:

 A simple landing/dashboard screen

 A "Start Practice" flow

 A screen for adding a YouTube URL or uploading media

 The shadowing/recording interface

 The shadowing feedback/comparison screen

 The spontaneous paraphrasing interface

 The spontaneous-speech feedback screen

 A simple session-complete screen showing what the user improved and what to focus on next

Use realistic placeholder transcripts, waveforms, scores, and AI feedback so we can evaluate the design even though the underlying AI does not exist yet.

Important: Do not build any real AI, speech recognition, YouTube processing, or audio-analysis functionality yet. Mock these interactions with sample data. The goal right now is to design and validate the user experience.

If something important about the UX is ambiguous, ask me before making a major product decision.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/41abce4c-89ea-4d6e-941a-8aa616b46e47).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
