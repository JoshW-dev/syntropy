// What a run produced, in numbers, and how close it came to the story we want: tribes first, then a
// multi-tribe hierarchy, then a realm that outlives its ruler, at a watchable pace, with several
// realms rising and falling instead of one blob or a hundred crumbs. Below that, the fingerprint:
// the measures of a society from outside that the environment experiments compare.

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

// ---------------------------------------------------------------- fingerprint
// A society measured from outside, so that two worlds with different environments can be compared.
// Nothing here is read back by the simulation: census() and fingerprint() only look.

/** Leader deaths count toward the regroup share when the group had this many members. */
export const REGROUP_MIN = 20;
/** Group life skips groups founded before this tick, and those founded in the last GROUP_LIFE_TAIL ticks. */
export const GROUP_LIFE_FROM = 2000;
export const GROUP_LIFE_TAIL = 3000;

/** The society at one tick. A share is NaN when there is nobody to take it of. */
export interface Census {
  tick: number;
  pop: number;
  /** Fights so far in the run, so two censuses give a rate. */
  fights: number;
  /** Share of organisms in groups of notableSize (15) or more. */
  inGroups: number;
  /** Share of organisms outside any group of realmMin (5). */
  outside: number;
  /** Groups of 15 or more. The next three are taken over these groups, and are NaN when there are none. */
  groups: number;
  /** Ranks below the leader: the deepest chain in each group, averaged over groups. */
  ranks: number;
  /** Median group size. */
  groupSize: number;
  /** Share of a group's members from another lineage than its leader's, averaged over groups. */
  otherLineage: number;
  /** Mean number of other organisms within an organism's perception radius. */
  inView: number;
}

export interface Fingerprint {
  /** The ticks the censuses span, and how many there were. */
  from: number;
  to: number;
  censuses: number;
  /** Means over the censuses (see Census). */
  pop: number;
  inGroups: number;
  outside: number;
  groups: number;
  ranks: number;
  groupSize: number;
  otherLineage: number;
  inView: number;
  /** Fights per 1,000 organisms per 1,000 ticks, between the first census and the last. */
  fights: number;
  /** Leader deaths in groups of REGROUP_MIN or more over the whole run, and how many regrouped. */
  leaderDeaths: number;
  regrouped: number;
  /** regrouped / leaderDeaths, NaN when no such leader has died. */
  regroup: number;
  /** Median life in ticks of the groups that reached 15 members; one still standing counts to now. */
  groupLife: number;
  /** How many groups that median is over. */
  groupsTimed: number;
}

/** Count the society as it stands: who is in a group, how the groups are built, how crowded it is. */
export function census(s: Society): Census {
  const { M, alive, lord, tribe, pos, p } = s;
  // Follow each organism up to its top leader. The society's own tree arrays are a tick behind.
  const top = new Int32Array(M);
  const rank = new Int32Array(M);
  const size = new Int32Array(M);
  const ids: number[] = [];
  for (let i = 0; i < M; i++) {
    if (!alive[i]) continue;
    let k = i;
    let d = 0;
    while (lord[k] >= 0 && d < M) {
      k = lord[k];
      d++;
    }
    top[i] = k;
    rank[i] = d;
    size[k]++;
    ids.push(i);
  }
  const N = ids.length;
  const deepest = new Int32Array(M);
  const others = new Int32Array(M);
  let inGroups = 0;
  let outside = 0;
  for (const i of ids) {
    const r = top[i];
    if (size[r] < p.realmMin) outside++;
    if (size[r] < p.notableSize) continue;
    inGroups++;
    if (rank[i] > deepest[r]) deepest[r] = rank[i];
    if (tribe[i] !== tribe[r]) others[r]++;
  }
  const sizes: number[] = [];
  let rankSum = 0;
  let otherSum = 0;
  for (const i of ids) {
    if (top[i] !== i || size[i] < p.notableSize) continue;
    sizes.push(size[i]);
    rankSum += deepest[i];
    otherSum += others[i] / size[i];
  }
  // Crowding as the choice rule meets it: every pair within one perception radius sees each other.
  const R2 = p.senseRadius * p.senseRadius;
  let seen = 0;
  for (let a = 0; a < N; a++) {
    const i = 3 * ids[a];
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    for (let b = a + 1; b < N; b++) {
      const j = 3 * ids[b];
      const dx = x - pos[j];
      const dy = y - pos[j + 1];
      const dz = z - pos[j + 2];
      if (dx * dx + dy * dy + dz * dz <= R2) seen += 2;
    }
  }
  const g = sizes.length;
  return {
    tick: s.tick,
    pop: N,
    fights: s.stats.fights,
    inGroups: N ? inGroups / N : NaN,
    outside: N ? outside / N : NaN,
    groups: g,
    ranks: g ? rankSum / g : NaN,
    groupSize: median(sizes),
    otherLineage: g ? otherSum / g : NaN,
    inView: N ? seen / N : NaN,
  };
}

/**
 * The fingerprint of a stretch of a run: the censuses the caller took over it, averaged, plus the
 * three measures that need events (fights between the first census and the last, and regrouping
 * and group life over the whole run).
 */
export function fingerprint(s: Society, censuses: Census[]): Fingerprint {
  const avg = (pick: (c: Census) => number) => mean(censuses.map(pick).filter((v) => !Number.isNaN(v)));
  const first = censuses[0];
  const last = censuses[censuses.length - 1];
  const pop = avg((c) => c.pop);
  const span = first ? last.tick - first.tick : 0;
  const deaths = s.successions.filter((x) => x.members >= REGROUP_MIN);
  const regrouped = deaths.filter((x) => x.survived).length;
  const T = s.tick;
  const lives = s.realms
    .filter((r) => r.peak >= s.p.notableSize && r.founded >= GROUP_LIFE_FROM && r.founded <= T - GROUP_LIFE_TAIL)
    .map((r) => (r.ended < 0 ? T : r.ended) - r.founded);
  return {
    from: first ? first.tick : T,
    to: last ? last.tick : T,
    censuses: censuses.length,
    pop,
    inGroups: avg((c) => c.inGroups),
    outside: avg((c) => c.outside),
    groups: avg((c) => c.groups),
    ranks: avg((c) => c.ranks),
    groupSize: avg((c) => c.groupSize),
    otherLineage: avg((c) => c.otherLineage),
    inView: avg((c) => c.inView),
    fights: span > 0 && pop > 0 ? ((last.fights - first.fights) / span / pop) * 1e6 : NaN,
    leaderDeaths: deaths.length,
    regrouped,
    regroup: deaths.length ? regrouped / deaths.length : NaN,
    groupLife: median(lives),
    groupsTimed: lives.length,
  };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const sorted = [...xs].sort((a, b) => a - b);
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
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
