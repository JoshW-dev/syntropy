// The fingerprint of a society under each food map, headless: N worlds per condition, measured over
// the second half of each run.
//   node scripts/fingerprint.ts [--maps zones,plain,islands:0.75] [--seeds 16] [--ticks 12000] [--out file.json]
// A condition is a food map, or map:capacity. Without a capacity it takes the map's preset one.
// Seeds are e0, e1, ... so the same worlds can be run under every condition.

import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { Pool } from './pool.ts';
import type { ExpJob, ExpResult } from './exp-worker.ts';
import { FOOD_PRESETS } from '../src/sim/world.ts';
import { FOOD_MAPS, type FoodMap } from '../src/sim/society.ts';
import type { Fingerprint } from '../src/sim/score.ts';

const args = parseArgs(process.argv.slice(2));
const nSeeds = Number(args.seeds ?? 16);
const ticks = Number(args.ticks ?? 12000);
const nWorkers = Number(args.workers ?? Math.max(1, availableParallelism() - 2));

const conditions = (args.maps ?? FOOD_PRESETS.map((f) => f.map).join(',')).split(',').map((spec) => {
  const [map, cap] = spec.split(':') as [FoodMap, string | undefined];
  if (!FOOD_MAPS.includes(map)) throw new Error(`Unknown food map "${map}". Use one of: ${FOOD_MAPS.join(', ')}.`);
  const capacity = cap === undefined ? FOOD_PRESETS.find((f) => f.map === map)!.capacity : Number(cap);
  return { name: `${map} x${capacity}`, map, capacity };
});

const pool = new Pool<Omit<ExpJob, 'id'>, ExpResult>(new URL('./exp-worker.ts', import.meta.url), nWorkers);
const t0 = performance.now();
const seeds = Array.from({ length: nSeeds }, (_, k) => `e${k}`);
const runs = await Promise.all(
  conditions.map(async (c) => {
    const overrides = { society: { foodMap: c.map, foodCapacity: c.capacity } };
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
  ['max organisms', (f) => num(Math.max(...f.map((x) => x.pop)))],
];

console.log(`${nSeeds} worlds per condition, ${ticks} ticks, measured from tick ${Math.floor(ticks / 2)}\n`);
console.log('condition'.padEnd(16) + columns.map((c) => c[0].padStart(15)).join(''));
for (const r of runs) {
  const fps = r.results.map((x) => x.fingerprint);
  console.log(r.name.padEnd(16) + columns.map((c) => c[1](fps).padStart(15)).join(''));
}
console.log(`\n${((performance.now() - t0) / 1000).toFixed(0)}s`);

if (args.out) {
  const out = runs.map((r) => ({ name: r.name, map: r.map, capacity: r.capacity, runs: r.results.map((x) => ({ seed: x.seed, levels: x.levels, fingerprint: x.fingerprint })) }));
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
