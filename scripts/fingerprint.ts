// The fingerprint of a society under each food map, each water or each climate, headless: N worlds
// per condition, measured over the second half of each run.
//   node scripts/fingerprint.ts [--maps zones,plain,islands:0.75] [--seeds 16] [--ticks 12000] [--out file.json]
//   node scripts/fingerprint.ts --waters even,clear,murky,halves,pockets [--food islands]
//   node scripts/fingerprint.ts --climates steady,mild,strong [--periods 3000,6000,12000]
// A condition is a map, or map:capacity. Without a capacity it takes the preset one. --waters runs
// waters on one food map (the zones unless --food names another). A world with two waters also
// prints one row per water, and where the winners and losers of its fights sat later.
// --climates runs each climate (a preset name or a swing such as 0.3) at each cycle length, for two
// and a half cycles unless --ticks says otherwise. It adds the society at the low and the high of
// the cycle, the groups that last one cycle, and one table by phase. A steady world is measured
// against the same cycle length, so its rows are the numbers to compare with.
// Seeds are e0, e1, ... so the same worlds can be run under every condition.

import { availableParallelism } from 'node:os';
import { writeFileSync } from 'node:fs';
import { Pool } from './pool.ts';
import type { Crossing, ExpJob, ExpResult } from './exp-worker.ts';
import { CLIMATE_PERIODS, CLIMATE_PRESETS, FOOD_PRESETS, WATER_PRESETS } from '../src/sim/world.ts';
import { FOOD_MAPS, WATER_MAPS, L_GOVERNMENT, type FoodMap, type WaterMap } from '../src/sim/society.ts';
import { PHASES, type Fingerprint, type Lasting } from '../src/sim/score.ts';

const args = parseArgs(process.argv.slice(2));
const nSeeds = Number(args.seeds ?? 16);
const nWorkers = Number(args.workers ?? Math.max(1, availableParallelism() - 2));

interface Condition {
  name: string;
  map: FoodMap;
  water: WaterMap;
  capacity: number;
  ticks: number;
  /** A climate run: the swing and the cycle length it is measured against. */
  swing?: number;
  period?: number;
}

const preset = (map: FoodMap) => FOOD_PRESETS.find((f) => f.map === map)!.capacity;
const ticksOr = (fallback: number) => Number(args.ticks ?? fallback);
const conditions: Condition[] = args.climates
  ? (args.periods ? args.periods.split(',').map(Number) : [...CLIMATE_PERIODS]).flatMap((period) =>
      args.climates.split(',').map((spec) => {
        const named = CLIMATE_PRESETS.find((c) => c.name === spec);
        const swing = named ? named.swing : Number(spec);
        if (!(swing >= 0 && swing < 1) || !(period >= 300)) throw new Error(`Unknown climate "${spec}" or cycle length ${period}. Use ${CLIMATE_PRESETS.map((c) => c.name).join(', ')} or a swing from 0 to 0.95.`);
        return { name: `${named ? named.name : `swing ${swing}`} / ${period}`, map: 'zones' as FoodMap, water: 'even' as WaterMap, capacity: 1, ticks: ticksOr(2.5 * period), swing, period };
      }),
    )
  : args.waters
    ? args.waters.split(',').map((spec) => {
        const [water, cap] = spec.split(':') as [WaterMap, string | undefined];
        if (!WATER_MAPS.includes(water)) throw new Error(`Unknown water "${water}". Use one of: ${WATER_MAPS.join(', ')}.`);
        const map = (args.food ?? 'zones') as FoodMap;
        if (!FOOD_MAPS.includes(map)) throw new Error(`Unknown food map "${map}". Use one of: ${FOOD_MAPS.join(', ')}.`);
        const capacity = cap === undefined ? +(preset(map) * WATER_PRESETS.find((f) => f.map === water)!.capacity).toFixed(4) : Number(cap);
        return { name: `${water} x${capacity}`, map, water, capacity, ticks: ticksOr(12000) };
      })
    : (args.maps ?? FOOD_PRESETS.map((f) => f.map).join(',')).split(',').map((spec) => {
        const [map, cap] = spec.split(':') as [FoodMap, string | undefined];
        if (!FOOD_MAPS.includes(map)) throw new Error(`Unknown food map "${map}". Use one of: ${FOOD_MAPS.join(', ')}.`);
        return { name: `${map} x${cap === undefined ? preset(map) : Number(cap)}`, map, water: 'even' as WaterMap, capacity: cap === undefined ? preset(map) : Number(cap), ticks: ticksOr(12000) };
      });

const pool = new Pool<Omit<ExpJob, 'id'>, ExpResult>(new URL('./exp-worker.ts', import.meta.url), nWorkers);
const t0 = performance.now();
const seeds = Array.from({ length: nSeeds }, (_, k) => `e${k}`);
const runs = await Promise.all(
  conditions.map(async (c) => {
    const climate = c.period === undefined ? {} : { climateSwing: c.swing, climatePeriod: c.period };
    const overrides = { society: { foodMap: c.map, waterMap: c.water, foodCapacity: c.capacity, ...climate } };
    const results = await Promise.all(seeds.map((seed) => pool.run({ seed, ticks: c.ticks, overrides, every: 300, cycle: c.period !== undefined })));
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

const spans = [...new Set(runs.map((r) => r.ticks))];
console.log(`${nSeeds} worlds per condition, ${spans.length === 1 ? `${spans[0]} ticks` : 'two and a half cycles each'}, measured over the second half of each run\n`);
console.log('condition'.padEnd(16) + columns.map((c) => c[0].padStart(15)).join('') + 'government'.padStart(22));
// How many worlds reached Government, and the median tick of those that did.
const government = (results: ExpResult[]) => {
  const gov = results.map((x) => x.levels[L_GOVERNMENT]).filter((t) => t >= 0);
  return `${gov.length}/${nSeeds} at ${num(median(gov))}`;
};
for (const r of runs) {
  const fps = r.results.map((x) => x.fingerprint);
  console.log(r.name.padEnd(16) + columns.map((c) => c[1](fps).padStart(15)).join('') + government(r.results).padStart(22));
  for (const name of r.results[0].regions.map((g) => g.name)) {
    const part = r.results.map((x) => x.regions.find((g) => g.name === name)!.fingerprint);
    console.log(`  ${name} water`.padEnd(16) + columns.map((c) => c[1](part).padStart(15)).join(''));
  }
}

// The climate cycle. The low and the high are the phases with the fewest and the most organisms,
// which trail the food by about a quarter of a cycle. A phase is a mean over worlds of each world's
// mean, taken from half a cycle in.
const cycles = runs.filter((r) => r.period !== undefined);
if (cycles.length) {
  const se = (xs: number[]) => {
    const v = ok(xs);
    const m = mean(v);
    return v.length > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1) / v.length) : NaN;
  };
  // Pooled over worlds, with the mean and standard error of the per-world shares after it.
  const lasted = (lists: Lasting[][], pick: (l: Lasting[]) => Lasting | undefined) => {
    const got = lists.map(pick).filter((l): l is Lasting => !!l);
    const standing = got.reduce((a, l) => a + l.standing, 0);
    const kept = got.reduce((a, l) => a + l.lasted, 0);
    const per = got.filter((l) => l.standing > 0).map((l) => l.lasted / l.standing);
    return standing ? `${((100 * kept) / standing).toFixed(1)}% of ${standing} (${(100 * mean(per)).toFixed(1)}±${(100 * se(per)).toFixed(1)})` : '-';
  };
  const table = cycles.map((r) => {
    const rows = Array.from({ length: PHASES }, (_, k) => {
      const at = r.results.map((x) => x.cycle!.phases[k]);
      return { phase: k, pop: mean(at.map((p) => p.pop)), inGroups: mean(at.map((p) => p.inGroups)), outside: mean(at.map((p) => p.outside)), groups: mean(at.map((p) => p.groups)), ranks: mean(at.map((p) => p.ranks)), inView: mean(at.map((p) => p.inView)) };
    });
    const low = rows.reduce((a, b) => (b.pop < a.pop ? b : a));
    const high = rows.reduce((a, b) => (b.pop > a.pop ? b : a));
    return { r, rows, low, high };
  });
  console.log('\nthe climate cycle: the society at its low and its high, and the groups that last one cycle');
  const head = ['organisms low', 'organisms high', 'most at once', 'in groups low', 'in groups high', 'outside 5 low', 'outside 5 high', 'groups at high', 'lineages alive', 'worlds dead'];
  console.log('condition'.padEnd(18) + head.map((h) => h.padStart(16)).join('') + 'government'.padStart(18) + 'last from high to high'.padStart(34) + 'last from fall to fall'.padStart(34));
  for (const { r, low, high } of table) {
    // "most at once" is the most organisms any world held at one tick, to compare with maxN.
    const most = Math.max(...r.results.map((x) => x.stats.popPeak));
    const dead = r.results.filter((x) => x.lineages === 0).length;
    const cells = [`${num(low.pop)} (p${low.phase})`, `${num(high.pop)} (p${high.phase})`, String(most), pct(low.inGroups), pct(high.inGroups), pct(low.outside), pct(high.outside), num(high.groups, 1), num(mean(r.results.map((x) => x.lineages)), 2), `${dead}/${nSeeds}`];
    // The last full cycle of the run: the second food high to the third, and the fall after each.
    const lastOf = (l: Lasting[]) => l[l.length - 1];
    console.log(r.name.padEnd(18) + cells.map((c) => c.padStart(16)).join('') + government(r.results).padStart(18) + lasted(r.results.map((x) => x.cycle!.highs), lastOf).padStart(34) + lasted(r.results.map((x) => x.cycle!.falls), lastOf).padStart(34));
  }
  console.log(`\nby phase of the cycle (food rises through its usual amount at the start of phase 0, peaks at the end of phase 1, is lowest at the end of phase 5)`);
  for (const { r, rows } of table) {
    console.log(`\n${r.name}`);
    console.log('phase'.padEnd(8) + ['organisms', 'in groups 15+', 'outside 5', 'groups', 'ranks', 'in view'].map((h) => h.padStart(15)).join(''));
    for (const w of rows) console.log(String(w.phase).padEnd(8) + [num(w.pop), pct(w.inGroups), pct(w.outside), num(w.groups, 1), num(w.ranks, 1), num(w.inView, 1)].map((c) => c.padStart(15)).join(''));
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
  const out = runs.map((r) => ({
    name: r.name, map: r.map, water: r.water, capacity: r.capacity, ticks: r.ticks, swing: r.swing, period: r.period,
    runs: r.results.map((x) => ({ seed: x.seed, levels: x.levels, fingerprint: x.fingerprint, regions: x.regions, crossings: x.crossings, cycle: x.cycle, lineages: x.lineages, popPeak: x.stats.popPeak })),
  }));
  writeFileSync(args.out, JSON.stringify({ seeds, conditions: out }));
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
