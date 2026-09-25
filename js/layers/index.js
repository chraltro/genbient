// The catalogue of every layer. `gain` calibrates perceived loudness so
// layers at the same Level sit together.
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
  def('drone', Drone, 'harmony', 'Drone', 0.25),
  def('pad', Pad, 'harmony', 'Pads', 0.54),
  def('strings', Strings, 'harmony', 'Strings', 0.82),
  def('choir', Choir, 'harmony', 'Choir', 1.2),
  def('shimmer', Shimmer, 'harmony', 'Shimmer', 1.55),
  def('bass', Bass, 'harmony', 'Bass', 0.52),
  def('arp', Arp, 'melody', 'Arpeggio', 0.9, { oct: 4 }),
  def('piano', Piano, 'melody', 'Felt Piano', 0.72, { side: 0 }),
  def('keys', Kalimba, 'melody', 'Kalimba', 1.1, { oct: 4, side: 1 }),
  def('bells', Bells, 'melody', 'Bells', 1.55, { side: 0 }),
  def('marimba', Marimba, 'melody', 'Marimba', 1.4, { oct: 4, side: 1 }),
  def('flute', Flute, 'melody', 'Flute', 1.4),
  def('bowls', Bowls, 'melody', 'Singing Bowls', 4.4),
  def('kick', Kick, 'rhythm', 'Soft Kick', 0.4),
  def('handdrum', HandDrum, 'rhythm', 'Hand Drum', 0.9),
  def('shaker', Shaker, 'rhythm', 'Shaker', 4.0),
  def('wood', Wood, 'rhythm', 'Woodblock', 1.4),
  def('pulse', Heartbeat, 'rhythm', 'Heartbeat', 0.7),
  def('rain', Rain, 'nature', 'Rain', 0.7),
  def('ocean', Ocean, 'nature', 'Ocean', 1.8),
  def('stream', Stream, 'nature', 'Stream', 1.1),
  def('wind', Wind, 'nature', 'Wind', 1.1),
  def('fire', Fire, 'nature', 'Fire', 0.75),
  def('birds', Birds, 'nature', 'Birdsong', 2.0),
  def('night', Night, 'nature', 'Crickets & Frogs', 3.0),
  def('thunder', Thunder, 'nature', 'Distant Thunder', 0.8),
  def('binaural', Binaural, 'mind', 'Binaural Beat', 0.14),
  def('noise', Noise, 'mind', 'Noise Bed', 0.28),
];

export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l]));
export const TONAL_ANCHORS = ['drone', 'pad', 'strings', 'choir', 'shimmer'];
