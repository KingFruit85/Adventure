const ADJECTIVES = [
  'WOLF',
  'STONE',
  'EMBER',
  'FROST',
  'IRON',
  'OAK',
  'RAVEN',
  'MOON',
  'STORM',
  'DUSK',
  'DAWN',
  'STAR',
  'MIST',
  'SHADOW',
  'FLAME',
  'TIDE',
  'THORN',
  'BRIAR',
  'ASH',
  'HOLLOW',
  'PINE',
  'RUNE',
  'SAGE',
  'WILD',
];
const NOUNS = [
  'KEEP',
  'GATE',
  'SPIRE',
  'GROVE',
  'CRAG',
  'VALE',
  'MARSH',
  'PEAK',
  'PATH',
  'BLADE',
  'CROWN',
  'SIGIL',
  'WARD',
  'HEARTH',
  'GLEN',
  'CAIRN',
  'TOWER',
  'LAIR',
  'HALL',
  'BRIDGE',
  'WELL',
  'STAR',
  'COIL',
  'EDGE',
];

/**
 * Generates a memorable, shareable session code in the form ADJ-NN-NOUN
 * (e.g. "WOLF-42-STONE"). The number range is 10-99 to keep length consistent.
 * Caller is responsible for collision checking.
 */
export function generateSessionCode(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = 10 + Math.floor(Math.random() * 90);
  return `${adj}-${num}-${noun}`;
}
