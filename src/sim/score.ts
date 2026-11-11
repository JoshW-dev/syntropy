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

/** A part of the world, as a test on a place. Without one, a measurement covers the whole world. */
export type Region = (x: number, y: number, z: number) => boolean;

/**
 * The society at one tick, in the whole world or in one region of it. A region's census counts the
 * organisms that sit in the region and the groups whose leader sits in it. A group is always taken
 * whole, wherever its members are. A share is NaN when there is nobody to take it of.
 */
export interface Census {
  tick: number;
  pop: number;
  /** Fights so far in the run (in the region, by where they happened), so two censuses give a rate. */
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
  /** Mean number of other organisms within an organism's own perception radius. */
  inView: number;
  /** Share of a region's organisms in a group of 5 or more whose leader sits outside it. NaN for the whole world. */
  across: number;
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
  across: number;
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

/**
 * The parts of a world to measure apart: its murky water and its clear water when it holds both,
 * and nothing when the water is the same everywhere.
 */
export function waterRegions(s: Society): { name: 'murky' | 'clear'; has: Region }[] {
  if (!s.twoWaters) return [];
  return [
    { name: 'murky', has: (x, y, z) => s.murkyAt(x, y, z) },
    { name: 'clear', has: (x, y, z) => !s.murkyAt(x, y, z) },
  ];
}

/** Count the society as it stands: who is in a group, how the groups are built, how crowded it is. */
export function census(s: Society, region?: Region): Census {
  const { M, alive, lord, tribe, pos, p } = s;
  // Follow each organism up to its top leader. The society's own tree arrays are a tick behind.
  const top = new Int32Array(M);
  const rank = new Int32Array(M);
  const size = new Int32Array(M);
  const here = new Uint8Array(M);
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
    here[i] = !region || region(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]) ? 1 : 0;
    ids.push(i);
  }
  const deepest = new Int32Array(M);
  const others = new Int32Array(M);
  let N = 0;
  let inGroups = 0;
  let outside = 0;
  let across = 0;
  for (const i of ids) {
    const r = top[i];
    if (here[i]) {
      N++;
      if (size[r] < p.realmMin) outside++;
      else if (!here[r]) across++;
      if (size[r] >= p.notableSize) inGroups++;
    }
    if (size[r] < p.notableSize) continue;
    if (rank[i] > deepest[r]) deepest[r] = rank[i];
    if (tribe[i] !== tribe[r]) others[r]++;
  }
  const sizes: number[] = [];
  let rankSum = 0;
  let otherSum = 0;
  for (const i of ids) {
    if (top[i] !== i || !here[i] || size[i] < p.notableSize) continue;
    sizes.push(size[i]);
    rankSum += deepest[i];
    otherSum += others[i] / size[i];
  }
  // Crowding as the choice rule meets it: each organism counts the others inside its own
  // perception radius, which is shorter in murky water.
  const n = ids.length;
  const R2 = new Float64Array(n);
  for (let a = 0; a < n; a++) R2[a] = s.senseAt(ids[a]) ** 2;
  let seen = 0;
  for (let a = 0; a < n; a++) {
    const i = 3 * ids[a];
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    const ha = here[ids[a]];
    for (let b = a + 1; b < n; b++) {
      const j = 3 * ids[b];
      const dx = x - pos[j];
      const dy = y - pos[j + 1];
      const dz = z - pos[j + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (ha && d2 <= R2[a]) seen++;
      if (d2 <= R2[b] && here[ids[b]]) seen++;
    }
  }
  let fights = s.stats.fights;
  if (region) {
    fights = 0;
    const F = s.F;
    for (let c = 0; c < s.fightsAt.length; c++) {
      if (!s.fightsAt[c]) continue;
      const cx = (((c % F) + 0.5) / F) * 2 - 1;
      const cy = (((Math.floor(c / F) % F) + 0.5) / F) * 2 - 1;
      const cz = ((Math.floor(c / (F * F)) + 0.5) / F) * 2 - 1;
      if (region(cx, cy, cz)) fights += s.fightsAt[c];
    }
  }
  const g = sizes.length;
  return {
    tick: s.tick,
    pop: N,
    fights,
    inGroups: N ? inGroups / N : NaN,
    outside: N ? outside / N : NaN,
    groups: g,
    ranks: g ? rankSum / g : NaN,
    groupSize: median(sizes),
    otherLineage: g ? otherSum / g : NaN,
    inView: N ? seen / N : NaN,
    across: region && N ? across / N : NaN,
  };
}

/**
 * The fingerprint of a stretch of a run: the censuses the caller took over it, averaged, plus the
 * three measures that need events (fights between the first census and the last, and regrouping
 * and group life over the whole run). Pass the region the censuses were taken in, and the events
 * are those that happened there: a leader death by where its members were, a group by where it formed.
 */
export function fingerprint(s: Society, censuses: Census[], region?: Region): Fingerprint {
  const avg = (pick: (c: Census) => number) => mean(censuses.map(pick).filter((v) => !Number.isNaN(v)));
  const first = censuses[0];
  const last = censuses[censuses.length - 1];
  const pop = avg((c) => c.pop);
  const span = first ? last.tick - first.tick : 0;
  const inside = (o: { x: number; y: number; z: number }) => !region || region(o.x, o.y, o.z);
  const deaths = s.successions.filter((x) => x.members >= REGROUP_MIN && inside(x));
  const regrouped = deaths.filter((x) => x.survived).length;
  const T = s.tick;
  const lives = s.realms
    .filter((r) => r.peak >= s.p.notableSize && r.founded >= GROUP_LIFE_FROM && r.founded <= T - GROUP_LIFE_TAIL && inside(r))
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
    across: avg((c) => c.across),
    fights: span > 0 && pop > 0 ? ((last.fights - first.fights) / span / pop) * 1e6 : NaN,
    leaderDeaths: deaths.length,
    regrouped,
    regroup: deaths.length ? regrouped / deaths.length : NaN,
    groupLife: median(lives),
    groupsTimed: lives.length,
  };
}

// ---------------------------------------------------------------- the climate cycle
// Two measures for a world whose food rises and falls: the society at each phase of the cycle, and
// how many groups last from one moment of the cycle to the same moment of the next. They work on a
// steady world too, where they give the numbers to compare against.

/**
 * A cycle is cut into this many phases. Phase 0 starts when food rises through its usual amount,
 * so food is highest at the end of phase 1, back at the usual amount at the end of phase 3, and
 * lowest at the end of phase 5.
 */
export const PHASES = 8;

/** The phase a census taken at `tick` belongs to. That census shows the world after tick - 1 ticks of food. */
export function phaseOf(tick: number, period: number): number {
  const t = (((tick - 1) % period) + period) % period;
  return Math.floor((t / period) * PHASES) % PHASES;
}

/** The society at one phase of the cycle: means over every census taken in that phase. */
export interface PhaseRow {
  phase: number;
  censuses: number;
  pop: number;
  inGroups: number;
  outside: number;
  groups: number;
  ranks: number;
  inView: number;
}

/** Sort censuses by phase of the cycle and average each phase. A phase with no census gives NaN. */
export function byPhase(censuses: Census[], period: number): PhaseRow[] {
  const bins: Census[][] = Array.from({ length: PHASES }, () => []);
  for (const c of censuses) bins[phaseOf(c.tick, period)].push(c);
  return bins.map((list, phase) => {
    const avg = (pick: (c: Census) => number) => mean(list.map(pick).filter((v) => !Number.isNaN(v)));
    return { phase, censuses: list.length, pop: avg((c) => c.pop), inGroups: avg((c) => c.inGroups), outside: avg((c) => c.outside), groups: avg((c) => c.groups), ranks: avg((c) => c.ranks), inView: avg((c) => c.inView) };
  });
}

/** The ticks in [from, to] at which food capacity is highest: a quarter of the way into each cycle. */
export function foodHighs(period: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = period / 4; t <= to; t += period) if (t >= from) out.push(t);
  return out;
}

/** Of the groups standing at one tick, how many still stood at a later one. */
export interface Lasting {
  from: number;
  to: number;
  standing: number;
  lasted: number;
}

/**
 * Count the groups that stood at `from` and still stood at `to`. A group counts when it grows to
 * notableSize (15) members at some time in its life, and it is the same group for as long as its
 * members keep regrouping under one leader, whoever that leader is.
 */
export function lasting(s: Society, from: number, to: number): Lasting {
  let standing = 0;
  let lasted = 0;
  for (const r of s.realms) {
    if (r.peak < s.p.notableSize || r.founded > from) continue;
    if (r.ended >= 0 && r.ended <= from) continue;
    standing++;
    if (r.ended < 0 || r.ended > to) lasted++;
  }
  return { from, to, standing, lasted };
}

/** Lineages with at least one organism alive. */
export function lineagesAlive(s: Society): number {
  const seen = new Set<number>();
  for (let i = 0; i < s.M; i++) if (s.alive[i]) seen.add(s.tribe[i]);
  return seen.size;
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
