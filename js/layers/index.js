// The catalogue of every layer. `gain` calibrates perceived loudness so
// layers at the same Level sit together (measured: each designed sound
// rendered alone at the same Level, loudness while it plays).
import { Drone, Pad, Strings, Choir, Shimmer, Bass } from './tonal.js';
import { Arp, Kalimba, Piano, Bells, Marimba, Flute, Bowls } from './melodic.js';
import { Kick, Shaker, HandDrum, Wood, Heartbeat } from './rhythm.js';
import { Rain, Ocean, Stream, Wind, Fire, Birds, Night, Thunder } from './nature.js';
import { Binaural, Noise } from './mind.js';

export const GROUPS = [
  { id: 'harmony', name: 'Harmony' },
  { id: 'melody', name: 'Melody' },
  { id: 'rhythm', name: 'Rhythm' },
  { id: 'nature', name: 'Nature' },
  { id: 'mind', name: 'Mind' },
];

const def = (id, cls, group, name, gain, x = {}) => ({ id, cls, group, name, gain, schema: cls.schema, ...x });

export const LAYERS = [
  def('drone', Drone, 'harmony', 'Drone', 0.41),
  def('pad', Pad, 'harmony', 'Pads', 0.54),
  def('strings', Strings, 'harmony', 'Strings', 0.82),
  def('choir', Choir, 'harmony', 'Choir', 0.5),
  def('shimmer', Shimmer, 'harmony', 'Shimmer', 1.55),
  def('bass', Bass, 'harmony', 'Bass', 0.52),
  def('arp', Arp, 'melody', 'Arpeggio', 1.25, { oct: 4, lowHz: 110, highHz: 1600 }),
  def('piano', Piano, 'melody', 'Felt Piano', 1.0, { side: 0, lowHz: 65, highHz: 2000 }),
  def('keys', Kalimba, 'melody', 'Kalimba', 1.7, { oct: 4, side: 1, lowHz: 220, highHz: 2100 }),
  def('bells', Bells, 'melody', 'Bells', 1.25, { side: 0, lowHz: 260, highHz: 2400 }),
  def('marimba', Marimba, 'melody', 'Marimba', 1.7, { oct: 4, side: 1, lowHz: 130, highHz: 1600 }),
  def('flute', Flute, 'melody', 'Flute', 1.75, { lowHz: 260, highHz: 1600 }),
  def('bowls', Bowls, 'melody', 'Singing Bowls', 2.8),
  def('kick', Kick, 'rhythm', 'Soft Kick', 0.4),
  def('handdrum', HandDrum, 'rhythm', 'Hand Drum', 0.9),
  def('shaker', Shaker, 'rhythm', 'Shaker', 4.0),
  def('wood', Wood, 'rhythm', 'Woodblock', 1.4),
  def('pulse', Heartbeat, 'rhythm', 'Heartbeat', 0.7),
  def('rain', Rain, 'nature', 'Rain', 0.88),
  def('ocean', Ocean, 'nature', 'Ocean', 0.9),
  def('stream', Stream, 'nature', 'Stream', 0.8),
  def('wind', Wind, 'nature', 'Wind', 1.1),
  def('fire', Fire, 'nature', 'Fire', 1.5),
  def('birds', Birds, 'nature', 'Birdsong', 2.0),
  def('night', Night, 'nature', 'Crickets & Frogs', 3.8),
  def('thunder', Thunder, 'nature', 'Distant Thunder', 0.8),
  def('binaural', Binaural, 'mind', 'Binaural Beat', 0.14),
  def('noise', Noise, 'mind', 'Noise Bed', 0.28),
];

export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l]));
export const TONAL_ANCHORS = ['drone', 'pad', 'strings', 'choir', 'shimmer'];
