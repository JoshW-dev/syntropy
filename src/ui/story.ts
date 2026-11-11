// The narrator. It says in one caption what just happened and why no rule asked for it, points the
// guided camera at it, and runs the succession watch: when a realm loses its ruler, time slows, a
// meter shows how much of the realm has regrouped under one new ruler, and the caption reports the
// result. The captions describe what the simulation measured; they change nothing in it.

import * as THREE from 'three';
import { TICKS_PER_YEAR, type App } from '../app.ts';
import type { SimEvent, SuccessionWatch } from '../sim/society.ts';
import type { Director } from './director.ts';

interface Caption {
  kicker: string;
  body: string;
  seconds: number;
  /** High captions wait their turn; low ones are dropped when the narrator is busy. */
  high: boolean;
  aim?: { slot: number; uid: number };
  dist?: number;
  action?: { label: string; run: () => void };
  /** When it was queued (ms). A caption that waited too long is old news and is dropped. */
  born?: number;
  /** Checked when its turn comes: false means the world has moved past it, so it is skipped. */
  fresh?: () => boolean;
}

/** Ticks per second during a succession watch (the usual 1x is 60). */
const SLOW = 0.35;
/** A queued caption older than this is dropped, unless it is the last one waiting (ms). */
const STALE = 16000;
/** Low captions keep at least this long apart (ms). */
const LOW_GAP = 22000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export class Story {
  /** The viewer's setting: captions on or off. A watch the viewer caused always shows. */
  captions = true;
  /** Opens the world's history; set by main. */
  onHistory: () => void = () => undefined;
  private app: App;
  private director: Director;
  private el = $<HTMLDivElement>('caption');
  private kEl = $<HTMLParagraphElement>('cap-k');
  private bEl = $<HTMLParagraphElement>('cap-b');
  private meter = $<HTMLDivElement>('meter');
  private fill = $<HTMLDivElement>('meter-fill');
  private mark = $<HTMLDivElement>('meter-mark');
  private readA = $<HTMLSpanElement>('meter-a');
  private readB = $<HTMLSpanElement>('meter-b');
  private act = $<HTMLButtonElement>('cap-act');
  private run: (() => void) | null = null;
  private queue: Caption[] = [];
  private showing = false;
  private until = 0;
  private lastLow = 0;
  private watch: { realm: number; viewer: boolean; name: string; tribe: number; members: number } | null = null;
  private struck = new Set<number>();
  private opened = false;
  private sawFollower = false;
  private tmp = new THREE.Vector3();
  private centre = new THREE.Vector3();
  private mask: Uint8Array | null = null;

  constructor(app: App, director: Director) {
    this.app = app;
    this.director = director;
    this.act.addEventListener('click', () => this.run?.());
    app.onStart.push(() => this.reset());
    app.onEvent.push((e) => this.onEvent(e));
    app.onFrame.push(() => this.frame());
  }

  /** Remove an organism for the viewer. If it ruled a realm, the watch that follows is theirs. */
  strike(slot: number): boolean {
    const s = this.app.world.society;
    if (slot < 0 || !s.alive[slot]) return false;
    const rid = s.lord[slot] < 0 ? s.realmOf[slot] : -1;
    if (!this.app.strike(slot)) return false;
    if (rid >= 0) this.struck.add(rid);
    return true;
  }

  /** Say something now, ahead of the queue (used for answers to the viewer). */
  tell(kicker: string, body: string, seconds = 7): void {
    if (this.watch) return;
    this.show({ kicker, body, seconds, high: true });
  }

  setCaptions(on: boolean): void {
    this.captions = on;
    if (!on && !this.watch) {
      this.queue = [];
      this.hide();
    }
  }

  private reset(): void {
    this.queue = [];
    this.watch = null;
    this.struck.clear();
    this.opened = false;
    this.sawFollower = false;
    this.lastLow = 0;
    this.app.slow = null;
    this.director.release(false);
    this.hide();
  }

  private say(c: Caption): void {
    if (!this.captions || this.app.seeking) return;
    const now = performance.now();
    if (!c.high) {
      if (this.showing || this.queue.length || this.watch || now - this.lastLow < LOW_GAP || this.app.speed > 4) return;
      this.lastLow = now;
    } else if (this.showing && !this.watch) {
      // Something more important happened: the caption on screen wraps up, so the story keeps pace
      // with a world that is running fast.
      this.until = Math.min(this.until, now + 2500);
    }
    c.born = now;
    this.queue.push(c);
  }

  private onEvent(e: SimEvent): void {
    const { app } = this;
    const s = app.world.society;
    const aim = e.slot !== undefined && e.uid !== undefined ? { slot: e.slot, uid: e.uid } : undefined;
    const rest = app.hud.colorize(e.text.replace(/^[A-Z][a-z]+: /, ''));
    if (e.kind === 'level') {
      if (e.level === 1) {
        this.say({
          kicker: 'The first organism', high: true, seconds: 10, aim, dist: 4.3, fresh: () => s.levels[2] < 0,
          body: `A form kept its shape for ${app.params.cells.holdGens} generations and came loose as one body, made of exactly those cells. The lattice rule only counts neighbours. It says nothing about forms or bodies.`,
        });
      } else if (e.level === 2) {
        this.say({
          kicker: 'Tribes', high: true, seconds: 10, aim: this.largestRuler(), fresh: () => s.levels[3] < 0,
          body: `${rest} No rule mentions tribes or chiefs. Kin threaten each other less and pay each other less tribute, so kin are the first to group.`,
        });
      } else if (e.level === 3) {
        this.say({
          kicker: 'Hierarchy', high: true, seconds: 10, aim, fresh: () => s.levels[4] < 0,
          body: `${rest} No rule mentions ranks. A chief that chooses to follow another chief brings its followers along, and that makes a rank.`,
        });
      } else if (e.level === 4 && !(this.watch && aim && s.realmOf[aim.slot] === this.watch.realm)) {
        this.say({
          kicker: 'Government', high: true, seconds: 11, aim,
          body: `${rest} The realm is now more than its ruler. No rule names an heir: the members chose again, and most chose alike.`,
          action: { label: "See this world's history", run: () => this.onHistory() },
        });
      }
      return;
    }
    if (e.kind === 'conquest') {
      this.say({ kicker: 'Conquest', high: false, seconds: 8, aim, body: `${rest} No rule says conquer. Its ruler lost a fight, and then chose the winner as its lord.` });
    } else if (e.kind === 'join') {
      this.say({ kicker: 'A realm submits', high: false, seconds: 8, aim, body: `${rest} Nobody forced it. For its ruler, following now scores higher than standing alone.` });
    } else if (e.kind === 'rebellion') {
      this.say({ kicker: 'Rebellion', high: false, seconds: 8, aim, body: `${rest} No rule says rebel. For their leader, standing alone now scores higher than paying tribute, and its followers come along.` });
    } else if (e.kind === 'life' && e.text.startsWith('The lattice')) {
      this.say({ kicker: 'The lattice ends', high: false, seconds: 8, body: `${rest} The organisms never read the lattice, so nothing they do changes.` });
    }
  }

  private frame(): void {
    const { app } = this;
    const s = app.world.society;
    const now = performance.now();
    if (!this.opened && !app.seeking) {
      this.opened = true;
      if (app.world.tick < 90) {
        const c = app.params.cells;
        const list = (xs: number[]) => (xs.length === 2 ? `${xs[0]} or ${xs[1]}` : `${xs[0]} to ${xs[xs.length - 1]}`);
        this.say({
          kicker: 'One rule is running', high: true, seconds: 9,
          body: `Each cell counts its 26 neighbours. A dead cell with ${list(c.birth)} live neighbours is born, and a live cell with ${list(c.survive)} survives. Nothing in this rule mentions an organism.`,
        });
      }
    }
    if (!this.sawFollower && s.stats.joins > 0 && !app.seeking) {
      this.sawFollower = true;
      let f = -1;
      for (let i = 0; i < s.M && f < 0; i++) if (s.alive[i] && s.lord[i] >= 0) f = i;
      if (f >= 0 && app.world.tick < 40 * TICKS_PER_YEAR && s.levels[2] < 0) {
        this.say({
          kicker: 'The first follower', high: true, seconds: 11, aim: { slot: f, uid: s.uid[f] }, dist: 4.3, fresh: () => s.levels[2] < 0,
          body: `One organism now follows another. It pays ${pct(s.p.tribute)} of its income as tribute and counts its lord's mass as protection. Every organism makes this one choice, again and again. It is the only social rule.`,
        });
      }
    }
    this.pollWatch();
    if (this.watch) return;
    if (this.showing && now >= this.until) this.hide();
    while (!this.showing && this.queue.length) {
      const next = this.queue.shift()!;
      const age = now - (next.born ?? now);
      if (next.fresh && !next.fresh()) continue;
      if (age < STALE || (!this.queue.length && age < 2.5 * STALE)) this.show(next);
    }
  }

  // ---------------------------------------------------------------- the succession watch

  private pollWatch(): void {
    const { app } = this;
    const s = app.world.society;
    const list = s.watching();
    if (this.watch) {
      const id = this.watch.realm;
      const w = list.find((x) => x.realm === id);
      if (w) this.paintMeter(w);
      else this.finishWatch();
      return;
    }
    if (app.seeking || !list.length) return;
    const w = list.find((x) => this.struck.has(x.realm)) ?? (this.captions ? list.find((x) => x.members >= s.p.govSize) : undefined);
    if (!w) return;
    const viewer = this.struck.has(w.realm);
    this.watch = { realm: w.realm, viewer, name: w.name, tribe: w.tribe, members: w.members };
    this.queue = this.queue.filter((c) => c.high);
    const name = `<b style="color:var(--t${w.tribe})">${w.name}</b>`;
    const years = +(s.p.govWindow / TICKS_PER_YEAR).toFixed(1);
    this.paint(
      `${name} has no ruler`,
      `${viewer ? 'You removed it.' : 'Its ruler died.'} Nobody inherits. Each of its ${w.members} members now chooses again, by the same rule as always. If ${pct(s.p.govKeep)} regroup under one new ruler within ${years} years, the realm has outlived its ruler.`,
    );
    this.mark.style.left = pct(s.p.govKeep);
    this.meter.hidden = false;
    this.paintMeter(w);
    if (viewer || this.director.enabled) app.slow = SLOW;
    this.director.look(() => this.centre, 4.5, Infinity, viewer);
  }

  private paintMeter(w: SuccessionWatch): void {
    this.centre.set(w.x, w.y, w.z);
    // Light the orphans, so the eye can follow where they go.
    const mask = (this.mask ??= new Uint8Array(this.app.world.society.M));
    mask.fill(0);
    for (const k of w.slots) mask[k] = 1;
    this.app.spotMask = mask;
    this.fill.style.width = pct(w.keep);
    this.fill.classList.toggle('over', w.keep >= this.app.world.society.p.govKeep);
    this.readA.textContent = `${pct(w.keep)} under one ruler`;
    const left = Math.max(0, w.due - this.app.world.tick) / TICKS_PER_YEAR;
    this.readB.textContent = `${left.toFixed(1)} years left`;
  }

  private finishWatch(): void {
    const { app } = this;
    const s = app.world.society;
    const w = this.watch!;
    this.watch = null;
    app.slow = null;
    app.spotMask = null;
    this.director.release(w.viewer);
    this.director.release(false);
    this.meter.hidden = true;
    const rec = [...s.successions].reverse().find((r) => r.realm === w.realm);
    if (!rec) {
      this.hide();
      return;
    }
    const name = `<b style="color:var(--t${w.tribe})">${w.name}</b>`;
    const keep = pct(rec.keep);
    const line = pct(s.p.govKeep);
    if (rec.survived) {
      const counts = rec.members >= s.p.govSize;
      const first = counts && s.levels[4] === rec.tick;
      this.show({
        kicker: first ? `Government: ${name} holds` : `${name} holds`, high: true, seconds: 11,
        body: counts
          ? `${keep} of its ${rec.members} members regrouped under one new ruler. The realm outlived its ruler, which is this model's test for government. No rule names an heir: they chose again, and most chose alike.`
          : `${keep} of its ${rec.members} members regrouped under one new ruler. The ladder counts this as government only for a realm of ${s.p.govSize} or more.`,
        action: first ? { label: "See this world's history", run: () => this.onHistory() } : undefined,
      });
    } else if (rec.keep >= s.p.govKeep) {
      this.show({ kicker: `${name} is absorbed`, high: true, seconds: 9, body: `${keep} regrouped, but under a ruler that already heads another realm. The model counts that as absorption, so the realm ends.` });
    } else {
      this.show({
        kicker: `${name} breaks apart`, high: true, seconds: 10,
        body: `The largest piece kept ${keep}, below the ${line} line. Each member weighed the neighbours it could see. They saw different neighbours, so they chose different lords.`,
      });
    }
  }

  // ---------------------------------------------------------------- drawing

  private largestRuler(): { slot: number; uid: number } | undefined {
    const s = this.app.world.society;
    const r = s.standingRealms()[0];
    return r ? { slot: r.sovereign, uid: s.uid[r.sovereign] } : undefined;
  }

  private paint(kicker: string, body: string): void {
    this.kEl.innerHTML = kicker;
    this.bEl.innerHTML = body;
    this.act.hidden = true;
    this.run = null;
    this.meter.hidden = true;
    this.el.hidden = false;
    // Restart the arrival animation.
    this.el.classList.remove('in');
    void this.el.offsetWidth;
    this.el.classList.add('in');
    this.showing = true;
  }

  private show(c: Caption): void {
    this.paint(c.kicker, c.body);
    this.until = performance.now() + c.seconds * 1000;
    if (c.action) {
      this.act.textContent = c.action.label;
      this.act.hidden = false;
      this.run = c.action.run;
    }
    const aim = c.aim;
    if (aim) {
      const s = this.app.world.society;
      this.director.look(
        () => (s.alive[aim.slot] && s.uid[aim.slot] === aim.uid && this.app.bodies ? this.app.bodies.positionOf(aim.slot, this.tmp) : null),
        c.dist ?? 4.7,
        c.seconds,
      );
    }
  }

  private hide(): void {
    this.el.hidden = true;
    this.showing = false;
  }
}
