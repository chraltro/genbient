# Genbient

**Generative ambient music you can play with a finger.** Every scene is composed on the spot from a seed: harmony, melody, rhythm, weather and colour. Everything is synthesised live in the browser. There are no samples, no recordings, no accounts and no tracking.

**Try it:** https://chraltro.github.io/genbient/ (best on a phone, with headphones)

It installs as an app from the browser's share menu ("Add to Home Screen") and works offline after the first visit.

## Five ways to use it

- **Listen.** Ambient pieces that never repeat. The line under the title reads like a sentence (*"With a beat and song chords. Ocean mood, staying put. Slow, dusky and sparse, in a hall."*), and every underlined word is a control. Change *slow* to *walking* and the same piece reshapes itself; the choice is held for the scenes that follow. While you listen, parts come and go on a slow tide, so the music breathes. Set it *becoming something new over 20 min* and it never stops or cuts: its qualities drift, resting parts come back as other instruments, the ground crossfades and the key moves to a neighbour, until it is somewhere else entirely.
- **Run.** Set a cadence, tap along with your steps, or let the phone count them with its motion sensor and follow you. The kick lands on every step, and the rest of the music plays at half speed so it stays calm. An arranger turns the loop into an evolving song with intro, groove, lift, peak, breakdown and build. It also has interval training (push and easy stretches marked by two soft bells), a run length that ends in a cool-down, and a choice of bass lines (dub, driving, psy, funk).
- **Focus.** Work in rounds (25 minutes of focus and 5 minute breaks, for example). The music thins out and holds still while you work and opens up on breaks, with a soft bell at each change.
- **Sleep.** A timer with a long fade, and *wind down*, which makes the music gradually darker, slower and sparser. You can pick one-tap sleep sounds (rain, ocean, brown noise, stream, night, fire) and follow a breathing guide.
- **Simple.** Pick a world (Ocean, Forest, Rain, Stars, Night, Underwater, Campfire, Mountain) and what your finger plays. Your finger leaves colour trails on the screen as it plays. Everything is in a happy five-note scale, so nothing you play can sound wrong, and the volume stays below 60%. This mode is good for children.

**The picture is the sound.** The lines are the music's own landscape: each one a moment of the spectrum (lows in the middle, highs toward the edges, like the pulsar plot on *Unknown Pleasures*), rising at the front and receding to the horizon, so a melody is a ridge travelling away and the notes you hear are lit as they go. Each piece draws differently: its pace is the scroll, its space the depth, its material smooth curves or cut lines, its strangeness a warp.

**Around you.** On headphones (Sound → Headphones), melodies are placed in the space around your head and drift: the tune a little to the front left, its answer behind you, a halo circling slowly overhead. The ground stays wide.

**Full-screen play-along** (the corner icon) hides everything except the lines. The whole screen becomes the instrument, and nothing you touch can pause the music or change a setting. Hold the ring in the corner to leave.

You can also:
- **Rec** a lossless WAV clip.
- **Save** scenes you like.
- Go **Back** after Random.
- **Share** a short link that recreates the exact scene (`#amber-harbor.z…`, compressed, named after the scene).

## How the music is made

**A piece is a point in a space, not a preset.** Every scene is a *genome* of 21 continuous qualities a listener can actually hear: pace, pulse, syncopation, density, light, tension, how the chords move, strangeness, how many voices, how melodic, how repetitive, register, brightness, touch, material, space, age, nature, element, life and change. The moods (Airports, Rain Piano, Downtempo…) are only named places in that space to start from; everything around and between them is reachable.

The genome is realised by principles from music perception, not by picking from lists:

- **Sounds by character.** Each designed sound is described by brightness, attack, material, register and how exotic it is. Parts (a bed, a lead, an answer, a halo, a bass, weather) are cast by fit, then every sound is bent continuously toward the genome.
- **What a listener can follow.** One to four musical voices, never more: people hear about three to four streams at once.
- **Rhythm by measurement.** Drum patterns are chosen by their measured syncopation (Longuet-Higgins & Lee). Groove research finds pleasure peaks at a medium amount.
- **Melody by how melodies work.** A rhythm cell that repeats, an arch that rises and falls back, small steps that continue and leaps that turn back (Narmour's implication–realisation), and phrase endings on home. Airport-like pieces use Eno's method instead: a few notes on loops of prime lengths that drift in and out of phase.
- **A critic.** Sixteen realisations of each seed are scored for streams, masking, figure against ground, timbral belonging, brightness, information rate against pace (Berlyne's inverted U), groove, mud and fidelity to the genome. The best one plays, and the same seed always gives the same piece.
- **A memory cloud.** An AudioWorklet keeps the last twelve seconds of the music and sings overlapping grains of it back into the room, some an octave up: the bloom of tape loops and shimmer reverbs, made from the piece itself. Spacious, slow pieces get more of it.
- **Plucked strings by physical model.** Harp, nylon guitar, steel string and koto are Karplus–Strong strings in an AudioWorklet: a pluck of noise circulating in a string one period long, losing its highs as it rings, tuned to within a cent.
- **The hour.** With any mood, new pieces lean brighter and livelier around midday and darker and slower late at night.
- **Form on a 1/f tide.** In Listen mode an arranger brings parts in and out, phrase by phrase, following pink noise: small changes often, big ones rarely, the way natural sound and most music move.

**The instrument underneath:**

- **29 synthesised layers.** Pads, strings, choir, drone, bass, piano, plucked strings, kalimba, bells, marimba, flute, singing bowls, arpeggiator, Euclidean percussion, rain, ocean, wind, fire, birds, crickets, thunder, binaural beats and noise. Every layer is built from oscillators, filtered noise and envelopes; the plucked strings are a physical model.
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
js/genome.js          the 21 qualities and the named starting places
js/generator.js       genome → scene: casting, rhythm, harmony, the critic
js/sounds.js          the designed sound presets
js/tide.js            the listening arranger
js/cloud-worklet.js   the memory cloud (granular, runs on the audio thread)
js/pluck-worklet.js   plucked strings (physical model, audio thread)
js/scenes.js          scenes, journeys, rerolls, share links
js/params.js          the global parameter schema
js/layers/*.js        every instrument and its parameters
js/touch.js           the screen as an instrument
js/visuals.js         the music's landscape (spectrum ridge lines)
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
