// The app: runs Cells until its forms hold, lifts the forms into organisms, then runs the
// Society, and keeps the ladder, chronicle and readouts in step with the simulation.

import * as THREE from 'three';
import { Stage } from './render/stage.ts';
import { Voxels } from './render/voxels.ts';
import { Bodies } from './render/bodies.ts';
import { CellsWorld } from './sim/cells.ts';
import { Society } from './sim/society.ts';
import { foundersFrom, withOverrides, LADDER, type WorldParams } from './sim/world.ts';
import { makeRng, randomSeed } from './sim/rng.ts';
import { TRIBE_NAMES } from './sim/names.ts';
import { Hud, type Step } from './ui/hud.ts';

type Phase = 'cells' | 'hold' | 'lift' | 'society';

const GENS_PER_SECOND = 4;
const TICKS_PER_SECOND = 60;
const TICKS_PER_YEAR = 100;
const HOLD_SECONDS = 1.1;
const LIFT_SECONDS = 1.9;

function steps(p: WorldParams): Step[] {
  const c = p.cells;
  const s = p.society;
  const list = (xs: number[]) => (xs.length === 2 ? `${xs[0]} or ${xs[1]}` : `${xs[0]} to ${xs[xs.length - 1]}`);
  return [
    { name: LADDER[0], rule: `A dead cell with ${list(c.birth)} live neighbours is born. A live cell with ${list(c.survive)} survives.`, done: `Reached when ${c.targetForms} forms hold their shape for ${c.holdGens} generations.` },
    { name: LADDER[1], rule: 'Each form that holds together becomes one body. Bodies eat, move, split and age.', done: 'Reached when the forms become bodies.' },
    { name: LADDER[2], rule: 'A newborn follows its parent. Kin bow to much stronger kin. A ring marks each chief.', done: `Reached when ${s.tribeCount} kin groups of ${s.tribeMin}+ follow chiefs.` },
    { name: LADDER[3], rule: "Winners take losers as followers, and tribute flows up. Followers hang below their lord on a line in the ruler's colour.", done: `Reached when a realm of ${s.hierSize}+ rules ${s.hierTribes} tribes through ${s.hierDepth + 1} ranks.` },
    { name: LADDER[4], rule: 'When a ruler dies, the strongest follower inherits. The others stay only if the heir is clearly stronger.', done: `Reached when a realm of ${s.govSize}+ outlives its ruler.` },
  ];
}

export class App {
  private stage: Stage;
  private hud: Hud;
  private params: WorldParams;
  private seed = '';
  private phase: Phase = 'cells';
  private cells!: CellsWorld;
  private voxels: Voxels | null = null;
  private society: Society | null = null;
  private bodies: Bodies | null = null;
  private phaseT = 0;
  private liftTargets = new Float32Array(0);
  private speed: number;
  private paused = false;
  private acc = 0;
  private last = 0;
  private seenEvents = 0;
  private cellsReachedGen = -1;
  private pointer: { x: number; y: number } | null = null;
  private tmp = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, opts: { overrides?: object; speed?: number; reducedMotion: boolean }) {
    this.params = withOverrides(opts.overrides as Parameters<typeof withOverrides>[0]);
    this.speed = opts.speed ?? (opts.reducedMotion ? 1 : 2);
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
      skip: () => this.skipCells(),
    });
    this.hud.setSpeed(this.speed);

    canvas.addEventListener('pointermove', (e) => (this.pointer = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerleave', () => (this.pointer = null));
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
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

  start(seed: string): void {
    this.seed = seed;
    if (location.hash.slice(1) !== seed) history.replaceState(null, '', `${location.pathname}${location.search}#${seed}`);
    this.voxels?.dispose();
    this.bodies?.dispose();
    this.voxels = null;
    this.bodies = null;
    this.society = null;
    this.cells = new CellsWorld(this.params.cells, makeRng(`${seed}:cells`));
    this.voxels = new Voxels(this.cells, this.stage.fog);
    this.stage.scene.add(this.voxels.mesh);
    this.phase = 'cells';
    this.phaseT = 0;
    this.acc = 0;
    this.seenEvents = 0;
    this.cellsReachedGen = -1;
    this.hud.clearChronicle();
    this.hud.setSeed(seed);
    this.hud.setSkippable(true);
    this.hud.setLabels([]);
    this.hud.push('gen 0', `${this.params.cells.lineages} lineages of cells, ${this.cells.population} alive.`, 'level');
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

  /** Advance the simulation by `seconds` of wall time at 60 fps, then draw one frame. */
  advance(seconds: number): { phase: Phase; year: number; levels: number[] } {
    const frames = Math.round(seconds * 60);
    for (let f = 0; f < frames; f++) this.update(1 / 60);
    this.stage.render();
    return { phase: this.phase, year: this.society ? Math.floor(this.society.tick / TICKS_PER_YEAR) : 0, levels: this.society?.levels ?? [] };
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.hud.setPaused(this.paused);
  }

  private setSpeed(n: number): void {
    this.speed = n;
    this.hud.setSpeed(n);
  }

  private newWorld(): void {
    this.start(randomSeed());
  }

  private skipCells(): void {
    if (this.phase !== 'cells' && this.phase !== 'hold') return;
    while (!this.cells.complete) this.cells.step();
    this.cells.scanForms();
    this.voxels!.sync(this.cells);
    this.beginLift();
  }

  private update(dt: number): void {
    const run = this.paused ? 0 : dt * this.speed;
    if (this.phase === 'cells') {
      this.acc += run * GENS_PER_SECOND;
      let stepped = false;
      while (this.acc >= 1) {
        this.acc -= 1;
        this.cells.step();
        stepped = true;
        if (this.cells.complete) break;
      }
      if (stepped) this.voxels!.sync(this.cells);
      this.voxels!.animate(Math.min(1, this.acc));
      if (this.cells.complete) {
        this.cells.scanForms();
        this.voxels!.sync(this.cells);
        this.voxels!.animate(1);
        this.phase = 'hold';
        this.phaseT = 0;
        this.cellsReachedGen = this.cells.generation;
        this.hud.push(`gen ${this.cells.generation}`, `${this.cells.holding} forms hold their shape.`, 'level');
      }
      this.voxels!.updateFog();
    } else if (this.phase === 'hold') {
      this.phaseT += run / HOLD_SECONDS;
      this.voxels!.updateFog();
      if (this.phaseT >= 1) this.beginLift();
    } else if (this.phase === 'lift') {
      this.phaseT = Math.min(1, this.phaseT + Math.max(run, this.paused ? 0 : dt) / LIFT_SECONDS);
      this.voxels!.lift(this.cells, this.liftTargets, this.phaseT);
      this.voxels!.updateFog();
      const appear = Math.min(1, Math.max(0, (this.phaseT - 0.35) / 0.65));
      this.syncViewport();
      this.bodies!.update(0, appear, this.stage.pixelScale, this.stage.renderer.getPixelRatio());
      if (this.phaseT >= 1) {
        this.voxels!.dispose();
        this.voxels = null;
        this.phase = 'society';
        this.acc = 0;
      }
    } else {
      const s = this.society!;
      this.acc += run * TICKS_PER_SECOND;
      let steps = 0;
      while (this.acc >= 1 && steps < 24) {
        s.step();
        this.acc -= 1;
        steps++;
      }
      if (steps === 24) this.acc = Math.min(this.acc, 1);
      this.syncViewport();
      this.bodies!.update(Math.min(1, this.acc), 1, this.stage.pixelScale, this.stage.renderer.getPixelRatio());
      this.drainEvents();
      this.updateOverlay();
    }
    this.updateHud();
  }

  private syncViewport(): void {
    const c = this.stage.renderer.domElement;
    this.bodies?.setViewport(c.clientWidth, c.clientHeight);
  }

  private beginLift(): void {
    const founders = foundersFrom(this.cells);
    this.society = new Society(this.params.society, makeRng(`${this.seed}:society`), founders);
    this.society.levels[0] = 0;
    this.society.levels[1] = 0;
    this.bodies = new Bodies(this.society, this.stage.fog);
    this.stage.scene.add(this.bodies.group);
    this.liftTargets = new Float32Array(founders.length * 3);
    founders.forEach((f, k) => {
      this.liftTargets[3 * k] = Math.max(-0.95, Math.min(0.95, f.x));
      this.liftTargets[3 * k + 1] = Math.max(-0.95, Math.min(0.95, f.y));
      this.liftTargets[3 * k + 2] = Math.max(-0.95, Math.min(0.95, f.z));
    });
    if (this.cellsReachedGen < 0) this.cellsReachedGen = this.cells.generation;
    this.phase = 'lift';
    this.phaseT = 0;
    this.hud.setSkippable(false);
    this.hud.push('year 0', `The forms become ${founders.length} organisms.`, 'level');
  }

  private drainEvents(): void {
    const s = this.society!;
    for (const r of s.realms) this.hud.rememberRealm(r.name, r.tribe);
    const fresh = s.emitted - this.seenEvents;
    if (fresh <= 0) return;
    const list = s.events.slice(-Math.min(fresh, 5));
    for (const e of list) this.hud.push(`year ${Math.floor(e.tick / TICKS_PER_YEAR)}`, e.text, e.kind);
    this.seenEvents = s.emitted;
  }

  private updateOverlay(): void {
    const s = this.society!;
    const b = this.bodies!;
    const canvas = this.stage.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cam = this.stage.camera;
    const realms = s.standingRealms().filter((r) => r.notable).slice(0, w < 720 ? 2 : 4);
    // Largest realms first; drop a label that would overlap one already placed.
    const placed: { x: number; y: number; w: number }[] = [];
    this.hud.setLabels(
      realms.map((r) => {
        const v = b.positionOf(r.sovereign, this.tmp).project(cam);
        const x = (v.x * 0.5 + 0.5) * w;
        const y = (-v.y * 0.5 + 0.5) * h - 12;
        const width = (r.name.length + String(r.size).length + 1) * 7.5;
        const clash = placed.some((q) => Math.abs(q.x - x) < (q.w + width) / 2 + 6 && Math.abs(q.y - y) < 18);
        if (v.z > 1 || clash || !Number.isFinite(x)) return { x: NaN, y: NaN, name: r.name, size: r.size, tribe: r.tribe };
        placed.push({ x, y, w: width });
        return { x, y, name: r.name, size: r.size, tribe: r.tribe };
      }),
    );
    b.setViewport(w, h);
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
    const lines = [`${tribe} organism, age ${age}`, role, below > 0 ? `${below} below it, ${s.nChild[slot]} direct` : 'no followers'];
    this.hud.setTip(this.pointer.x, this.pointer.y, lines.join('<br>'));
  }

  private updateHud(): void {
    const s = this.society;
    const reached: (string | null)[] = [null, null, null, null, null];
    if (this.cellsReachedGen >= 0) reached[0] = `gen ${this.cellsReachedGen}`;
    if (s) {
      reached[1] = 'year 0';
      for (let i = 2; i < 5; i++) if (s.levels[i] >= 0) reached[i] = `year ${Math.floor(s.levels[i] / TICKS_PER_YEAR)}`;
    }
    this.hud.setLadder(reached);
    if (!s || this.phase !== 'society') {
      this.hud.setReadout([
        ['Generation', String(this.cells.generation)],
        ['Live cells', this.cells.population.toLocaleString()],
        ['Forms holding', `${this.cells.holding} / ${this.params.cells.targetForms}`],
      ]);
      return;
    }
    const standing = s.standingRealms();
    const major = standing.filter((r) => r.size >= s.p.notableSize);
    const top = major[0];
    this.hud.setReadout([
      ['Year', String(Math.floor(s.tick / TICKS_PER_YEAR))],
      ['Organisms', s.count.toLocaleString()],
      ['Realms', String(major.length)],
      ['Largest', top ? `${top.name} ${top.size}` : 'none'],
      ['Deepest chain', `${Math.max(0, ...major.map((r) => r.depth)) + 1} ranks`],
    ]);
  }
}

export function seedFromHash(): string | null {
  const h = decodeURIComponent(location.hash.slice(1)).trim();
  return /^[a-z0-9-]{1,32}$/i.test(h) ? h : null;
}

export { randomSeed, TRIBE_NAMES };
