// Headless search for a Cells rule: which birth/survival sets grow many forms that hold
// together, keep every lineage alive, and never fill the box?
//   node scripts/cells-search.ts [--seeds 3] [--random 200] [--size 40] [--workers 16]

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { CellsWorld, DEFAULT_CELLS, type CellsParams } from '../src/sim/cells.ts';
import { makeRng } from '../src/sim/rng.ts';

type Rule = { name: string; survive: number[]; birth: number[]; density: number };
type Task = { rule: Rule; seeds: number; size: number };
type Result = {
  rule: Rule;
  holding: number;
  peakHolding: number;
  forms: number;
  fill: number;
  lineages: number;
  activity: number;
  gens: number;
  score: number;
};

function evaluate(task: Task): Result {
  const { rule, seeds, size } = task;
  let holding = 0;
  let peakHolding = 0;
  let forms = 0;
  let fill = 0;
  let lineages = 0;
  let activity = 0;
  let gens = 0;
  for (let s = 0; s < seeds; s++) {
    const p: CellsParams = {
      ...DEFAULT_CELLS,
      size,
      survive: rule.survive,
      birth: rule.birth,
      sporeDensity: rule.density,
      maxGens: 160,
      targetForms: 100000,
    };
    const w = new CellsWorld(p, makeRng(`seed-${s}`));
    let lateBirths = 0;
    let peak = 0;
    while (w.generation < p.maxGens && w.population > 0) {
      w.step();
      if (w.generation > p.maxGens - 20) lateBirths += w.births;
      if (w.holding > peak) peak = w.holding;
      if (w.population > w.N * 0.4) break;
    }
    holding += w.holding / seeds;
    peakHolding += peak / seeds;
    forms += w.forms.length / seeds;
    fill += w.population / w.N / seeds;
    lineages += new Set(w.forms.map((f) => f.lineage)).size / seeds;
    activity += lateBirths / 20 / Math.max(1, w.population) / seeds;
    gens += w.generation / seeds;
  }
  const formScore = Math.min(holding, 200) / 200;
  const lineageScore = lineages / DEFAULT_CELLS.lineages;
  const fillPenalty = fill > 0.2 ? (fill - 0.2) * 6 : 0;
  const activityScore = Math.min(activity, 0.04) / 0.04;
  const score = formScore * 2 + lineageScore + activityScore * 0.6 - fillPenalty;
  return { rule, holding, peakHolding, forms, fill, lineages, activity, gens, score };
}

if (!isMainThread) {
  const tasks = workerData as Task[];
  for (const t of tasks) parentPort!.postMessage(evaluate(t));
  parentPort!.postMessage(null);
} else {
  const args = parseArgs(process.argv.slice(2));
  const seeds = Number(args.seeds ?? 3);
  const randomCount = Number(args.random ?? 200);
  const size = Number(args.size ?? 40);
  const nWorkers = Number(args.workers ?? Math.max(1, availableParallelism() - 2));

  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const base: Omit<Rule, 'density'>[] = [
    { name: 'bays-4555', survive: [4, 5], birth: [5] },
    { name: 'bays-5766', survive: [5, 6, 7], birth: [6] },
    { name: 's2-4-b6', survive: range(2, 4), birth: [6] },
    { name: 's2-5-b9-10', survive: range(2, 5), birth: [9, 10] },
    { name: 'architecture', survive: range(4, 6), birth: [3] },
    { name: 'coral', survive: range(5, 8), birth: [6, 7, 9, 12] },
    { name: 'clouds', survive: range(13, 26), birth: [13, 14, 17, 18, 19] },
    { name: 'amoeba', survive: range(9, 26), birth: [5, 6, 7, 12, 13, 15] },
    { name: 'stable', survive: range(13, 26), birth: range(14, 19) },
  ];
  const rngRules = makeRng(`rule-search-${args.salt ?? ''}`);
  for (let r = 0; r < randomCount; r++) {
    const s0 = 1 + rngRules.int(12);
    const s1 = Math.min(26, s0 + rngRules.int(9));
    const b0 = 3 + rngRules.int(10);
    const b1 = Math.min(26, b0 + rngRules.int(3));
    base.push({ name: `s${s0}-${s1}-b${b0}-${b1}`, survive: range(s0, s1), birth: range(b0, b1) });
  }
  const densities = [0.3, 0.5, 0.7];
  const tasks: Task[] = [];
  for (const b of base) for (const d of densities) tasks.push({ rule: { ...b, density: d }, seeds, size });

  const t0 = performance.now();
  const results: Result[] = [];
  const buckets: Task[][] = Array.from({ length: nWorkers }, () => []);
  tasks.forEach((t, i) => buckets[i % nWorkers].push(t));
  await Promise.all(
    buckets.map(
      (bucket) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), { workerData: bucket });
          w.on('message', (m: Result | null) => (m === null ? resolve() : results.push(m)));
          w.on('error', reject);
        }),
    ),
  );
  results.sort((a, b) => b.score - a.score);
  console.log(`searched ${tasks.length} rule/density pairs x ${seeds} seeds at ${size}^3 on ${nWorkers} workers in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  console.log('rule                     dens  score hold peak forms  fill lin  activity');
  for (const r of results.slice(0, 30)) {
    console.log(
      `${r.rule.name.padEnd(24)} ${r.rule.density.toFixed(1)} ${r.score.toFixed(2).padStart(6)} ${r.holding.toFixed(0).padStart(4)} ${r.peakHolding.toFixed(0).padStart(4)} ${r.forms.toFixed(0).padStart(5)} ${(r.fill * 100).toFixed(1).padStart(5)}% ${r.lineages.toFixed(1)} ${(r.activity * 100).toFixed(2).padStart(7)}%`,
    );
  }
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
