// Run one world with no graphics and print its history.
//   node scripts/world.ts [--seed abc] [--ticks 15000] [--params tuning/best.json] [--every 1500]

import { readFileSync } from 'node:fs';
import { grow, withOverrides, LADDER } from '../src/sim/world.ts';
import { TRIBE_NAMES } from '../src/sim/names.ts';

const args = parseArgs(process.argv.slice(2));
const seed = args.seed ?? 'demo';
const ticks = Number(args.ticks ?? 15000);
const every = Number(args.every ?? 1500);
const overrides = args.params ? JSON.parse(readFileSync(args.params, 'utf8')) : {};
const params = withOverrides(overrides);

const t0 = performance.now();
const { cells, society: s } = grow(seed, params);
const tCells = performance.now() - t0;
console.log(`seed "${seed}": cells ran ${cells.generation} generations (${tCells.toFixed(0)} ms), ${cells.forms.length} forms, ${cells.holding} holding -> ${s.count} founders`);

const year = (t: number) => `y${(t / 100).toFixed(0).padStart(3)}`;
let printed = 0;
const t1 = performance.now();
while (s.tick < ticks && s.count > 0) {
  s.step();
  for (; printed < s.events.length; printed++) {
    const e = s.events[printed];
    const mark = e.kind === 'level' ? '***' : '   ';
    console.log(`${year(e.tick)} ${mark} ${e.text}`);
  }
  if (s.tick % every === 0) {
    const realms = s.standingRealms().slice(0, 4).map((r) => `${r.name}(${TRIBE_NAMES[r.tribe]} ${r.size}, d${r.depth}, ${r.tribes}t, ${r.rulers}r)`);
    console.log(`${year(s.tick)} --- pop ${s.count}, realms ${s.standingRealms().length}: ${realms.join(' ')}`);
  }
}
const ms = performance.now() - t1;
console.log(`\n${s.tick} ticks in ${(ms / 1000).toFixed(1)}s (${(ms / s.tick).toFixed(3)} ms/tick)`);
console.log('ladder:', LADDER.map((name, i) => `${name}=${s.levels[i] >= 0 ? year(s.levels[i]) : '-'}`).join('  '));
console.log('stats:', JSON.stringify(s.stats));

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}
