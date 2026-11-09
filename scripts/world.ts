// Run one world with no graphics and print its history.
//   node scripts/world.ts [--seed abc] [--ticks 8000] [--params tuning/best.json] [--every 1000]

import { readFileSync } from 'node:fs';
import { grow, withOverrides, LADDER } from '../src/sim/world.ts';
import { TRIBE_NAMES } from '../src/sim/names.ts';

const args = parseArgs(process.argv.slice(2));
const seed = args.seed ?? 'demo';
const ticks = Number(args.ticks ?? 8000);
const every = Number(args.every ?? 1000);
const overrides = args.params ? JSON.parse(readFileSync(args.params, 'utf8')) : {};
const world = grow(seed, withOverrides(overrides));
const s = world.society;

const year = (t: number) => `y${(t / 100).toFixed(0).padStart(3)}`;
let printed = 0;
const t0 = performance.now();
while (world.tick < ticks && (s.count > 0 || world.latticeActive)) {
  world.step();
  for (; printed < s.emitted; printed++) {
    const e = s.events[s.events.length - (s.emitted - printed)];
    if (!e) continue;
    console.log(`${year(e.tick)} ${e.kind === 'level' ? '***' : '   '} ${e.text}`);
  }
  if (world.tick % every === 0) {
    const realms = s.standingRealms().slice(0, 4).map((r) => `${r.name}(${TRIBE_NAMES[r.tribe]} ${r.size}, d${r.depth}, ${r.tribes}t, ${r.rulers}r)`);
    const last = s.history[s.history.length - 1];
    console.log(`${year(world.tick)} --- lattice ${world.cells.population}${world.latticeActive ? '' : ' (still)'}, organisms ${s.count}, mass ${last?.meanMass.toFixed(1)}, syntropy ${last?.syntropy.toFixed(2)}, realms ${s.standingRealms().length}: ${realms.join(' ')}`);
  }
}
const ms = performance.now() - t0;
console.log(`\n${world.tick} ticks in ${(ms / 1000).toFixed(1)}s (${(ms / world.tick).toFixed(3)} ms/tick)`);
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
