// What a run produced, in numbers, and how close it came to the story we want:
// tribes first, then a multi-tribe hierarchy, then a realm that outlives its ruler,
// with several realms rising and falling instead of one blob or a hundred crumbs.

import type { Society } from './society.ts';
import { L_GOVERNMENT, L_HIERARCHY, L_TRIBES } from './society.ts';

export interface RunSummary {
  seed: string;
  ticks: number;
  pop: number;
  extinct: boolean;
  tTribes: number;
  tHier: number;
  tGov: number;
  /** Mean count of major realms (notableSize+ members) over the second half of the run. */
  realms: number;
  /** Mean share of the population inside major realms, second half. */
  organized: number;
  /** Mean share of the population in the largest realm, second half. */
  largestShare: number;
  /** Realms that reached govSize and had 3+ rulers. */
  dynasties: number;
  maxRealm: number;
  maxDepth: number;
  /** Rebellions plus coups per 1,000 ticks. */
  churn: number;
  conquests: number;
  successions: number;
  fragmentations: number;
  score: number;
}

export function summarize(s: Society, seed: string): RunSummary {
  const half = s.history.filter((h) => h.tick >= s.tick / 2);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const realms = mean(half.map((h) => h.major));
  const organized = mean(half.map((h) => (h.pop > 0 ? h.organized / h.pop : 0)));
  const largestShare = mean(half.map((h) => (h.pop > 0 ? h.largest / h.pop : 0)));
  const dynasties = s.realms.filter((r) => r.peak >= s.p.govSize && r.rulers >= 3).length;
  const churn = ((s.stats.rebellions + s.stats.coups) * 1000) / Math.max(1, s.tick);
  const summary: RunSummary = {
    seed,
    ticks: s.tick,
    pop: s.count,
    extinct: s.count === 0,
    tTribes: s.levels[L_TRIBES],
    tHier: s.levels[L_HIERARCHY],
    tGov: s.levels[L_GOVERNMENT],
    realms,
    organized,
    largestShare,
    dynasties,
    maxRealm: s.stats.maxRealm,
    maxDepth: s.stats.maxDepth,
    churn,
    conquests: s.stats.conquests,
    successions: s.stats.successions,
    fragmentations: s.stats.fragmentations,
    score: 0,
  };
  summary.score = scoreRun(summary);
  return summary;
}

/** 1 inside [lo, hi], falling linearly to 0 over `soft` outside. */
function band(x: number, lo: number, hi: number, soft: number): number {
  if (x >= lo && x <= hi) return 1;
  const d = x < lo ? lo - x : x - hi;
  return Math.max(0, 1 - d / soft);
}

export function scoreRun(r: RunSummary): number {
  let s = 0;
  if (r.tTribes >= 0) s += 0.5;
  if (r.tHier >= 0) s += 1.5 + 0.5 * band(r.tHier, 2500, 9000, 2500);
  if (r.tGov >= 0) s += 2 + (r.tHier >= 0 && r.tGov - r.tHier >= 500 ? 0.5 : 0.15);
  s += 0.75 * band(r.realms, 3, 12, 3);
  s += 0.75 * band(r.organized, 0.6, 1, 0.3);
  s += 0.75 * band(r.largestShare, 0.15, 0.6, 0.15);
  s += 0.5 * Math.min(1, r.dynasties / 2);
  // A history worth reading: some wars, some rebellions, some realms that fall apart.
  const perK = 1000 / Math.max(1, r.ticks);
  s += 0.3 * band(r.conquests * perK, 0.3, 4, 1);
  s += 0.3 * band(r.churn, 0.4, 5, 3);
  s += 0.2 * Math.min(1, r.fragmentations);
  s -= 0.5 * Math.min(1, Math.max(0, (r.churn - 8) / 20));
  // Enough organisms to fill the box, not so many it turns to fog.
  s += 0.5 * band(r.pop, 400, 1100, 250);
  if (r.extinct || r.pop < 150) s -= 3;
  return s;
}
