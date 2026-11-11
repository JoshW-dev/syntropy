// The app: one continuous world. The lattice runs from the first frame, forms that hold come loose
// as organisms one at a time, and the society grows out of them. The ladder, chronicle and readouts
// only report what the simulation measured.

import * as THREE from 'three';
import { Stage } from './render/stage.ts';
import { Voxels } from './render/voxels.ts';
import { Bodies } from './render/bodies.ts';
import { Haze } from './render/haze.ts';
import { PAPER, type Theme } from './render/theme.ts';
import { World, withOverrides, LADDER, type WorldParams, type Overrides } from './sim/world.ts';
import { randomSeed } from './sim/rng.ts';
import { TRIBE_NAMES } from './sim/names.ts';
import type { SimEvent } from './sim/society.ts';
import { Hud, type Step } from './ui/hud.ts';
import { writeQuery } from './ui/query.ts';

const TICKS_PER_SECOND = 60;
export const TICKS_PER_YEAR = 100;
/** Ticks over which the lattice's last cells shrink away when it ends (2 s at 1x). */
const DISSOLVE_TICKS = 120;
/** Milliseconds of each frame spent stepping while a replay runs forward to its year. */
const SEEK_BUDGET = 11;

/** An organism a viewer removed: when, and which one. Enough to replay the same history from a link. */
export interface Strike {
  tick: number;
  uid: number;
}

/** Strikes travel in the link as ?k=tick.uid_tick.uid. */
export function parseStrikes(raw: string | null): Strike[] {
  if (!raw) return [];
  return raw
    .split('_')
    .map((part) => part.split('.').map(Number))
    .filter(([tick, uid]) => Number.isInteger(tick) && Number.isInteger(uid) && tick >= 0 && uid > 0)
    .map(([tick, uid]) => ({ tick, uid }))
    .slice(0, 40);
}

function steps(p: WorldParams): Step[] {
  const c = p.cells;
  const s = p.society;
  const list = (xs: number[]) => (xs.length === 2 ? `${xs[0]} or ${xs[1]}` : `${xs[0]} to ${xs[xs.length - 1]}`);
  return [
    { name: LADDER[0], rule: `A dead cell with ${list(c.birth)} live neighbours is born. A live cell with ${list(c.survive)} survives.`, done: 'The lattice starts alive.' },
    { name: LADDER[1], rule: `A form that keeps its shape for ${c.holdGens} generations comes loose as one body. Bodies eat, grow a cell on surplus, burn one when starving, and split at ${s.splitMass} cells.`, done: 'Reached when the first form comes loose.' },
    { name: LADDER[2], rule: 'Each organism follows whoever keeps it safest, after the tax it would pay. Kin tax each other less. A ring marks a leader.', done: `Reached when ${s.tribeCount} groups of ${s.tribeMin}+, mostly kin, each follow one leader.` },
    { name: LADDER[3], rule: "Losers of fights lose cells to the winner, and tax flows up every chain. Followers hang below their leader on a line in the top leader's colour.", done: `Reached when a group of ${s.hierSize}+ has ${s.hierDepth + 1} ranks and members from other lineages.` },
    { name: LADDER[4], rule: 'Nobody inherits anything. When a leader dies, every follower chooses again.', done: `Reached when ${Math.round(s.govKeep * 100)}% of a group of ${s.govSize}+ regroup under one new leader.` },
  ];
}

export class App {
  readonly stage: Stage;
  readonly hud: Hud;
  params: WorldParams;
  theme: Theme = PAPER;
  seed = '';
  world!: World;
  private voxels: Voxels | null = null;
  bodies: Bodies | null = null;
  private haze: Haze | null = null;
  speed: number;
  paused = false;
  /** Ticks per second multiplier that replaces the speed setting while set (slow motion). */
  slow: number | null = null;
  /** The organism a viewer picked, as a society slot, or -1. */
  selected = -1;
  /** A ruler whose realm is lit while the rest of the world pales (a hovered list row), or -1. */
  spotRoot = -1;
  /** Slots lit instead (a realm's orphans during a succession watch), or null. */
  spotMask: Uint8Array | null = null;
  private selectedUid = 0;
  /** Strikes made in this world so far, and strikes from a link that are still to come. */
  strikes: Strike[] = [];
  private scheduled: Strike[] = [];
  private seekTo = -1;
  private seenSamples = 0;
  /** Listeners. Each list is called in order; modules in src/ui add themselves. */
  readonly onStart: (() => void)[] = [];
  readonly onFrame: ((dt: number) => void)[] = [];
  readonly onSurvey: (() => void)[] = [];
  readonly onEvent: ((e: SimEvent) => void)[] = [];
  readonly onSelect: (() => void)[] = [];
  private acc = 0;
  private last = 0;
  private seenEvents = 0;
  private realmsSeen = 0;
  private lastCells = -1;
  private pointer: { x: number; y: number } | null = null;
  private tmp = new THREE.Vector3();
  private overrides: Overrides;
  /** Which world layers are drawn; kept across restarts. */
  readonly show = { lines: true, rings: true, food: true };

  constructor(canvas: HTMLCanvasElement, opts: { overrides?: Overrides; speed?: number; reducedMotion: boolean }) {
    this.overrides = opts.overrides ?? {};
    this.params = withOverrides(this.overrides);
    this.speed = opts.speed ?? 1;
    this.stage = new Stage(canvas, opts.reducedMotion);
    this.hud = new Hud(steps(this.params), {
      pause: () => this.togglePause(),
      speed: (n) => this.setSpeed(n),
      newWorld: () => this.newWorld(),
      share: async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          return true;
        } catch {
          return false;
        }
      },
      skip: () => undefined,
    });
    this.hud.setSpeed(this.speed);
    this.hud.setSkippable(false);

    canvas.addEventListener('pointermove', (e) => (this.pointer = e.pointerType === 'touch' ? null : { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerleave', () => (this.pointer = null));
    // A press that does not drag picks the organism under it; a drag still orbits.
    let down: { x: number; y: number; t: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
    canvas.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 500) return;
      this.select(this.pickAt(e.clientX, e.clientY, e.pointerType === 'touch' ? 26 : 16));
    });
    // A realm's label picks its ruler.
    document.getElementById('labels')!.addEventListener('click', (e) => {
      const el = (e.target as Element).closest<HTMLElement>('.label');
      if (el?.dataset.slot) this.select(Number(el.dataset.slot));
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePause();
      } else if (e.key === 'n' || e.key === 'N') this.newWorld();
      else if (['1', '2', '3', '4'].includes(e.key)) this.setSpeed([1, 2, 4, 8][Number(e.key) - 1]);
    });
    window.addEventListener('hashchange', () => {
      const s = seedFromHash();
      if (s && s !== this.seed) this.start(s);
    });
  }

  /**
   * Start (or restart) a world. `overrides` replaces the environment settings when given, and
   * `strikes` are a link's removals, applied again at the ticks they first happened.
   */
  start(seed: string, overrides?: Overrides, strikes: Strike[] = []): void {
    if (overrides) {
      this.overrides = overrides;
      this.params = withOverrides(overrides);
      this.hud.setSteps(steps(this.params));
    }
    this.seed = seed;
    if (location.hash.slice(1) !== seed) history.replaceState(null, '', `${location.pathname}${location.search}#${seed}`);
    this.voxels?.dispose();
    this.bodies?.dispose();
    if (this.haze) {
      this.stage.scene.remove(this.haze.group);
      this.haze.dispose();
    }
    this.world = new World(seed, this.params);
    this.voxels = new Voxels(this.world.cells, this.theme);
    this.stage.scene.add(this.voxels.layer.mesh);
    this.bodies = new Bodies(this.world.society, this.stage.fog, this.theme);
    Object.assign(this.bodies.show, this.show);
    this.stage.scene.add(this.bodies.group);
    // Murky water shows as a haze; a world with the same water everywhere has none.
    this.haze = new Haze(this.world.society, this.theme);
    this.stage.scene.add(this.haze.group);
    this.acc = 0;
    this.seenEvents = 0;
    this.realmsSeen = 0;
    this.seenSamples = 0;
    this.seekTo = -1;
    this.slow = null;
    this.strikes = [];
    this.spotRoot = -1;
    this.spotMask = null;
    this.scheduled = [...strikes].sort((a, b) => a.tick - b.tick);
    this.writeStrikes();
    this.select(-1);
    this.lastCells = this.world.cells.version;
    this.hud.clearChronicle();
    this.hud.setSeed(seed);
    this.hud.setLabels([]);
    this.hud.push('gen 0', `${this.params.cells.lineages} lineages of cells, ${this.world.cells.population.toLocaleString()} alive.`, 'level');
    this.updateHud();
    for (const f of this.onStart) f();
  }

  /** True while a replay is running forward to the year the viewer asked for. */
  get seeking(): boolean {
    return this.seekTo >= 0;
  }

  /** Replay this world from its seed up to `tick`, with the strikes made before then. */
  seek(tick: number): void {
    const strikes = [...this.strikes, ...this.scheduled].filter((k) => k.tick < tick);
    this.start(this.seed, undefined, strikes);
    this.seekTo = Math.max(0, Math.round(tick));
  }

  /** Pick an organism (or -1 for none). The card, the camera and the lens all follow this. */
  select(slot: number): void {
    const s = this.world?.society;
    const ok = !!s && slot >= 0 && !!s.alive[slot];
    const next = ok ? slot : -1;
    if (next === this.selected && (!ok || s!.uid[slot] === this.selectedUid)) return;
    this.selected = next;
    this.selectedUid = ok ? s!.uid[slot] : 0;
    for (const f of this.onSelect) f();
  }

  /** The organism drawn nearest a point in CSS pixels, within `radius`, or -1. */
  pickAt(x: number, y: number, radius: number): number {
    const b = this.bodies;
    if (!b) return -1;
    const c = this.stage.renderer.domElement;
    b.project(this.stage.camera, c.clientWidth, c.clientHeight);
    return b.pick(x, y, radius);
  }

  /**
   * Remove an organism from outside the model. The strike is remembered with its tick and goes
   * into the link, so a shared link replays the same history.
   */
  strike(slot: number): boolean {
    const s = this.world.society;
    if (slot < 0 || !s.alive[slot]) return false;
    const uid = s.uid[slot];
    if (!s.strike(slot)) return false;
    this.strikes.push({ tick: this.world.tick, uid });
    this.writeStrikes();
    return true;
  }

  private writeStrikes(): void {
    const all = [...this.strikes, ...this.scheduled];
    writeQuery('k', all.length ? all.map((k) => `${k.tick}.${k.uid}`).join('_') : null);
  }

  /** Apply a link's strikes that fall on the tick about to run. */
  private applyScheduled(): void {
    const w = this.world;
    while (this.scheduled.length && this.scheduled[0].tick <= w.tick) {
      const k = this.scheduled.shift()!;
      const s = w.society;
      let slot = -1;
      for (let i = 0; i < s.M; i++) {
        if (s.alive[i] && s.uid[i] === k.uid) {
          slot = i;
          break;
        }
      }
      if (k.tick === w.tick && s.strike(slot)) this.strikes.push(k);
    }
  }

  private stepOnce(): void {
    if (this.scheduled.length) this.applyScheduled();
    this.world.step();
    const n = this.world.society.history.length;
    if (n !== this.seenSamples) {
      this.seenSamples = n;
      for (const f of this.onSurvey) f();
    }
  }

  run(): void {
    this.last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.stage.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /** Advance by `seconds` of wall time at 60 fps, then draw one frame (dev and capture tooling). */
  advance(seconds: number): { year: number; levels: number[]; organisms: number } {
    const frames = Math.round(seconds * 60);
    for (let f = 0; f < frames; f++) this.update(1 / 60);
    this.stage.render();
    const s = this.world.society;
    return { year: Math.floor(this.world.tick / TICKS_PER_YEAR), levels: [...s.levels], organisms: s.count };
  }

  /** The environment overrides the next start() or new world will use. */
  getOverrides(): Overrides {
    return this.overrides;
  }

  /** Remember overrides for the next start() or new world, without restarting this one. */
  setOverrides(overrides: Overrides): void {
    this.overrides = overrides;
    this.params = withOverrides(overrides);
  }

  /** Show or hide one layer of the world: command lines, ruler rings or the food stipple. */
  setShow(layer: keyof App['show'], on: boolean): void {
    this.show[layer] = on;
    if (this.bodies) this.bodies.show[layer] = on;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.stage.setTheme(theme);
    this.voxels?.setTheme(theme);
    this.bodies?.setTheme(theme);
    this.haze?.setTheme(theme);
    this.hud.setTheme(theme);
  }

  togglePause(): void {
    this.paused = !this.paused;
    this.hud.setPaused(this.paused);
  }

  setSpeed(n: number): void {
    this.speed = n;
    this.hud.setSpeed(n);
  }

  newWorld(): void {
    this.start(randomSeed());
  }

  private update(dt: number): void {
    const w = this.world;
    if (this.seekTo >= 0) {
      // A replay: step as fast as the frame allows until the world reaches the year asked for.
      const until = performance.now() + SEEK_BUDGET;
      while (w.tick < this.seekTo && performance.now() < until) this.stepOnce();
      if (w.tick >= this.seekTo) this.seekTo = -1;
      this.acc = 0;
    } else {
      const run = this.paused ? 0 : dt * (this.slow ?? this.speed);
      this.acc += run * TICKS_PER_SECOND;
      let n = 0;
      while (this.acc >= 1 && n < 24) {
        this.stepOnce();
        this.acc -= 1;
        n++;
      }
      if (n === 24) this.acc = Math.min(this.acc, 1);
    }
    const alpha = Math.min(1, this.acc);
    const sel = this.selected;
    if (sel >= 0 && (!w.society.alive[sel] || w.society.uid[sel] !== this.selectedUid)) this.select(-1);

    if (this.voxels) {
      if (w.cells.version !== this.lastCells) {
        this.lastCells = w.cells.version;
        this.voxels.sync(w.cells);
      }
      // Between generations, cells grow in and shrink away; once the lattice ends, its last cells
      // shrink away more slowly and the layer empties.
      const t = w.latticeActive
        ? Math.min(1, (w.tick - w.lastGenTick + alpha) / w.params.ticksPerGen)
        : Math.min(1, (w.tick - w.latticeEndTick + alpha) / DISSOLVE_TICKS);
      if (!w.latticeActive && t >= 1) this.voxels.clear();
      else this.voxels.animate(t);
      this.voxels.layer.setFog(this.stage.fog.near, this.stage.fog.far);
    }
    const c = this.stage.renderer.domElement;
    // The spotlight: a watch's orphans first, then a hovered realm, then the picked organism's realm.
    const b = this.bodies!;
    const soc = w.society;
    b.spotMask = this.spotMask;
    const hovered = this.spotRoot >= 0 && soc.alive[this.spotRoot];
    b.spotRoot = hovered ? this.spotRoot : this.selected >= 0 ? soc.rootOf(this.selected) : -1;
    b.spotDim = this.spotMask ? 0.7 : hovered ? 0.8 : 0.55;
    this.bodies!.setViewport(c.clientWidth, c.clientHeight);
    this.bodies!.update(alpha, this.stage.pixelScale, this.stage.renderer.getPixelRatio());
    this.drainEvents();
    this.updateOverlay();
    this.updateHud();
    for (const f of this.onFrame) f(dt);
  }

  private drainEvents(): void {
    const s = this.world.society;
    for (; this.realmsSeen < s.realms.length; this.realmsSeen++) {
      const r = s.realms[this.realmsSeen];
      this.hud.rememberRealm(r.name, r.tribe);
    }
    const fresh = s.emitted - this.seenEvents;
    if (fresh <= 0) return;
    for (const e of s.events.slice(-Math.min(fresh, 5))) this.hud.push(`year ${Math.floor(e.tick / TICKS_PER_YEAR)}`, e.text, e.kind);
    if (this.seekTo < 0) for (const e of s.events.slice(-Math.min(fresh, s.events.length))) for (const f of this.onEvent) f(e);
    this.seenEvents = s.emitted;
  }

  private updateOverlay(): void {
    const s = this.world.society;
    const b = this.bodies!;
    const canvas = this.stage.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cam = this.stage.camera;
    const realms = s.standingRealms().filter((r) => r.notable).slice(0, w < 720 ? 2 : 4);
    const placed: { x: number; y: number; w: number }[] = [];
    this.hud.setLabels(
      realms.map((r) => {
        const v = b.positionOf(r.sovereign, this.tmp).project(cam);
        const x = (v.x * 0.5 + 0.5) * w;
        const y = (-v.y * 0.5 + 0.5) * h - 14;
        const width = (r.name.length + String(r.size).length + 3) * 7.5;
        const clash = placed.some((q) => Math.abs(q.x - x) < (q.w + width) / 2 + 6 && Math.abs(q.y - y) < 18);
        if (v.z > 1 || clash || !Number.isFinite(x)) return { x: NaN, y: NaN, name: r.name, size: r.size, tribe: r.tribe, slot: r.sovereign };
        placed.push({ x, y, w: width });
        return { x, y, name: r.name, size: r.size, tribe: r.tribe, slot: r.sovereign };
      }),
    );
    if (!this.pointer) {
      b.highlight(this.selected);
      this.hud.setTip(0, 0, null);
      return;
    }
    b.project(cam, w, h);
    const slot = b.pick(this.pointer.x, this.pointer.y, 14);
    b.highlight(slot >= 0 ? slot : this.selected);
    if (slot < 0 || slot === this.selected) {
      this.hud.setTip(0, 0, null);
      return;
    }
    const tribe = this.hud.tribeWord(s.tribe[slot]);
    const r = s.rootOf(slot);
    const realmId = s.realmOf[r];
    const realm = realmId >= 0 ? s.realms[realmId] : null;
    const below = s.subSize[slot] - 1;
    const age = Math.floor(s.age[slot] / TICKS_PER_YEAR);
    let role: string;
    if (s.lord[slot] < 0) role = realm ? `leads <b>${realm.name}</b>` : below > 0 ? 'leads a small group' : 'follows no one';
    else role = `rank ${s.depth[slot] + 1}${realm ? ` in <b>${realm.name}</b>` : ''}, follows a ${this.hud.tribeWord(s.tribe[s.lord[slot]])} leader`;
    const lines = [`${tribe} organism, ${s.mass[slot]} cells, age ${age}`, role, below > 0 ? `${below} below it, ${s.nChild[slot]} direct` : 'no followers', '<i>Click to see its choice</i>'];
    this.hud.setTip(this.pointer.x, this.pointer.y, lines.join('<br>'));
  }

  private updateHud(): void {
    const w = this.world;
    const s = w.society;
    const reached = s.levels.map((t, i) => (t < 0 ? null : i === 0 ? 'gen 0' : `year ${Math.floor(t / TICKS_PER_YEAR)}`));
    this.hud.setLadder(reached);
    const standing = s.standingRealms();
    const major = standing.filter((r) => r.size >= s.p.notableSize);
    const top = major[0];
    const ranks = Math.max(0, ...major.map((r) => r.depth)) + 1;
    const items: [string, string][] = [['Year', String(Math.floor(w.tick / TICKS_PER_YEAR))]];
    if (w.latticeActive && w.cells.population > 0) items.push(['Lattice cells', w.cells.population.toLocaleString()]);
    items.push(['Organisms', s.count.toLocaleString()]);
    if (s.count > 0) {
      items.push(['Groups', String(major.length)]);
      items.push(['Largest', top ? `${top.name} (${top.size})` : 'none']);
      items.push(['Deepest chain', `${ranks} rank${ranks === 1 ? '' : 's'}`]);
    }
    this.hud.setReadout(items);
  }
}

export function seedFromHash(): string | null {
  const h = decodeURIComponent(location.hash.slice(1)).trim();
  return /^[a-z0-9-]{1,32}$/i.test(h) ? h : null;
}

export { randomSeed, TRIBE_NAMES };
