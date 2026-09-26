# Genbient

**Generative ambient music you can play with a finger.** Every scene is composed on the spot from a seed: harmony, melody, rhythm, weather and colour. Everything is synthesised live in the browser. There are no samples, no recordings, no accounts and no tracking.

**Try it:** https://chraltro.github.io/genbient/ (best on a phone, with headphones)

It installs as an app from the browser's share menu ("Add to Home Screen") and works offline after the first visit.

## Four ways to use it

- **Listen.** Ambient scenes in twelve moods. The line under the title reads like a sentence (*"With a beat and song chords. Oceanic mood, staying put."*), and every underlined word is a control.
- **Run.** Set a cadence, or tap along with your steps. The kick lands on every step, and the rest of the music plays at half speed so it stays calm. An arranger turns the loop into an evolving song with intro, groove, lift, peak, breakdown and build. It also has interval training (push and easy stretches marked by two soft bells), a run length that ends in a cool-down, and a choice of bass lines (dub, driving, psy, funk).
- **Sleep.** A timer with a long fade, and *wind down*, which makes the music gradually darker, slower and sparser. You can pick one-tap sleep sounds (rain, ocean, brown noise, stream, night, fire) and follow a breathing guide.
- **Simple.** Pick a world (Ocean, Forest, Rain, Stars, Night) and what your finger plays. Everything is in a happy five-note scale, so nothing you play can sound wrong, and the volume stays below 60%. This mode is good for children.

**Full-screen play-along** (the corner icon) hides everything except the lines. The whole screen becomes the instrument, and nothing you touch can pause the music or change a setting. Hold the ring in the corner to leave.

You can also:
- **Rec** a lossless WAV clip.
- **Save** scenes you like.
- Go **Back** after Random.
- **Share** a link that recreates the exact scene.

## How the music is made

- **28 synthesised layers.** Pads, strings, choir, drone, bass, piano, kalimba, bells, marimba, flute, singing bowls, arpeggiator, Euclidean percussion, rain, ocean, wind, fire, birds, crickets, thunder, binaural beats and noise. Every layer is built from oscillators, filtered noise and envelopes.
- **Harmony.** Fifteen scales, chord loops with voice leading, and *song chords*: 100 real-world progressions written per scale, played as a verse and chorus.
- **Melody.** Motifs that repeat and develop in four-phrase sentences and land on a home note. Other layers play arpeggios, wandering lines or chords.
- **A tempo grid.** Meters include 4/4, 3/4, 5/4, 6/8, 7/8 and 9/8, with swing and humanise. In running mode, everything locks to the step grid.
- **Around 300 parameters.** Each is declared once in a schema: the interface is drawn from it, the generator randomises it, and share links encode it.
- **The mix.** Each layer has its own low cut, so kick and bass keep their room. On the master bus: tape warmth, wow and flutter, chorus, a convolution reverb and a ping-pong delay, then a glue compressor and a limiter.

## Privacy

Nothing leaves your device. Settings and saved scenes live in the browser's local storage, and a share link carries the whole scene in its own URL. The only outside request is for the fonts, from Google Fonts.

## Running it locally

There's no build step and there are no dependencies. Serve the folder with any static server:

```sh
python3 -m http.server 8080
# or: npx http-server . -p 8080
```

Then open http://localhost:8080. Audio starts on the first tap, as browsers require.

## Self-hosting

The included `Dockerfile` serves the app with nginx (port 80), with cache headers that let updates arrive promptly. It works as-is on Coolify, Railway, Fly and similar hosts.

## Code map

```
index.html            the page
css/style.css         the whole look
js/main.js            interface: modes, sheets, touch, sleep, running, recording, share
js/engine.js          audio engine: transport, master chain, low-end guard, evolution
js/conductor.js       the running arranger (sections, fills, risers, intervals)
js/theory.js          scales, chords, voice leading, song form
js/progressions.js    the 100 song progressions
js/composer.js        Euclidean rhythms, motifs, arpeggios
js/scenes.js          moods, palettes, the scene generator, share links
js/params.js          the global parameter schema
js/layers/*.js        every instrument and its parameters
js/touch.js           the screen as an instrument
js/visuals.js         the ridge-line visuals
js/recorder*.js       WAV recording (AudioWorklet)
sw.js                 offline support
```

`window.genbient` exposes the engine, state and a few helpers, for poking around in the browser console.

## Browser support

It works in current Safari (iOS and macOS), Chrome and Firefox. On iPhone, keep the page open and the music keeps playing with the screen locked. It also works through CarPlay and Bluetooth.

## Deployment

`.github/workflows/pages.yml` publishes the `main` branch to GitHub Pages.

## License

MIT. See [LICENSE](LICENSE).
