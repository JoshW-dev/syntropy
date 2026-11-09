// Names for tribes (fixed, matched to the ink palette) and realms (generated per world).

import type { Rng } from './rng.ts';

export const TRIBE_NAMES = ['Blue', 'Red', 'Gold', 'Green', 'Violet', 'Rose'] as const;

const OPEN = ['ka', 've', 'lo', 'sa', 'ri', 'to', 'mi', 'da', 'ne', 'ha', 'zu', 'pe', 'or', 'el', 'an', 'is', 'ul', 'ta', 'ko', 'fe'];
const CLOSE = ['th', 'n', 'r', 'sh', 'l', 'm', 'x', 'k', 's', 'nd', 'rn', 'v'];

/** A short invented realm name, like "Kaveth" or "Lorin". */
export function realmName(rng: Rng, taken: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const syll = 2 + (rng.chance(0.25) ? 1 : 0);
    let s = '';
    for (let i = 0; i < syll; i++) s += OPEN[rng.int(OPEN.length)];
    if (rng.chance(0.6)) s += CLOSE[rng.int(CLOSE.length)];
    s = s.replace(/(.)\1\1+/g, '$1$1');
    const name = s[0].toUpperCase() + s.slice(1);
    if (name.length >= 4 && name.length <= 9 && !taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const fallback = `Realm ${taken.size + 1}`;
  taken.add(fallback);
  return fallback;
}
