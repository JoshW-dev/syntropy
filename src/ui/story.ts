// The narrator. It says in one caption what just happened and why no rule asked for it, points the
// guided camera at it, and runs the succession watch: when a realm loses its ruler, time slows, a
// meter shows how much of the realm has regrouped under one new ruler, and the caption reports the
// result. The captions describe what the simulation measured; they change nothing in it.

import * as THREE from 'three';
import { TICKS_PER_YEAR, type App } from '../app.ts';
import { CLEAR, CLEAREST, HALF_POOR, HALF_RICH, MURKY, type SimEvent, type SuccessionWatch } from '../sim/society.ts';
import { lasting } from '../sim/score.ts';
import type { Director } from './director.ts';

interface Caption {
  kicker: string;
  /** The text, or a function that writes it when the caption's turn comes, so its numbers are current. */
  body: string | (() => string);
  seconds: number;
  /** High captions wait their turn; low ones are dropped when the narrator is busy. */
  high: boolean;
  /**
   * A caption about a moment that passes (the climate's fall and recovery). While one waits, the
   * caption on screen wraps up and no new succession watch starts. Once it shows it keeps the box
   * from a watch for HOLD ms, and it leaves as soon as `fresh` turns false, so it never says "now"
   * about a moment that is over. Without this a fast world never lets it through.
   */
  urgent?: boolean;
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
/** A caption wraps up this long after something more important arrives (ms). */
const WRAP_UP = 2500;
/** An urgent caption keeps the box from a succession watch for this long (ms). */
const HOLD = 7000;
/**
 * In a world with a climate cycle, the first fall is told once food is under its usual amount and
 * this share of the most organisms seen is gone. A world that never held FALL_MIN has no fall to tell.
 */
const FALL_SHARE = 0.15;
const FALL_MIN = 60;
/** The first recovery is told once this many groups of 15 or more have formed since the low. */
const RISE_GROUPS = 2;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export class Story {
  /** The viewer's setting: captions on or off. A watch the viewer caused always shows. */
  captions = true;
  /** Opens the world's history; set by main. */
  onHistory: () => void = () => undefined;
  /** Opens the panel that shows this world's measurements; set by main. */
  onMeasure: () => void = () => undefined;
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
  /** Until this time (ms) the caption on screen keeps the box from a watch the viewer did not cause. */
  private heldUntil = 0;
  /** For an urgent caption on screen: false once the moment it describes is over. */
  private live: (() => boolean) | null = null;
  private lastLow = 0;
  private watch: { realm: number; viewer: boolean; name: string; tribe: number; members: number } | null = null;
  private struck = new Set<number>();
  private opened = false;
  private sawFollower = false;
  /** The climate cycle so far: the most organisms seen, the fewest since the fall, and what was told. */
  private cycle = { peak: 0, low: 0, lowTick: 0, fallFrom: 0, fell: false, rose: false };
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
    this.cycle = { peak: 0, low: 0, lowTick: 0, fallFrom: 0, fell: false, rose: false };
    this.heldUntil = 0;
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
      this.until = Math.min(this.until, now + WRAP_UP);
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
          body: `${rest} No rule mentions tribes or leaders. Kin threaten each other less and pay each other less tax, so kin are the first to group.`,
        });
      } else if (e.level === 3) {
        this.say({
          kicker: 'Hierarchy', high: true, seconds: 10, aim, fresh: () => s.levels[4] < 0,
          body: `${rest} No rule mentions ranks. A leader that chooses to follow another leader brings its followers along, and that makes a rank.`,
        });
      } else if (e.level === 4 && !(this.watch && aim && s.realmOf[aim.slot] === this.watch.realm)) {
        this.say({
          kicker: 'Government', high: true, seconds: 11, aim,
          body: `${rest} The group is now more than its leader. No rule names an heir: the members chose again, and most chose alike.`,
          action: { label: "See this world's history", run: () => this.onHistory() },
        });
      }
      return;
    }
    if (e.kind === 'conquest') {
      this.say({ kicker: 'A takeover', high: false, seconds: 8, aim, body: `${rest} No rule says take over. Its leader lost a fight, and then chose to follow the winner.` });
    } else if (e.kind === 'join') {
      this.say({ kicker: 'Two groups merge', high: false, seconds: 8, aim, body: `${rest} Nobody forced it. For its leader, following now scores higher than standing alone.` });
    } else if (e.kind === 'rebellion') {
      this.say({ kicker: 'A split', high: false, seconds: 8, aim, body: `${rest} No rule says split. For the one they follow, standing alone now scores higher than paying tax, and its followers come along.` });
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
        // A viewer who changed the climate, the water or the food has seen the opening line, so that
        // change takes its place. A water comes with its own food capacity, so it speaks for both.
        this.say(
          this.climateCaption() ?? this.waterCaption() ?? this.foodCaption() ?? {
            kicker: 'One rule is running', high: true, seconds: 9,
            body: `Each cell counts its 26 neighbours. A dead cell with ${list(c.birth)} live neighbours is born, and a live cell with ${list(c.survive)} survives. Nothing in this rule mentions an organism.`,
          },
        );
      }
    }
    if (!this.sawFollower && s.stats.joins > 0 && !app.seeking) {
      this.sawFollower = true;
      let f = -1;
      for (let i = 0; i < s.M && f < 0; i++) if (s.alive[i] && s.lord[i] >= 0) f = i;
      if (f >= 0 && app.world.tick < 40 * TICKS_PER_YEAR && s.levels[2] < 0) {
        this.say({
          kicker: 'The first follower', high: true, seconds: 11, aim: { slot: f, uid: s.uid[f] }, dist: 4.3, fresh: () => s.levels[2] < 0,
          body: `One organism now follows another. It passes ${pct(s.p.tribute)} of its income to its leader as tax, and counts its leader's mass as protection. Every organism makes this one choice, again and again. It is the only social rule.`,
        });
      }
    }
    this.climateWatch();
    this.pollWatch();
    if (this.watch) return;
    // An urgent caption is waiting: whatever is on screen, a watch's result included, wraps up,
    // and sooner in a fast world, where the moment passes in a few seconds.
    if (this.showing && this.queue.some((c) => c.urgent)) this.until = Math.min(this.until, now + WRAP_UP / Math.max(1, app.speed / 2));
    if (this.showing && (now >= this.until || (this.live && !this.live()))) this.hide();
    while (!this.showing && this.queue.length) {
      const next = this.queue.shift()!;
      const age = now - (next.born ?? now);
      if (next.fresh && !next.fresh()) continue;
      if (age < STALE || (!this.queue.length && age < 2.5 * STALE)) this.show(next);
    }
  }

  /** What this world's climate changes, or null for the steady climate the paper measured. */
  private climateCaption(): Caption | null {
    const { climateSwing: swing, climatePeriod: period } = this.app.world.params.society;
    if (!(swing > 0)) return null;
    return {
      kicker: 'Food rises and falls', high: true, seconds: 12,
      body: `The food the water can hold swings between ${pct(1 - swing)} and ${pct(1 + swing)} of the usual in this world, and one cycle takes ${Math.round(period / TICKS_PER_YEAR)} years. The climate changes one thing: how much food grows back. No rule names a collapse or a recovery. The Food dial shows where the cycle is.`,
      action: { label: 'See the measurements', run: () => this.onMeasure() },
    };
  }

  /**
   * The first fall and the first recovery of a world whose food rises and falls. Each is told when
   * it shows in the count of organisms and groups, so the caption reports what was measured.
   */
  private climateWatch(): void {
    const s = this.app.world.society;
    const c = this.cycle;
    if (!s.climateOn || c.rose) return;
    const k = s.climateAt();
    const period = s.p.climatePeriod;
    if (s.count > c.peak) c.peak = s.count;
    if (!c.fell) {
      if (!(k < 1 && c.peak >= FALL_MIN && s.count <= (1 - FALL_SHARE) * c.peak)) return;
      c.fell = true;
      c.low = s.count;
      c.lowTick = s.tick;
      // Food fell through its usual amount at the middle of this cycle. Groups are counted from then.
      c.fallFrom = Math.floor(s.tick / period) * period + period / 2;
      const peak = c.peak;
      this.say({
        kicker: 'Food is falling', high: true, urgent: true, seconds: 12,
        // Told only while the water still holds less than usual.
        fresh: () => s.climateAt() < 1,
        body: () => {
          const turn = s.climateRising() ? 'it has started to rise again' : 'it is still falling';
          return `The water now holds ${pct(s.climateAt())} of its usual food, and ${turn}. ${s.count} organisms are alive, down from ${peak}. Crowding falls with them. Each organism sees fewer others, so a leader's protection is worth less than its tax, and groups thin out. No rule names a collapse.`;
        },
      });
      return;
    }
    if (s.count <= c.low) {
      c.low = s.count;
      c.lowTick = s.tick;
    }
    if (k < 1) return;
    // Groups of 15 or more that formed after the low, largest first.
    const fresh = () => s.standingRealms().filter((r) => r.size >= s.p.notableSize && r.founded > c.lowTick);
    const first = fresh();
    if (first.length < RISE_GROUPS) return;
    c.rose = true;
    const low = c.low;
    const from = c.fallFrom;
    this.say({
      kicker: 'Food is back', high: true, urgent: true, seconds: 13, aim: { slot: first[0].sovereign, uid: s.uid[first[0].sovereign] },
      fresh: () => s.climateAt() >= 1 && fresh().length > 0,
      body: () => {
        const groups = fresh();
        const names = groups.slice(0, 2).map((r) => `<b style="color:var(--t${r.tribe})">${r.name}</b>`).join(' and ');
        const kept = lasting(s, from, s.tick);
        const old = kept.standing > 0 ? ` Of the ${kept.standing} group${kept.standing === 1 ? '' : 's'} that stood in year ${Math.floor(from / TICKS_PER_YEAR)}, ${kept.lasted} still stand${kept.lasted === 1 ? 's' : ''}.` : '';
        return `The water holds ${pct(s.climateAt())} of its usual food, and ${s.count} organisms are alive, up from ${low} at the low. Each one sees more others again, so they group again. ${names} ${groups.length === 1 ? 'is a new group, with a new name' : 'are new groups, with new names'}.${old} No rule names a recovery.`;
      },
      action: { label: "See this world's history", run: () => this.onHistory() },
    });
  }

  /** What this world's water changes, or null for the water the paper measured. */
  private waterCaption(): Caption | null {
    const water = this.app.world.params.society.waterMap;
    if (water === 'even') return null;
    const times = (v: number) => `${+v.toFixed(2)} times as far as usual`;
    const ratio = `${+(MURKY / CLEAR).toFixed(2)} times as far as one`;
    const two = 'The panel measures the two waters side by side.';
    const [kicker, first, last] = {
      clear: ['Clear water', `The water in this world is clear, so every organism sees ${times(CLEAREST)}.`, 'Watch how deep the groups grow.'],
      murky: ['Murky water', `The water in this world is murky, so every organism sees ${times(MURKY)}.`, 'Watch how few organisms end up in groups.'],
      halves: ['Murky water beside clear', `Half of this world is murky and half is clear. An organism in the murk sees ${ratio} in the clear.`, two],
      pockets: ['Pockets of murk', `Three balls of murky water sit in this clear world. An organism inside one sees ${ratio} outside.`, two],
    }[water];
    return {
      kicker, high: true, seconds: 12,
      body: `${first} Sight changes one thing: how many others an organism can weigh when it chooses whom to follow. No rule names the murk, a border or a refuge. ${last}`,
      action: { label: 'See the measurements', run: () => this.onMeasure() },
    };
  }

  /** What this world's food map changes, or null for the map and amount the paper measured. */
  private foodCaption(): Caption | null {
    const { foodMap, foodCapacity } = this.app.world.params.society;
    if (foodMap === 'zones' && foodCapacity === 1) return null;
    const amount = `${+foodCapacity.toFixed(2)} times the usual food`;
    const where = 'The map changes one thing: where food grows.';
    const [kicker, first, what] = {
      zones: [foodCapacity > 1 ? 'More food' : 'Less food', `This world holds ${amount}, in the same six zones.`, 'That changes one thing: how many organisms the water can feed.'],
      plain: ['Food spread evenly', 'The food in this world is spread evenly through the water.', where],
      islands: ['Food on six islands', 'The food in this world sits on six tight islands, with almost bare water between them.', where],
      halves: ['A rich half and a poor half', `One half of this world holds ${+(HALF_RICH / HALF_POOR).toFixed(1)} times the food of the other.`, where],
    }[foodMap];
    return {
      kicker, high: true, seconds: 12,
      body: `${first} ${what} That sets how many others each organism can see. No rule names a crowd, a border or a group, and the choice of whom to follow never reads food. Watch how many organisms end up in groups.`,
      action: { label: 'See the measurements', run: () => this.onMeasure() },
    };
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
    // An urgent caption that is waiting or has just come up keeps the box. A watch the viewer caused
    // always shows.
    if (!viewer && (performance.now() < this.heldUntil || this.queue.some((c) => c.urgent))) return;
    this.watch = { realm: w.realm, viewer, name: w.name, tribe: w.tribe, members: w.members };
    this.queue = this.queue.filter((c) => c.high);
    const name = `<b style="color:var(--t${w.tribe})">${w.name}</b>`;
    const years = +(s.p.govWindow / TICKS_PER_YEAR).toFixed(1);
    this.paint(
      `${name} has no leader`,
      `${viewer ? 'You removed it.' : 'Its leader died.'} Nobody inherits. Each of its ${w.members} members now chooses again, by the same rule as always. If ${pct(s.p.govKeep)} regroup under one new leader within ${years} years, the group has outlived its leader.`,
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
    this.readA.textContent = `${pct(w.keep)} under one leader`;
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
          ? `${keep} of its ${rec.members} members regrouped under one new leader. The group outlived its leader, which is this model's test for government. No rule names an heir: they chose again, and most chose alike.`
          : `${keep} of its ${rec.members} members regrouped under one new leader. The ladder counts this as government only for a group of ${s.p.govSize} or more.`,
        action: first ? { label: "See this world's history", run: () => this.onHistory() } : undefined,
      });
    } else if (rec.keep >= s.p.govKeep) {
      this.show({ kicker: `${name} is absorbed`, high: true, seconds: 9, body: `${keep} regrouped, but under a leader that already heads another group. The model counts that as absorption, so the group ends.` });
    } else {
      this.show({
        kicker: `${name} breaks apart`, high: true, seconds: 10,
        body: `The largest piece kept ${keep}, below the ${line} line. Each member weighed the neighbours it could see. They saw different neighbours, so they chose different leaders.`,
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
    this.heldUntil = 0;
    this.live = null;
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
    this.paint(c.kicker, typeof c.body === 'function' ? c.body() : c.body);
    this.until = performance.now() + c.seconds * 1000;
    if (c.urgent) {
      this.heldUntil = performance.now() + HOLD;
      this.live = c.fresh ?? null;
    }
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
