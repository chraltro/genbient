# Genbient

A generative ambient instrument for the phone. Every scene is built from a seed, you can play along by dragging a finger anywhere, and everything is synthesised live in the browser. Nothing is a recording.

**Live:** https://chraltro.github.io/genbient/

## How it's laid out

- **Listen · Run · Sleep** at the top are the three ways to use it. Under the scene name, each shows only its own few controls:
  - *Listen*: rhythm on or off, free or song chords (with the current verse or chorus shown), how often a new scene drifts in, and a mood row that plays a new scene in that mood.
  - *Run*: cadence with − and +, Tap to set it from your steps, the section, interval round and run clock, a Skip button (skip the warm-up, or on to the next push or easy stretch), intervals and run length. *More* opens the full running settings, including warm-up length.
  - *Sleep*: timer up to 3 hours, fade length (1, 5 or 15 min), Wind down, one-tap sleep sounds (sleepier scene, rain, ocean, brown noise, stream, night, fire) and the breathing guide. The minutes left show next to the word Sleep, and the lines dim once the interface fades.
- **Rec** and **Share** sit top right. **‹ Back** and **Save** sit under the scene name.
- The dock holds the deep editing: **Scenes** (saved, recent, mood, energy, regenerate one part, starting points), **Layers**, **Random**, **Music**, **Sound**.

## What's in it

- **28 layers** in five groups, each with its own controls (level, filter, pan, reverb and echo sends, plus instrument-specific shape):
  - *Harmony*: drone, pads (6 timbres), strings, formant choir, shimmer, bass (7 patterns)
  - *Melody*: arpeggiator, felt piano, kalimba, FM bells, marimba, flute/shakuhachi/ocarina, singing bowls
  - *Rhythm*: soft kick, hand drum, shaker/hats/brush, woodblock/clave/rim, heartbeat, all on Euclidean patterns
  - *Nature*: rain, ocean, stream, wind, fire, birdsong, crickets and frogs, distant thunder
  - *Mind*: binaural beats with optional isochronic pulse, noise bed
- **About 300 controls**, all declared once in a schema (`js/params.js` and each layer's `static schema`). The UI renders from it, the generator randomises it, and share links encode it.
- **Music engine**: tempo transport with meter (4/4, 3/4, 5/4, 6/8, 7/8, 9/8), swing and humanise. Chord loops and other progression styles change on the bar, with chord colour (7ths, 9ths, suspensions), inversions, voice leading and modulation. Melodic layers play motifs that repeat and develop, or arpeggios, wandering lines or chords.
- **Saved and recent scenes**: *Save* under the title keeps a scene in *Scenes → Saved*. Every scene you leave goes into *Recent*. *Back* (or Back on the notice after Random, or the previous-track button on headphones and the lock screen) returns to the last one.
- **Song chords**: 100 chord progressions of the kind real songs use (`js/progressions.js`), written per scale so every chord comes out right: major, minor, dorian, mixolydian, lydian, phrygian, harmonic minor and pentatonic. With Song chords on, a scene picks a verse and a chorus and plays verse twice, chorus twice, round again, never rewritten. It keeps its key, chords change at a song's pace (at most about 10 s), and there are fewer suspensions and inversions. Off by default; new scenes follow the setting, and scenes in unusual scales move to the nearest familiar one.
- **Procedural scenes**: 12 moods × energy, with a Rhythm on/off mode (off: no drums, held bass, and Random makes beatless scenes). The **Random** button rolls a new scene. Regenerate one part (harmony, rhythm, melody, texture, sound, colours) and keep the rest. Journey mode drifts on its own, and an evolution setting slowly reshapes sounds while you listen.
- **Running**: set a cadence (−/+, tap along with your steps, or presets from 150 to 180). The kick lands on every step and never drops out. Everything musical is locked to the step grid: no swing, straight echoes, and chords and melodies in half-time. In *Evolving song* mode an arranger (`js/conductor.js`) moves through intro, groove, lift, peak, breakdown and build sections. Instruments take turns, drums change pattern, and fills, risers and impacts mark the transitions. Intensity is Easy, Steady or Push. *Steady loop* keeps everything fixed. A run clock counts time while the music plays. *Intervals* (1/2, 2/2 or 4/3 minutes of push and easy, after a 5 minute warm-up) switch the arranger into a peak or a breakdown, can raise the cadence during a push, and mark each change with two soft bell notes. A run length (20 to 90 min) ends the run with bells and an easy cool-down. Random during a run gives new music on the same beat. A looping silent media element keeps iOS playing with the screen locked.
- **Touch**: drag anywhere. Left to right plays notes in key (5 instruments), up and down opens the tone and space of the whole mix.
- **Record**: the Rec button captures a lossless 16-bit stereo WAV (at the device's sample rate). The capture sits before the volume control and runs in an AudioWorklet. Optional 1.5 s fades, peak levelling to −1 dB and auto-stop. The scene's share link is written into the file's metadata. You can listen back to the clip before saving it. It saves through the share sheet on phones and downloads on computers.
- **Share links** carry the complete state.
- **Sleep tools**: sleep timer with a chosen fade (scheduled on the audio clock, so it still happens if the phone suspends the page). *Wind down* slowly darkens the sound, slows the tempo by up to 12 % and thins it out over the timer, then restores the scene afterwards. Plus sleep sounds, breathing guide, wake lock and battery modes.
- **Keyboard**: space plays or pauses, G or N for Random, B for Back, S to save, R to record, L / U / Z for Listen, Run and Sleep, 1 to 4 open the panels, Esc closes them.
- **Updates**: the service worker fetches from the network first, so a new version shows up the next time the app opens. Offline, it falls back to the cache.

## Performance

The visuals are strokes and flat fills only (no blur, no gradients, no blend modes). They are frame-capped at 30 fps by default, 12 fps when paused and 10 fps behind a panel. Only one convolution reverb runs at a time. *Sound → Battery → Saver* drops to 20 fps and fewer lines.

## Running locally

No build step and no dependencies:

```sh
npx http-server . -p 8080
```

## Structure

```
js/main.js            UI, sheets, touch input, share, timers
js/engine.js          transport, master effects, evolution
js/touch.js           the screen as an instrument
js/params.js          global parameter schema
js/theory.js          scales, chords, progressions, voice leading
js/composer.js        Euclidean rhythms, motifs, arpeggios
js/scenes.js          palettes, moods, generator, rerolls, share encoding
js/visuals.js         ridge-line visuals
js/layers/*.js        every sound layer and its schema
```

## Deployment

`.github/workflows/pages.yml` publishes to GitHub Pages on every push to `main`.
