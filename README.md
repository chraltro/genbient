# Genbient

Endless, procedurally generated ambient soundscapes for rest, focus and meditation, designed for the phone first.

**Live:** https://chraltro.github.io/genbient/

Every sound is synthesised live in the browser with the Web Audio API. Nothing is recorded and nothing loops. Harmony wanders slowly through the scale, melodies are improvised note by note, and weather comes and goes, so no two minutes are ever the same.

## What's in it

- **18 layers** across four groups
  - *Harmony*: drone, pads, formant choir, shimmer
  - *Melody*: FM bells, kalimba, breathy flute, singing bowls, heartbeat
  - *Nature*: rain, ocean, stream, wind, fire, birdsong, crickets, distant thunder
  - *Mind*: binaural beats (delta, theta, alpha)
- **14 curated scenes**, plus a seeded generator ("Dream up a new one") that combines moods, scales, palettes and layers into scenes nobody has heard before
- **13 scales**: church modes, pentatonics, Hijaz, Hirajoshi, In Sen, Yo, whole tone. A = 440 or 432 Hz, equal temperament or just intonation
- **Evolution**: chord changes, occasional key changes, a breathing master filter, and *Journey* mode, which drifts into a related scene every few minutes
- **Rest tools**: sleep timer with a long fade, breathing guide (calm, box, 4·7·8, coherent) that drives the orb, and a wake lock
- **Visuals**: drifting colour fields, floating motes, and ripples that bloom at the exact moment each note sounds. The interface dissolves while you listen; tap anywhere to bring it back
- **Share links**: a scene is encoded into the URL
- **Installable PWA** that works offline

## Running locally

No build step and no dependencies. Serve the folder over HTTP:

```sh
npx http-server . -p 8080
```

## Structure

```
index.html            page shell
css/style.css         all styling
js/main.js            UI, sheets, timers, share, media session
js/engine.js          master chain, reverb, delay, look-ahead scheduler, evolution
js/layers.js          every sound layer
js/theory.js          scales, tuning, harmony walk
js/scenes.js          presets, palettes, generator, share encoding
js/visuals.js         canvas visuals
sw.js                 offline cache
```

## Deployment

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to `main` (and the development branch). If Pages has never been enabled for the repo, set **Settings → Pages → Source** to **GitHub Actions** once.
