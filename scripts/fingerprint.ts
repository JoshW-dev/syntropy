// The fingerprint of a society under each food map or each water, headless: N worlds per condition,
// measured over the second half of each run.
//   node scripts/fingerprint.ts [--maps zones,plain,islands:0.75] [--seeds 16] [--ticks 12000] [--out file.json]
//   node scripts/fingerprint.ts --waters even,clear,murky,halves,pockets [--food islands]
// A condition is a map, or map:capacity. Without a capacity it takes the preset one. --waters runs
// waters on one food map (the zones unless --food names another). A world with two waters also
// prints one row per water, and where the winners and losers of its fights sat later.
// Seeds are e0, e1, ... so the same worlds can be run under every condition.

import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { Pool } from './pool.ts';
import type { Crossing, ExpJob, ExpResult } from './exp-worker.ts';
import { FOOD_PRESETS, WATER_PRESETS } from '../src/sim/world.ts';
import { FOOD_MAPS, WATER_MAPS, L_GOVERNMENT, type FoodMap, type WaterMap } from '../src/sim/society.ts';
import type { Fingerprint } from '../src/sim/score.ts';

const args = parseArgs(process.argv.slice(2));
const nSeeds = Number(args.seeds ?? 16);
const ticks = Number(args.ticks ?? 12000);
const nWorkers = Number(args.workers ?? Math.max(1, availableParallelism() - 2));

const preset = (map: FoodMap) => FOOD_PRESETS.find((f) => f.map === map)!.capacity;
const conditions = args.waters
  ? args.waters.split(',').map((spec) => {
      const [water, cap] = spec.split(':') as [WaterMap, string | undefined];
      if (!WATER_MAPS.includes(water)) throw new Error(`Unknown water "${water}". Use one of: ${WATER_MAPS.join(', ')}.`);
      const map = (args.food ?? 'zones') as FoodMap;
      if (!FOOD_MAPS.includes(map)) throw new Error(`Unknown food map "${map}". Use one of: ${FOOD_MAPS.join(', ')}.`);
      const capacity = cap === undefined ? +(preset(map) * WATER_PRESETS.find((f) => f.map === water)!.capacity).toFixed(4) : Number(cap);
      return { name: `${water} x${capacity}`, map, water, capacity };
    })
  : (args.maps ?? FOOD_PRESETS.map((f) => f.map).join(',')).split(',').map((spec) => {
      const [map, cap] = spec.split(':') as [FoodMap, string | undefined];
      if (!FOOD_MAPS.includes(map)) throw new Error(`Unknown food map "${map}". Use one of: ${FOOD_MAPS.join(', ')}.`);
      return { name: `${map} x${cap === undefined ? preset(map) : Number(cap)}`, map, water: 'even' as WaterMap, capacity: cap === undefined ? preset(map) : Number(cap) };
    });

const pool = new Pool<Omit<ExpJob, 'id'>, ExpResult>(new URL('./exp-worker.ts', import.meta.url), nWorkers);
const t0 = performance.now();
const seeds = Array.from({ length: nSeeds }, (_, k) => `e${k}`);
const runs = await Promise.all(
  conditions.map(async (c) => {
    const overrides = { society: { foodMap: c.map, waterMap: c.water, foodCapacity: c.capacity } };
    const results = await Promise.all(seeds.map((seed) => pool.run({ seed, ticks, overrides, every: 300 })));
    return { ...c, results };
  }),
);
pool.close();

const ok = (xs: number[]) => xs.filter((v) => !Number.isNaN(v));
const mean = (xs: number[]) => (ok(xs).length ? ok(xs).reduce((a, b) => a + b, 0) / ok(xs).length : NaN);
const median = (xs: number[]) => {
  const s = ok(xs).sort((a, b) => a - b);
  const m = s.length >> 1;
  return !s.length ? NaN : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const num = (v: number, digits = 0) => (Number.isNaN(v) ? '-' : v.toFixed(digits));
const pct = (v: number) => (Number.isNaN(v) ? '-' : `${Math.round(v * 100)}%`);

// One row per condition. Shares and counts are means over worlds, the regroup share pools every
// leader death, and group life is the median over worlds of each world's median.
const columns: [string, (fps: Fingerprint[]) => string][] = [
  ['organisms', (f) => num(mean(f.map((x) => x.pop)))],
  ['in view', (f) => num(mean(f.map((x) => x.inView)), 1)],
  ['in groups 15+', (f) => pct(mean(f.map((x) => x.inGroups)))],
  ['outside 5', (f) => pct(mean(f.map((x) => x.outside)))],
  ['ranks', (f) => num(mean(f.map((x) => x.ranks)), 1)],
  ['median size', (f) => num(mean(f.map((x) => x.groupSize)), 1)],
  ['other lineage', (f) => pct(mean(f.map((x) => x.otherLineage)))],
  ['regroup', (f) => {
    const n = f.reduce((a, x) => a + x.leaderDeaths, 0);
    return n ? `${((100 * f.reduce((a, x) => a + x.regrouped, 0)) / n).toFixed(1)}% of ${n}` : '-';
  }],
  ['group life', (f) => num(median(f.map((x) => x.groupLife)))],
  ['fights/1,000', (f) => num(mean(f.map((x) => x.fights)), 1)],
  ['leader across', (f) => pct(mean(f.map((x) => x.across)))],
  ['max organisms', (f) => num(Math.max(...f.map((x) => x.pop)))],
];

console.log(`${nSeeds} worlds per condition, ${ticks} ticks, measured from tick ${Math.floor(ticks / 2)}\n`);
console.log('condition'.padEnd(16) + columns.map((c) => c[0].padStart(15)).join('') + 'government'.padStart(22));
for (const r of runs) {
  const fps = r.results.map((x) => x.fingerprint);
  // How many worlds reached Government, and the median tick of those that did.
  const gov = r.results.map((x) => x.levels[L_GOVERNMENT]).filter((t) => t >= 0);
  console.log(r.name.padEnd(16) + columns.map((c) => c[1](fps).padStart(15)).join('') + `${gov.length}/${nSeeds} at ${num(median(gov))}`.padStart(22));
  for (const name of r.results[0].regions.map((g) => g.name)) {
    const part = r.results.map((x) => x.regions.find((g) => g.name === name)!.fingerprint);
    console.log(`  ${name} water`.padEnd(16) + columns.map((c) => c[1](part).padStart(15)).join(''));
  }
}

// Where fighters sat later, pooled over worlds: losers beside the winners of the same fights.
for (const r of runs) {
  const all = r.results.flatMap((x) => x.crossings);
  if (!all.length) continue;
  console.log(`\n${r.name}: organisms that fought, and the share of those still alive that sat in the other water later`);
  console.log('fought in'.padEnd(12) + 'fights counted'.padEnd(22) + 'after'.padStart(8) + 'losers crossed'.padStart(24) + 'winners crossed'.padStart(24));
  const pool = (after: number, from: string, lost: boolean, near: boolean) =>
    all.filter((c) => c.after === after && c.from === from && c.lost === lost && c.near === near).reduce((a, c) => ({ n: a.n + c.n, alive: a.alive + c.alive, crossed: a.crossed + c.crossed }), { n: 0, alive: 0, crossed: 0 });
  const share = (c: Pick<Crossing, 'alive' | 'crossed'>) => (c.alive ? `${((100 * c.crossed) / c.alive).toFixed(1)}% of ${c.alive}` : '-');
  for (const near of [false, true]) {
    for (const from of ['clear', 'murky']) {
      for (const after of [...new Set(all.map((c) => c.after))].sort((a, b) => a - b)) {
        const lost = pool(after, from, true, near);
        const won = pool(after, from, false, near);
        console.log(`${from} water`.padEnd(12) + (near ? 'near the murk edge' : 'anywhere').padEnd(22) + String(after).padStart(8) + share(lost).padStart(24) + share(won).padStart(24));
      }
    }
  }
}
console.log(`\n${((performance.now() - t0) / 1000).toFixed(0)}s`);

if (args.out) {
  const out = runs.map((r) => ({ name: r.name, map: r.map, water: r.water, capacity: r.capacity, runs: r.results.map((x) => ({ seed: x.seed, levels: x.levels, fingerprint: x.fingerprint, regions: x.regions, crossings: x.crossings })) }));
  writeFileSync(args.out, JSON.stringify({ ticks, seeds, conditions: out }));
  console.log(`wrote ${args.out}`);
}

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
