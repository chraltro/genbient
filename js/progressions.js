// A library of chord progressions the way songs actually use them.
// Each is a list of scale degrees (0 = the key's home chord) in the mode it
// belongs to, so the chord qualities come out right: in major, 4 is V and
// 5 is vi; in minor, 5 is VI and 6 is VII. Song chords pick a verse and a
// chorus from the set that fits the scene's scale and loop them faithfully.

const P = (name, degrees) => ({ name, degrees });

export const PROGRESSIONS = {
  // Major (I ii iii IV V vi vii°)
  ionian: [
    P('I–V–vi–IV', [0, 4, 5, 3]),
    P('I–vi–IV–V', [0, 5, 3, 4]),
    P('I–IV–vi–V', [0, 3, 5, 4]),
    P('vi–IV–I–V', [5, 3, 0, 4]),
    P('I–IV', [0, 3]),
    P('I–iii–vi–IV', [0, 2, 5, 3]),
    P('Canon', [0, 4, 5, 2, 3, 0, 3, 4]),
    P('ii–V–I', [1, 4, 0, 0]),
    P('I–vi–ii–V', [0, 5, 1, 4]),
    P('I–IV–V–IV', [0, 3, 4, 3]),
    P('I–V–IV–V', [0, 4, 3, 4]),
    P('IV–V–iii–vi', [3, 4, 2, 5]),
    P('I–iii–IV–V', [0, 2, 3, 4]),
    P('I–V–vi–iii–IV', [0, 4, 5, 2, 3]),
    P('IV–I–V–vi', [3, 0, 4, 5]),
    P('I–ii–IV', [0, 1, 3]),
    P('I–IV–ii–V', [0, 3, 1, 4]),
    P('vi–V–IV–V', [5, 4, 3, 4]),
    P('I–vi–iii–IV', [0, 5, 2, 3]),
    P('IV–vi–V–I', [3, 5, 4, 0]),
    P('I–V–ii–IV', [0, 4, 1, 3]),
    P('ii–IV–I–V', [1, 3, 0, 4]),
    P('I–iii–ii–IV', [0, 2, 1, 3]),
    P('vi–ii–V–I', [5, 1, 4, 0]),
    P('I–IV–I–V', [0, 3, 0, 4]),
    P('IV–V–vi', [3, 4, 5]),
    P('I–ii–iii–IV', [0, 1, 2, 3]),
    P('I–vi–IV–ii', [0, 5, 3, 1]),
    P('iii–vi–IV–I', [2, 5, 3, 0]),
    P('I–IV–vi–iii–ii–V', [0, 3, 5, 2, 1, 4]),
  ],
  // Natural minor (i ii° III iv v VI VII)
  aeolian: [
    P('i–VI–III–VII', [0, 5, 2, 6]),
    P('i–VII–VI–VII', [0, 6, 5, 6]),
    P('Andalusian', [0, 6, 5, 4]),
    P('i–iv–VII–III', [0, 3, 6, 2]),
    P('i–VI–VII', [0, 5, 6]),
    P('VI–VII–i', [5, 6, 0]),
    P('i–III–VII–VI', [0, 2, 6, 5]),
    P('i–iv–v', [0, 3, 4]),
    P('i–VI–iv–VII', [0, 5, 3, 6]),
    P('i–VII–iv', [0, 6, 3]),
    P('VI–III–VII–i', [5, 2, 6, 0]),
    P('i–iv', [0, 3]),
    P('i–VI', [0, 5]),
    P('i–III–iv–VI', [0, 2, 3, 5]),
    P('i–v–VI–III', [0, 4, 5, 2]),
    P('iv–VI–VII–i', [3, 5, 6, 0]),
    P('i–VII–III–VI', [0, 6, 2, 5]),
    P('i–iv–VI–v', [0, 3, 5, 4]),
    P('VI–iv–i–VII', [5, 3, 0, 6]),
    P('i–III–VI–VII', [0, 2, 5, 6]),
    P('i–VI–III–iv', [0, 5, 2, 3]),
    P('VI–VII–III–i', [5, 6, 2, 0]),
    P('i–v–iv', [0, 4, 3]),
    P('i–VII–VI–iv', [0, 6, 5, 3]),
    P('III–VII–i–VI', [2, 6, 0, 5]),
  ],
  // Dorian (i ii III IV v vi° VII): minor with a bright IV
  dorian: [
    P('i–IV', [0, 3]),
    P('i–IV–i–VII', [0, 3, 0, 6]),
    P('i–VII–IV', [0, 6, 3]),
    P('i–ii', [0, 1]),
    P('i–III–IV', [0, 2, 3]),
    P('i–IV–VII–III', [0, 3, 6, 2]),
    P('i–ii–III–ii', [0, 1, 2, 1]),
    P('i–v–IV', [0, 4, 3]),
    P('IV–i–VII–i', [3, 0, 6, 0]),
    P('i–VII–III–IV', [0, 6, 2, 3]),
  ],
  // Mixolydian (I ii iii° IV v vi ♭VII): major with a flat seventh
  mixolydian: [
    P('I–♭VII–IV', [0, 6, 3]),
    P('I–♭VII', [0, 6]),
    P('I–v–IV', [0, 4, 3]),
    P('I–IV–♭VII–IV', [0, 3, 6, 3]),
    P('♭VII–IV–I', [6, 3, 0]),
    P('I–♭VII–v–IV', [0, 6, 4, 3]),
    P('I–vi–♭VII', [0, 5, 6]),
    P('I–ii–IV', [0, 1, 3]),
    P('IV–I–♭VII', [3, 0, 6]),
    P('I–v–vi–IV', [0, 4, 5, 3]),
  ],
  // Lydian (I II iii ♯iv° V vi vii): major with a raised fourth
  lydian: [
    P('I–II', [0, 1]),
    P('I–II–vii', [0, 1, 6]),
    P('I–II–iii', [0, 1, 2]),
    P('I–vii–II', [0, 6, 1]),
    P('I–V–II', [0, 4, 1]),
    P('vi–II–I', [5, 1, 0]),
    P('I–iii–II', [0, 2, 1]),
    P('I–II–V–vi', [0, 1, 4, 5]),
  ],
  // Phrygian (i ♭II ♭III iv v° ♭VI ♭vii)
  phrygian: [
    P('i–♭II', [0, 1]),
    P('i–♭II–♭III–♭II', [0, 1, 2, 1]),
    P('i–♭VI–♭II', [0, 5, 1]),
    P('i–♭vii–♭VI–♭II', [0, 6, 5, 1]),
    P('iv–♭II–i', [3, 1, 0]),
  ],
  // Harmonic minor (i ii° III+ iv V VI vii°): the real dominant
  harmonic: [
    P('i–iv–V', [0, 3, 4]),
    P('i–VI–iv–V', [0, 5, 3, 4]),
    P('i–V', [0, 4]),
    P('iv–V–i', [3, 4, 0]),
    P('i–VI–V', [0, 5, 4]),
  ],
  // Five-note scales: open, folk-like sways
  pent: [
    P('Sway', [0, 3]),
    P('Rise', [0, 2]),
    P('Fall', [0, 3, 2]),
    P('Step', [0, 1]),
    P('Turn', [0, 4, 3]),
    P('Round', [0, 2, 3, 1]),
    P('Return', [0, 3, 0, 2]),
  ],
};

const FAMILY = {
  ionian: 'ionian', aeolian: 'aeolian', dorian: 'dorian', mixolydian: 'mixolydian', lydian: 'lydian',
  phrygian: 'phrygian', hijaz: 'phrygian', harmonic: 'harmonic', melodic: 'harmonic',
};

// Scales that songs live in, for moving an exotic scene somewhere familiar.
export const SONG_MODE = {
  majpent: 'ionian', yo: 'ionian', whole: 'lydian', minpent: 'aeolian', hirajoshi: 'aeolian', insen: 'aeolian', melodic: 'aeolian', hijaz: 'phrygian',
};

export function progressionsFor(mode, len) {
  const list = PROGRESSIONS[FAMILY[mode] || 'pent'];
  // melodic minor has no VI chord worth landing on; keep to what works
  const ok = mode === 'melodic' ? list.filter((p) => !p.degrees.includes(5)) : list;
  return ok.filter((p) => p.degrees.every((d) => d < len));
}

export const PROGRESSION_COUNT = Object.values(PROGRESSIONS).reduce((n, l) => n + l.length, 0);
