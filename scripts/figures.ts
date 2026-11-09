// Turn paper/data/*.json into the paper's SVG figures and a summary of every number the text quotes.
//   node scripts/figures.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chart, bars, heatmap, quantile, PALETTE } from './plot.ts';
import type { ExpResult } from './exp-worker.ts';
import { DEFAULT_SOCIETY } from '../src/sim/society.ts';
import { DEFAULT_CELLS, PERIOD_MAX, repeatLimit } from '../src/sim/cells.ts';
import { DEFAULT_WORLD } from '../src/sim/world.ts';

mkdirSync('paper/figures', { recursive: true });
const read = <T>(f: string): T | null => (existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null);
const save = (name: string, svg: string) => writeFileSync(`paper/figures/${name}.svg`, svg);
const summary: Record<string, unknown> = {
  params: { society: DEFAULT_SOCIETY, cells: { ...DEFAULT_CELLS, sMin: DEFAULT_CELLS.survive[0], sMax: DEFAULT_CELLS.survive[DEFAULT_CELLS.survive.length - 1], bMin: DEFAULT_CELLS.birth[0], bMax: DEFAULT_CELLS.birth[DEFAULT_CELLS.birth.length - 1], periodMax: PERIOD_MAX, stillGens: repeatLimit(DEFAULT_CELLS, 1) }, ticksPerGen: DEFAULT_WORLD.ticksPerGen },
};
const YEAR = 100;

/** Wilson score interval for a proportion. */
function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 0];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}

// ------------------------------------------------------------------ baseline
const base = read<ExpResult[]>('paper/data/baseline.json');
if (base) {
  const N = base.length;
  const names = ['Cells', 'Organisms', 'Tribes', 'Hierarchy', 'Government'];
  const colors = [PALETTE.gray, PALETTE.green, PALETTE.gold, PALETTE.red, PALETTE.blue];
  const horizon = 150;
  const series = [1, 2, 3, 4].map((lv) => {
    const times = base.map((r) => r.levels[lv]).filter((t) => t >= 0).map((t) => t / YEAR);
    const pts: [number, number][] = [];
    for (let y = 0; y <= horizon; y += 1) pts.push([y, times.filter((t) => t <= y).length / N]);
    return { type: 'step' as const, points: pts, color: colors[lv], label: names[lv], width: 2 };
  });
  save('levels', chart({ x: { min: 0, max: horizon, label: 'Year (100 ticks)' }, y: { min: 0, max: 1, label: 'Share of worlds that reached the level', format: (v) => `${Math.round(v * 100)}%` }, series, legend: 'bottom-right' }));
  const lv: Record<string, unknown> = {};
  for (const k of [1, 2, 3, 4]) {
    const times = base.map((r) => r.levels[k]).filter((t) => t >= 0).map((t) => t / YEAR);
    const ci = wilson(times.length, N);
    lv[names[k]] = { reached: times.length, of: N, share: times.length / N, ci95: ci, medianYear: quantile(times, 0.5), q25: quantile(times, 0.25), q75: quantile(times, 0.75) };
  }
  summary.baselineLevels = lv;

  // Order parameters through time: median and interquartile band across worlds.
  const ticks = base[0].samples.map((s) => s.tick);
  const at = (key: keyof ExpResult['samples'][number], q: number) =>
    ticks.map((t, k) => [t / YEAR, quantile(base.map((r) => (r.samples[k] ? (r.samples[k][key] as number) : NaN)).filter(Number.isFinite), q)] as [number, number]);
  const band = (key: keyof ExpResult['samples'][number]) => ticks.map((t, k) => {
    const v = base.map((r) => (r.samples[k] ? (r.samples[k][key] as number) : NaN)).filter(Number.isFinite);
    return [t / YEAR, quantile(v, 0.25), quantile(v, 0.75)] as [number, number, number];
  });
  save('order', chart({
    x: { min: 0, max: horizon, label: 'Year' },
    y: { min: 0, max: 1, label: 'Order parameter' },
    bands: [{ points: band('syntropy'), color: PALETTE.blue, opacity: 0.14 }, { points: band('organized'), color: PALETTE.green, opacity: 0.12 }],
    series: [
      { type: 'line', points: at('syntropy', 0.5), color: PALETTE.blue, label: 'Syntropy Σ (median, IQR)', width: 2.2 },
      { type: 'line', points: at('organized', 0.5), color: PALETTE.green, label: 'Share in major realms', width: 2 },
      { type: 'line', points: at('largestShare', 0.5), color: PALETTE.red, label: 'Share in the largest realm', width: 1.6, dash: '5 4' },
    ],
    legend: 'top-left',
  }));
  const late = (key: keyof ExpResult['samples'][number]) => base.map((r) => {
    const xs = r.samples.filter((s) => s.tick >= 7500).map((s) => s[key] as number);
    return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  });
  summary.baselineLate = {
    syntropyMedian: quantile(late('syntropy'), 0.5),
    organizedMedian: quantile(late('organized'), 0.5),
    largestMedian: quantile(late('largestShare'), 0.5),
    realmsMedian: quantile(late('realms'), 0.5),
    popMedian: quantile(late('pop'), 0.5),
    massMedian: quantile(late('meanMass'), 0.5),
    depthMedian: quantile(late('depth'), 0.5),
  };

  // When the last form came loose, and when and how the lattice ended (data from before the lattice
  // could end early has no record, and leaves the summary out).
  const ended = base.filter((r) => r.lattice);
  if (ended.length) {
    const spread = (xs: number[]) => {
      const v = [...xs].sort((a, b) => a - b);
      return { median: quantile(v, 0.5), min: v[0], max: v[v.length - 1] };
    };
    summary.handoff = {
      n: ended.length,
      lastSpawn: spread(ended.map((r) => r.lattice.lastSpawnTick / YEAR)),
      overlap: quantile(ended.map((r) => (r.lattice.lastSpawnTick - r.levels[1]) / YEAR), 0.5),
      end: spread(ended.map((r) => r.lattice.endTick / YEAR)),
      settledShare: ended.filter((r) => r.lattice.why === 'settled').length / ended.length,
      stillShare: ended.filter((r) => r.lattice.why === 'settled' && r.lattice.period === 1).length / ended.length,
      cycling: ended.filter((r) => r.lattice.why === 'settled' && r.lattice.period > 1).length,
      maxPeriod: Math.max(0, ...ended.map((r) => r.lattice.period)),
      dissolved: spread(ended.map((r) => r.lattice.dissolved)),
    };
  }

  // The hand-off from lattice to organisms.
  const early = ticks.filter((t) => t <= 4000);
  const med = (key: keyof ExpResult['samples'][number]) => early.map((t, k) => [t / YEAR, quantile(base.map((r) => r.samples[k][key] as number), 0.5)] as [number, number]);
  const lat0 = Math.max(...med('lattice').map((p) => p[1]));
  const pop0 = Math.max(...med('pop').map((p) => p[1]));
  save('transition', chart({
    x: { min: 0, max: 40, label: 'Year' },
    y: { min: 0, max: 1.05, label: 'Share of its own peak', format: (v) => `${Math.round(v * 100)}%` },
    series: [
      { type: 'line', points: med('lattice').map(([x, y]) => [x, y / lat0]), color: PALETTE.gold, label: `Lattice cells (peak ${Math.round(lat0).toLocaleString()})`, width: 2 },
      { type: 'line', points: med('spawned').map(([x, y]) => [x, y / Math.max(1, Math.max(...med('spawned').map((p) => p[1])))]), color: PALETTE.green, label: 'Forms come loose (total)', width: 2, dash: '5 4' },
      { type: 'line', points: med('pop').map(([x, y]) => [x, y / pop0]), color: PALETTE.blue, label: `Organisms (peak ${Math.round(pop0)})`, width: 2 },
    ],
    legend: 'bottom-right',
  }));

  // Succession: what predicts that a realm survives its ruler?
  const succ = base.flatMap((r) => r.successions).filter((s) => s.members >= 20);
  save('succession', chart({
    x: { min: 0, max: 1, label: "Largest direct branch's share of the realm at the ruler's death", format: (v) => `${Math.round(v * 100)}%` },
    y: { min: 0, max: 1, label: 'Share that regrouped under one ruler', format: (v) => `${Math.round(v * 100)}%` },
    hlines: [{ y: 0.6, color: PALETTE.muted, dash: '4 4', label: 'government threshold (60%)' }],
    series: [
      { type: 'scatter', points: succ.filter((s) => s.survived).map((s) => [s.heirShare, s.keep]), color: PALETTE.blue, label: 'Survived', r: 3.2, opacity: 0.65 },
      { type: 'scatter', points: succ.filter((s) => !s.survived).map((s) => [s.heirShare, s.keep]), color: PALETTE.red, label: 'Broke apart or absorbed', r: 3.2, opacity: 0.65 },
    ],
    legend: 'bottom-right',
  }));
  // Survival rate in bins, with Wilson intervals: by heir share and by spatial spread.
  const binned = (key: 'heirShare' | 'spread', edges: number[], label: string, color: string, fmtX: (v: number) => string) => {
    const pts = edges.slice(0, -1).map((lo, i) => {
      const hi = edges[i + 1];
      const xs = succ.filter((s) => s[key] >= lo && s[key] < hi);
      const k = xs.filter((s) => s.survived).length;
      return { x: (lo + hi) / 2, n: xs.length, rate: xs.length ? k / xs.length : NaN, ci: wilson(k, xs.length) };
    }).filter((p) => p.n >= 10);
    return chart({
      width: 420,
      height: 300,
      x: { min: edges[0], max: edges[edges.length - 1], label, format: fmtX },
      y: { min: 0, max: 1, label: 'Survived the succession test', format: (v) => `${Math.round(v * 100)}%` },
      bands: [{ points: pts.map((p) => [p.x, p.ci[0], p.ci[1]] as [number, number, number]), color, opacity: 0.16 }],
      series: [{ type: 'line', points: pts.map((p) => [p.x, p.rate] as [number, number]), color, width: 2.2 }, { type: 'scatter', points: pts.map((p) => [p.x, p.rate] as [number, number]), color, r: 3.5, opacity: 1 }],
    });
  };
  save('succession-heir', binned('heirShare', [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], "Largest branch's share at the ruler's death", PALETTE.gold, (v) => `${Math.round(v * 100)}%`));
  save('succession-spread', binned('spread', [0.5, 0.65, 0.8, 0.95, 1.1, 1.25, 1.4], 'Mean distance from the realm centre (perception radii)', PALETTE.violet, (v) => v.toFixed(1)));
  // Survival rate in bins of heir share and of spread.
  const bin = (key: 'heirShare' | 'spread', edges: number[]) => edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    const xs = succ.filter((s) => s[key] >= lo && s[key] < hi);
    const survived = xs.filter((s) => s.survived).length;
    return { lo, hi, n: xs.length, survived, rate: xs.length ? survived / xs.length : 0 };
  });
  const big = succ.filter((s) => s.members >= 30);
  summary.thresholds = [0.5, 0.6, 0.7, 0.8, 0.9].map((th) => ({ keep: th, share: big.filter((s) => s.keep >= th).length / Math.max(1, big.length), n: big.length }));
  summary.succession = {
    n: succ.length,
    survived: succ.filter((s) => s.survived).length,
    byHeirShare: bin('heirShare', [0, 0.2, 0.35, 0.5, 0.7, 1.01]),
    bySpread: bin('spread', [0, 0.5, 0.8, 1.2, 2, 99]),
  };

  // Realm sizes at the end: complementary cumulative distribution on log-log axes.
  const sizes = base.flatMap((r) => r.realmSizes).sort((a, b) => a - b);
  const ccdf: [number, number][] = sizes.map((s, i) => [s, (sizes.length - i) / sizes.length]);
  save('sizes', chart({
    x: { min: 5, max: Math.max(10, sizes[sizes.length - 1] ?? 10) * 1.1, label: 'Realm size (organisms)', log: true, ticks: [5, 10, 20, 50, 100, 200] },
    y: { min: Math.min(0.5, 1 / Math.max(1, sizes.length)), max: 1, label: 'Share of realms at least this big', log: true, ticks: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1] },
    series: [{ type: 'scatter', points: ccdf, color: PALETTE.violet, r: 2.4, opacity: 0.6 }],
  }));
  summary.sizes = { n: sizes.length, median: quantile(sizes, 0.5), p90: quantile(sizes, 0.9), max: sizes[sizes.length - 1] };

  // Stratification: energy per cell by rank.
  const maxRank = 9;
  const byRank = Array.from({ length: maxRank }, (_, d) => base.map((r) => r.energyByRank[d]).filter((v) => Number.isFinite(v)));
  save('rank-energy', chart({
    x: { min: -0.5, max: maxRank - 0.5, label: 'Rank (0 = ruler or loner)', ticks: Array.from({ length: maxRank }, (_, d) => d) },
    y: { min: 0, max: Math.max(1.2, ...byRank.map((v) => quantile(v, 0.75) || 0)) * 1.1, label: 'Stored energy per cell' },
    bands: [{ points: byRank.map((v, d) => [d, quantile(v, 0.25), quantile(v, 0.75)] as [number, number, number]).filter((p) => Number.isFinite(p[1])), color: PALETTE.gold, opacity: 0.18 }],
    series: [{ type: 'line', points: byRank.map((v, d) => [d, quantile(v, 0.5)] as [number, number]).filter((p) => Number.isFinite(p[1])), color: PALETTE.gold, width: 2.2, label: 'Median across worlds (IQR)' }],
    legend: 'top-right',
  }));
  summary.rankEnergy = byRank.map((v, d) => ({ rank: d, median: quantile(v, 0.5), worlds: v.length }));
  const stats = base.map((r) => r.stats);
  const per = (k: string) => quantile(stats.map((s) => s[k]), 0.5);
  summary.events = { births: per('births'), spawned: per('spawned'), fights: per('fights'), conquests: per('conquests'), joins: per('joins'), secessions: per('secessions'), rebellions: per('rebellions'), successions: per('successions'), fragmentations: per('fragmentations'), maxDepth: per('maxDepth'), maxRealm: per('maxRealm') };
}

// ------------------------------------------------------------------ ablations
const abl = read<{ name: string; runs: { levels: number[]; stats: Record<string, number>; summary: { syntropy: number; organized: number; maxDepth: number; largestShare: number } }[] }[]>('paper/data/ablations.json');
if (abl) {
  const share = (runs: { levels: number[] }[], lv: number) => runs.filter((r) => r.levels[lv] >= 0).length / runs.length;
  save('ablations', bars({
    width: 660,
    categories: abl.map((c) => c.name),
    groups: [
      { label: 'Tribes', color: PALETTE.gold, values: abl.map((c) => share(c.runs, 2)) },
      { label: 'Hierarchy', color: PALETTE.red, values: abl.map((c) => share(c.runs, 3)) },
      { label: 'Government', color: PALETTE.blue, values: abl.map((c) => share(c.runs, 4)) },
    ],
    y: { min: 0, max: 1, label: 'Share of worlds that reached the level within 120 years', ticks: [0, 0.25, 0.5, 0.75, 1] },
  }));
  summary.ablations = abl.map((c) => ({
    name: c.name,
    n: c.runs.length,
    tribes: share(c.runs, 2),
    hierarchy: share(c.runs, 3),
    government: share(c.runs, 4),
    govCi: wilson(c.runs.filter((r) => r.levels[4] >= 0).length, c.runs.length),
    syntropy: quantile(c.runs.map((r) => r.summary.syntropy), 0.5),
    organized: quantile(c.runs.map((r) => r.summary.organized), 0.5),
    largest: quantile(c.runs.map((r) => r.summary.largestShare), 0.5),
    maxDepth: quantile(c.runs.map((r) => r.summary.maxDepth), 0.5),
    conquests: quantile(c.runs.map((r) => r.stats.conquests), 0.5),
    fights: quantile(c.runs.map((r) => r.stats.fights), 0.5),
    tTribes: quantile(c.runs.filter((r) => r.levels[2] >= 0).map((r) => r.levels[2] / YEAR), 0.5),
    tHier: quantile(c.runs.filter((r) => r.levels[3] >= 0).map((r) => r.levels[3] / YEAR), 0.5),
    tGov: quantile(c.runs.filter((r) => r.levels[4] >= 0).map((r) => r.levels[4] / YEAR), 0.5),
  }));
  // A second panel: how the ingredients change the amount of order, not just whether the ladder is climbed.
  const named = (summary.ablations as { name: string; syntropy: number; maxDepth: number }[]);
  save('ablation-order', bars({
    width: 660,
    categories: named.map((c) => c.name),
    groups: [{ label: 'Median syntropy, second half', color: PALETTE.blue, values: named.map((c) => c.syntropy) }],
    y: { min: 0, max: 0.7, label: 'Syntropy \u03a3', ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], format: (v) => v.toFixed(1) },
    valueFormat: (v) => v.toFixed(2),
  }));
}

// ------------------------------------------------------------------ phase diagram
const phase = read<{ taus: number[]; fights: number[]; grid: { tribute: number; fightChance: number; runs: { levels: number[]; summary: { syntropy: number; maxDepth: number } }[] }[] }>('paper/data/phase.json');
if (phase) {
  const cell = (tau: number, f: number) => phase.grid.find((g) => g.tribute === tau && g.fightChance === f)!;
  const gov = phase.fights.map((f) => phase.taus.map((tau) => {
    const c = cell(tau, f);
    return c.runs.filter((r) => r.levels[4] >= 0).length / c.runs.length;
  }));
  const hier = phase.fights.map((f) => phase.taus.map((tau) => {
    const c = cell(tau, f);
    return c.runs.filter((r) => r.levels[3] >= 0).length / c.runs.length;
  }));
  const syn = phase.fights.map((f) => phase.taus.map((tau) => quantile(cell(tau, f).runs.map((r) => r.summary.syntropy), 0.5)));
  save('phase-gov', heatmap({ xs: phase.taus, ys: phase.fights, values: gov, min: 0, max: 1, xLabel: 'Tribute rate τ', yLabel: 'Fight rate φ', title: 'Worlds reaching Government', valueFormat: (v) => `${Math.round(v * 100)}` }));
  save('phase-hier', heatmap({ xs: phase.taus, ys: phase.fights, values: hier, min: 0, max: 1, xLabel: 'Tribute rate τ', yLabel: 'Fight rate φ', title: 'Worlds reaching Hierarchy', valueFormat: (v) => `${Math.round(v * 100)}` }));
  save('phase-syntropy', heatmap({ xs: phase.taus, ys: phase.fights, values: syn, min: 0, max: Math.max(0.3, ...syn.flat()), xLabel: 'Tribute rate τ', yLabel: 'Fight rate φ', title: 'Median syntropy Σ, second half', valueFormat: (v) => v.toFixed(2) }));
  summary.phase = { taus: phase.taus, fights: phase.fights, gov, hier, syn };
}

// ------------------------------------------------------------------ fear x tribute
const pf = read<{ fears: number[]; taus: number[]; grid: { fear: number; tribute: number; runs: { levels: number[]; summary: { syntropy: number; maxDepth: number; organized: number } }[] }[] }>('paper/data/phase-fear.json');
if (pf) {
  const cell = (fear: number, tau: number) => pf.grid.find((g) => g.fear === fear && g.tribute === tau)!;
  const share = (lv: number) => pf.fears.map((fear) => pf.taus.map((tau) => {
    const c = cell(fear, tau);
    return c.runs.filter((r) => r.levels[lv] >= 0).length / c.runs.length;
  }));
  const gov = share(4);
  const hier = share(3);
  const tribes = share(2);
  const syn = pf.fears.map((fear) => pf.taus.map((tau) => quantile(cell(fear, tau).runs.map((r) => r.summary.syntropy), 0.5)));
  save('phase-fear-gov', heatmap({ xs: pf.taus, ys: pf.fears, values: gov, min: 0, max: 1, xLabel: 'Tribute rate \u03c4', yLabel: 'Fear \u03c9', title: 'Worlds reaching Government (%)', valueFormat: (v) => `${Math.round(v * 100)}` }));
  save('phase-fear-syntropy', heatmap({ xs: pf.taus, ys: pf.fears, values: syn, min: 0, max: Math.max(0.3, ...syn.flat()), xLabel: 'Tribute rate \u03c4', yLabel: 'Fear \u03c9', title: 'Median syntropy \u03a3', valueFormat: (v) => v.toFixed(2) }));
  summary.phaseFear = { fears: pf.fears, taus: pf.taus, gov, hier, tribes, syn };
}

// ------------------------------------------------------------------ rule landscape
const rules = read<{ name: string; holding: number; fill: number; lineages: number }[]>('paper/data/rules.json');
if (rules) {
  const chosen = rules.filter((r) => r.name.startsWith('S1-5/B7-8'));
  const bays = rules.filter((r) => r.name.includes('Bays'));
  const rest = rules.filter((r) => !chosen.includes(r) && !bays.includes(r));
  save('rules', chart({
    x: { min: 0, max: 0.4, label: 'Share of the lattice alive at generation 120', format: (v) => `${Math.round(v * 100)}%` },
    y: { min: 0, max: Math.max(60, ...rules.map((r) => r.holding)) * 1.1, label: 'Forms holding their shape (20+ generations)' },
    series: [
      { type: 'scatter', points: rest.map((r) => [r.fill, r.holding]), color: PALETTE.gray, r: 2.4, opacity: 0.55, label: '220 random birth/survival rules' },
      { type: 'scatter', points: bays.map((r) => [r.fill, r.holding]), color: PALETTE.gold, r: 4.5, opacity: 1, label: "Bays' 3D Life, S4-5/B5" },
      { type: 'scatter', points: chosen.map((r) => [r.fill, r.holding]), color: PALETTE.red, r: 5, opacity: 1, label: 'Syntropy, S1-5/B7-8' },
    ],
    legend: 'top-right',
  }));
  summary.rules = { chosen: chosen[0], bays: bays[0], n: rules.length, betterThanChosen: rules.filter((r) => r.holding > (chosen[0]?.holding ?? 0) && r.fill < 0.2).length };
}

writeFileSync('paper/data/summary.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2).slice(0, 4000));
