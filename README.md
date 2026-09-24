# Genbient

A generative ambient instrument for the phone. Every scene is built from a seed, you can play along by dragging a finger anywhere, and everything is synthesised live in the browser. Nothing is a recording.

**Live:** https://chraltro.github.io/genbient/

## What's in it

- **28 layers** in five groups, each with its own controls (level, filter, pan, reverb and echo sends, plus instrument-specific shape):
  - *Harmony*: drone, pads (6 timbres), strings, formant choir, shimmer, bass (7 patterns)
  - *Melody*: arpeggiator, felt piano, kalimba, FM bells, marimba, flute/shakuhachi/ocarina, singing bowls
  - *Rhythm*: soft kick, hand drum, shaker/hats/brush, woodblock/clave/rim, heartbeat, all on Euclidean patterns
  - *Nature*: rain, ocean, stream, wind, fire, birdsong, crickets and frogs, distant thunder
  - *Mind*: binaural beats with optional isochronic pulse, noise bed
- **About 300 controls**, all declared once in a schema (`js/params.js` and each layer's `static schema`). The UI renders from it, the generator randomises it, and share links encode it.
- **Music engine**: tempo transport with meter (4/4, 3/4, 5/4, 6/8, 7/8, 9/8), swing and humanise. Chord loops and other progression styles change on the bar, with chord colour (7ths, 9ths, suspensions), inversions, voice leading and modulation. Melodic layers play motifs that repeat and develop, or arpeggios, wandering lines or chords.
- **Procedural scenes**: 12 moods × energy, with a Rhythm on/off mode (off: no drums, held bass, and Random makes beatless scenes). The **Random** button rolls a new scene. Regenerate one part (harmony, rhythm, melody, texture, sound, colours) and keep the rest. Journey mode drifts on its own, and an evolution setting slowly reshapes sounds while you listen.
- **Running**: pick a cadence (150–180 steps a minute) for a kick on every step, hats in between and a pulsing bass, locked to that tempo for the whole run. A looping silent media element keeps iOS playing with the screen locked.
- **Touch**: drag anywhere. Left to right plays notes in key (5 instruments), up and down opens the tone and space of the whole mix.
- **Share links** carry the complete state.
- **Sleep tools**: sleep timer, breathing guide, wake lock, battery modes.

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
