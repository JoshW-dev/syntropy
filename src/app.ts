// The app: one continuous world. The lattice runs from the first frame, forms that hold come loose
// as organisms one at a time, and the society grows out of them. The ladder, chronicle and readouts
// only report what the simulation measured.

import * as THREE from 'three';
import { Stage } from './render/stage.ts';
import { Voxels } from './render/voxels.ts';
import { Bodies } from './render/bodies.ts';
import { PAPER, type Theme } from './render/theme.ts';
import { World, withOverrides, LADDER, type WorldParams, type Overrides } from './sim/world.ts';
import { randomSeed } from './sim/rng.ts';
import { TRIBE_NAMES } from './sim/names.ts';
import { Hud, type Step } from './ui/hud.ts';

const TICKS_PER_SECOND = 60;
export const TICKS_PER_YEAR = 100;

function steps(p: WorldParams): Step[] {
  const c = p.cells;
  const s = p.society;
  const list = (xs: number[]) => (xs.length === 2 ? `${xs[0]} or ${xs[1]}` : `${xs[0]} to ${xs[xs.length - 1]}`);
  return [
    { name: LADDER[0], rule: `A dead cell with ${list(c.birth)} live neighbours is born. A live cell with ${list(c.survive)} survives.`, done: 'The lattice starts alive.' },
    { name: LADDER[1], rule: `A form that keeps its shape for ${c.holdGens} generations comes loose as one body. Bodies eat, grow a cell on surplus, burn one when starving, and split at ${s.splitMass} cells.`, done: 'Reached when the first form comes loose.' },
    { name: LADDER[2], rule: 'Each organism follows whoever keeps it safest, net of the tribute it would pay. Kin tax each other less. A ring marks a chief.', done: `Reached when ${s.tribeCount} groups of ${s.tribeMin}+, mostly kin, follow one chief.` },
    { name: LADDER[3], rule: "Losers of fights lose cells to the winner, and tribute flows up every chain. Followers hang below their lord on a line in the ruler's colour.", done: `Reached when a realm of ${s.hierSize}+ rules other tribes through ${s.hierDepth + 1} ranks.` },
    { name: LADDER[4], rule: 'Nobody inherits anything. When a ruler dies, every follower chooses again.', done: `Reached when ${Math.round(s.govKeep * 100)}% of a realm of ${s.govSize}+ regroup under one new ruler.` },
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
  private speed: number;
  private paused = false;
  private acc = 0;
  private last = 0;
  private seenEvents = 0;
  private realmsSeen = 0;
  private lastGen = -1;
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

    canvas.addEventListener('pointermove', (e) => (this.pointer = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerleave', () => (this.pointer = null));
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

  /** Start (or restart) a world. `overrides` replaces the environment settings when given. */
  start(seed: string, overrides?: Overrides): void {
    if (overrides) {
      this.overrides = overrides;
      this.params = withOverrides(overrides);
      this.hud.setSteps(steps(this.params));
    }
    this.seed = seed;
    if (location.hash.slice(1) !== seed) history.replaceState(null, '', `${location.pathname}${location.search}#${seed}`);
    this.voxels?.dispose();
    this.bodies?.dispose();
    this.world = new World(seed, this.params);
    this.voxels = new Voxels(this.world.cells, this.theme);
    this.stage.scene.add(this.voxels.layer.mesh);
    this.bodies = new Bodies(this.world.society, this.stage.fog, this.theme);
    Object.assign(this.bodies.show, this.show);
    this.stage.scene.add(this.bodies.group);
    this.acc = 0;
    this.seenEvents = 0;
    this.realmsSeen = 0;
    this.lastGen = this.world.cells.generation;
    this.hud.clearChronicle();
    this.hud.setSeed(seed);
    this.hud.setLabels([]);
    this.hud.push('gen 0', `${this.params.cells.lineages} lineages of cells, ${this.world.cells.population.toLocaleString()} alive.`, 'level');
    this.updateHud();
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
    const run = this.paused ? 0 : dt * this.speed;
    this.acc += run * TICKS_PER_SECOND;
    let n = 0;
    while (this.acc >= 1 && n < 24) {
      w.step();
      this.acc -= 1;
      n++;
    }
    if (n === 24) this.acc = Math.min(this.acc, 1);
    const alpha = Math.min(1, this.acc);

    if (this.voxels) {
      if (w.cells.generation !== this.lastGen) {
        this.lastGen = w.cells.generation;
        this.voxels.sync(w.cells);
      }
      const t = Math.min(1, (w.tick - w.lastGenTick + alpha) / w.params.ticksPerGen);
      this.voxels.animate(w.latticeActive ? t : 1);
      this.voxels.layer.setFog(this.stage.fog.near, this.stage.fog.far);
    }
    const c = this.stage.renderer.domElement;
    this.bodies!.setViewport(c.clientWidth, c.clientHeight);
    this.bodies!.update(alpha, this.stage.pixelScale, this.stage.renderer.getPixelRatio());
    this.drainEvents();
    this.updateOverlay();
    this.updateHud();
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
        const width = (r.name.length + String(r.size).length + 1) * 7.5;
        const clash = placed.some((q) => Math.abs(q.x - x) < (q.w + width) / 2 + 6 && Math.abs(q.y - y) < 18);
        if (v.z > 1 || clash || !Number.isFinite(x)) return { x: NaN, y: NaN, name: r.name, size: r.size, tribe: r.tribe };
        placed.push({ x, y, w: width });
        return { x, y, name: r.name, size: r.size, tribe: r.tribe };
      }),
    );
    if (!this.pointer) {
      b.highlight(-1);
      this.hud.setTip(0, 0, null);
      return;
    }
    b.project(cam, w, h);
    const slot = b.pick(this.pointer.x, this.pointer.y, 14);
    b.highlight(slot);
    if (slot < 0) {
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
    if (s.lord[slot] < 0) role = realm ? `rules <b>${realm.name}</b>` : below > 0 ? 'leads a small band' : 'answers to no one';
    else role = `rank ${s.depth[slot] + 1}${realm ? ` in <b>${realm.name}</b>` : ''}, serves a ${this.hud.tribeWord(s.tribe[s.lord[slot]])}`;
    const lines = [`${tribe} organism, ${s.mass[slot]} cells, age ${age}`, role, below > 0 ? `${below} below it, ${s.nChild[slot]} direct` : 'no followers'];
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
      items.push(['Realms', String(major.length)]);
      items.push(['Largest', top ? `${top.name} ${top.size}` : 'none']);
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
