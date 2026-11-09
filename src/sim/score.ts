// What a run produced, in numbers, and how close it came to the story we want: tribes first, then a
// multi-tribe hierarchy, then a realm that outlives its ruler, at a watchable pace, with several
// realms rising and falling instead of one blob or a hundred crumbs.

import type { Society } from './society.ts';
import { L_GOVERNMENT, L_HIERARCHY, L_TRIBES } from './society.ts';

export interface RunSummary {
  seed: string;
  ticks: number;
  pop: number;
  extinct: boolean;
  tOrganisms: number;
  tTribes: number;
  tHier: number;
  tGov: number;
  /** Mean count of major realms (notableSize+ members) over the second half of the run. */
  realms: number;
  /** Mean share of the population inside major realms, second half. */
  organized: number;
  /** Mean share of the population in the largest realm, second half. */
  largestShare: number;
  /** Mean syntropy (normalised negentropy of the polity partition), second half. */
  syntropy: number;
  /** Realms that reached govSize and had 3+ rulers. */
  dynasties: number;
  maxRealm: number;
  maxDepth: number;
  /** Chronicle-sized rebellions per 1,000 ticks. */
  churn: number;
  conquests: number;
  successions: number;
  fragmentations: number;
  score: number;
}

export function summarize(s: Society, seed: string): RunSummary {
  const half = s.history.filter((h) => h.tick >= s.tick / 2);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const summary: RunSummary = {
    seed,
    ticks: s.tick,
    pop: s.count,
    extinct: s.count === 0,
    tOrganisms: s.levels[1],
    tTribes: s.levels[L_TRIBES],
    tHier: s.levels[L_HIERARCHY],
    tGov: s.levels[L_GOVERNMENT],
    realms: mean(half.map((h) => h.major)),
    organized: mean(half.map((h) => (h.pop > 0 ? h.organized / h.pop : 0))),
    largestShare: mean(half.map((h) => (h.pop > 0 ? h.largest / h.pop : 0))),
    syntropy: mean(half.map((h) => h.syntropy)),
    dynasties: s.realms.filter((r) => r.peak >= s.p.govSize && r.rulers >= 3).length,
    maxRealm: s.stats.maxRealm,
    maxDepth: s.stats.maxDepth,
    churn: (s.stats.rebellions * 1000) / Math.max(1, s.tick),
    conquests: s.stats.conquests,
    successions: s.stats.successions,
    fragmentations: s.stats.fragmentations,
    score: 0,
  };
  summary.score = scoreRun(summary);
  return summary;
}

/** 1 inside [lo, hi], falling linearly to 0 over `soft` outside. */
export function band(x: number, lo: number, hi: number, soft: number): number {
  if (x >= lo && x <= hi) return 1;
  const d = x < lo ? lo - x : x - hi;
  return Math.max(0, 1 - d / soft);
}

/** Pacing targets in ticks (60 ticks per second at 1x): tribes ~20 s, hierarchy ~40 s, government ~70 s. */
export const PACE = { tribes: [600, 2000], hier: [1500, 3600], gov: [2700, 6000] } as const;

export function scoreRun(r: RunSummary): number {
  let s = 0;
  if (r.tTribes >= 0) s += 0.5 + 0.25 * band(r.tTribes, PACE.tribes[0], PACE.tribes[1], 1200);
  if (r.tHier >= 0) s += 1.5 + 0.5 * band(r.tHier, PACE.hier[0], PACE.hier[1], 2000);
  if (r.tGov >= 0) s += 2 + 0.5 * band(r.tGov, PACE.gov[0], PACE.gov[1], 3000);
  s += 0.75 * band(r.realms, 3, 14, 3);
  s += 0.75 * band(r.organized, 0.5, 1, 0.3);
  s += 0.5 * band(r.largestShare, 0.12, 0.6, 0.15);
  s += 0.5 * Math.min(1, r.dynasties / 2);
  const perK = 1000 / Math.max(1, r.ticks);
  s += 0.3 * band(r.conquests * perK, 0.3, 6, 2);
  s += 0.3 * band(r.churn, 0.2, 4, 3);
  s += 0.2 * Math.min(1, r.fragmentations);
  s += 0.5 * band(r.pop, 300, 1100, 250);
  // Chains of command a reader can follow: up to a dozen ranks, not two dozen.
  s += 0.6 * band(r.maxDepth, 4, 12, 8);
  if (r.extinct || r.pop < 120) s -= 3;
  return s;
}
