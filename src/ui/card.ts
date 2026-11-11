// The card for one picked organism. It shows the single social rule at work in one body: every
// option the organism can see, the score of each with its terms, the one it holds, and the one it
// would take at its next choice. A lens on the world draws its perception radius and a line to each
// candidate lord. For a ruler it also offers the experiment the paper's government test describes:
// remove it, and watch whether the realm regroups.

import * as THREE from 'three';
import { succession } from '../../paper/data/summary.json';
import { TICKS_PER_YEAR, type App } from '../app.ts';
import type { Option } from '../sim/society.ts';
import type { Director } from './director.ts';
import type { Story } from './story.ts';

/** Seconds between repaints of the card's text; the lens follows every frame. */
const REPAINT = 0.25;
const SVG = 'http://www.w3.org/2000/svg';

const $ = <T extends Element>(id: string) => document.getElementById(id) as unknown as T;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export class Card {
  private app: App;
  private story: Story;
  private director: Director;
  private el = $<HTMLElement>('card');
  private head = $<HTMLDivElement>('card-head');
  private opts = $<HTMLDivElement>('card-opts');
  private rule = $<HTMLDivElement>('card-rule');
  private realm = $<HTMLParagraphElement>('card-realm');
  private chain = $<HTMLDivElement>('card-chain');
  private kids = $<HTMLDivElement>('card-kids');
  private log = $<HTMLDivElement>('card-log');
  private lens = $<SVGSVGElement>('lens');
  private me = $<SVGCircleElement>('lens-me');
  private sight = $<SVGCircleElement>('lens-sight');
  private linesEl = $<SVGGElement>('lens-lines');
  private lines: SVGLineElement[] = [];
  private options: Option[] = [];
  private current = 0;
  private since = 0;
  private slot = -1;
  private uid = 0;
  private removed = false;
  private lastLord = 0;
  private lastRealm = -1;
  private entries: string[] = [];
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();

  constructor(app: App, story: Story, director: Director) {
    this.app = app;
    this.story = story;
    this.director = director;
    $<HTMLButtonElement>('card-close').addEventListener('click', () => app.select(-1));
    $<HTMLButtonElement>('card-strike').addEventListener('click', () => {
      this.removed = true;
      story.strike(this.slot);
    });
    // Rows that name another organism pick it. Pointer-down, because the rows repaint as the world runs.
    this.el.addEventListener('pointerdown', (e) => {
      const hit = (e.target as Element).closest<HTMLElement>('[data-pick]');
      if (hit) app.select(Number(hit.dataset.pick));
    });
    app.onSelect.push(() => this.onSelect());
    app.onFrame.push((dt) => this.frame(dt));
  }

  get open(): boolean {
    return this.slot >= 0;
  }

  private onSelect(): void {
    const { app } = this;
    const s = app.world.society;
    const was = this.slot;
    if (was >= 0 && app.selected < 0 && !this.removed && !app.seeking && (!s.alive[was] || s.uid[was] !== this.uid) && app.world.tick > 0) {
      // It did not get closed: it died.
      this.story.tell('The organism died', `It lived ${Math.floor(s.age[was] / TICKS_PER_YEAR)} years. Anyone that followed it is choosing again.`, 6);
    }
    this.slot = app.selected;
    this.removed = false;
    if (this.slot < 0) {
      this.el.hidden = true;
      this.lens.style.display = 'none';
      this.director.release(true);
      document.documentElement.classList.remove('card-open');
      return;
    }
    this.uid = s.uid[this.slot];
    this.lastLord = s.lord[this.slot] >= 0 ? s.uid[s.lord[this.slot]] : 0;
    this.lastRealm = s.realmOf[this.slot];
    this.entries = [];
    this.since = REPAINT;
    this.el.hidden = false;
    this.lens.style.display = '';
    document.documentElement.classList.add('card-open');
    const slot = this.slot;
    this.director.look(() => (app.selected === slot && app.bodies ? app.bodies.positionOf(slot, this.a) : null), 4.4, Infinity, true);
    this.paint();
  }

  private frame(dt: number): void {
    if (this.slot < 0) return;
    this.since += dt;
    if (this.since >= REPAINT) {
      this.since = 0;
      this.paint();
    }
    this.drawLens();
  }

  // ---------------------------------------------------------------- the text

  private tribe(t: number): string {
    return this.app.hud.tribeWord(t);
  }

  private paint(): void {
    const { app } = this;
    const s = app.world.society;
    const i = this.slot;
    if (i < 0 || !s.alive[i]) return;
    const year = (t: number) => Math.floor(t / TICKS_PER_YEAR);
    const root = s.rootOf(i);
    const rid = s.realmOf[root];
    const realm = rid >= 0 ? s.realms[rid] : null;
    const realmName = realm ? `<b style="color:var(--t${realm.tribe})">${realm.name}</b>` : '';
    const below = s.subSize[i] - 1;
    let role: string;
    if (s.lord[i] < 0) role = realm ? `Leads ${realmName}, with ${below} below it.` : below > 0 ? `Leads a small group of ${below}.` : 'Follows no one.';
    else role = `Rank ${s.depth[i] + 1}${realm ? ` in ${realmName}` : ''}. It follows a ${this.tribe(s.tribe[s.lord[i]])} leader${below > 0 ? `, and ${below} follow it` : ''}.`;
    const origin = s.origin[i] === 1 ? `Came loose from the lattice in year ${year(s.born[i])}.` : `Born when its parent split, in year ${year(s.born[i])}.`;
    const n = s.switches[i];
    const changes = n === 0 ? 'It has kept its first choice.' : `It has changed its choice ${n} time${n === 1 ? '' : 's'}.`;
    this.head.innerHTML =
      `<p class="card-t">${this.tribe(s.tribe[i])} organism <span>${s.mass[i]} cells, age ${year(s.age[i])}</span></p>` +
      `<p class="card-s">${role}</p><p class="card-s dim">${origin} ${changes}</p>`;

    const ex = s.explain(i);
    if (ex) {
      this.options = ex.options;
      this.current = ex.current;
      const order = ex.options.map((_, q) => q).sort((x, y) => ex.options[y].u - ex.options[x].u);
      this.opts.innerHTML = order.map((q) => this.row(ex.options[q], q === ex.current, q === ex.best && ex.best !== ex.current)).join('');
    }

    // The chain of command above it, and its direct followers below: each one can be picked.
    const above: number[] = [];
    for (let k = s.lord[i], guard = 0; k >= 0 && guard < 64; k = s.lord[k], guard++) above.unshift(k);
    const link = (k: number) => `<span class="pick" data-pick="${k}">${s.lord[k] < 0 ? 'top leader' : `rank ${s.depth[k] + 1}`}</span>`;
    const shownAbove = above.length > 4 ? [link(above[0]), '…', ...above.slice(-2).map(link)] : above.map(link);
    const chain = above.length ? `${shownAbove.join(' › ')} › <b>this one</b>` : s.subSize[i] > 1 ? '<b>top leader</b>' : '';
    if (this.chain.innerHTML !== chain) this.chain.innerHTML = chain;
    const direct: number[] = [];
    for (let c = s.firstChild[i]; c >= 0; c = s.nextSib[c]) direct.push(c);
    direct.sort((x, y) => s.subSize[y] - s.subSize[x] || x - y);
    const kidRows = direct.slice(0, 5).map((k) => {
      const under = s.subSize[k] - 1;
      return `<div class="kid pick" data-pick="${k}"><i class="opt-dot" style="background:var(--t${s.tribe[k]})"></i><span>${this.tribe(s.tribe[k])}, ${s.mass[k]} cells</span><span class="kid-n">${under > 0 ? `leads ${under}` : ''}</span></div>`;
    });
    const kids = direct.length
      ? `<p class="pop-h">Its direct followers (${direct.length})</p>${kidRows.join('')}${direct.length > 5 ? `<p class="card-s dim">and ${direct.length - 5} more</p>` : ''}`
      : '';
    if (this.kids.innerHTML !== kids) this.kids.innerHTML = kids;

    const ruler = s.lord[i] < 0 && s.realmOf[i] >= 0;
    this.rule.hidden = !ruler;
    if (ruler) {
      const spread = s.cohesion(i);
      const bin = succession.bySpread.find((b) => spread >= b.lo && spread < b.hi);
      const odds =
        bin && bin.n >= 10
          ? `In the paper's 48 worlds, groups this compact outlived their leader ${pct(bin.rate)} of the time.`
          : spread >= 1.2
            ? "Almost no group in the paper's 48 worlds was spread this wide."
            : 'The paper found that compact groups outlive their leaders more often.';
      const html = `Its ${below} members sit ${spread.toFixed(2)} perception radii from their centre on average. ${odds}`;
      if (this.realm.innerHTML !== html) this.realm.innerHTML = html;
    }

    // The life log: what it did while the card was open.
    const lordUid = s.lord[i] >= 0 ? s.uid[s.lord[i]] : 0;
    if (lordUid !== this.lastLord) {
      this.lastLord = lordUid;
      this.entries.push(
        `<span>year ${year(s.tick)}</span> ${lordUid === 0 ? 'Left its leader. It follows no one.' : `Now follows a ${this.tribe(s.tribe[s.lord[i]])} leader${realm ? ` in ${realmName}` : ''}.`}`,
      );
    }
    if (s.realmOf[i] !== this.lastRealm) {
      this.lastRealm = s.realmOf[i];
      if (this.lastRealm >= 0) this.entries.push(`<span>year ${year(s.tick)}</span> Now leads ${realmName}.`);
    }
    const log = this.entries.slice(-3).map((e) => `<p>${e}</p>`).join('');
    if (this.log.innerHTML !== log) this.log.innerHTML = log;
  }

  private row(o: Option, current: boolean, better: boolean): string {
    const s = this.app.world.society;
    const score = Math.exp(o.u);
    let name: string;
    let dot: string;
    if (o.lord < 0) {
      name = 'Follow no one';
      dot = '<i class="opt-dot none"></i>';
    } else {
      const rid = s.realmOf[o.root];
      const t = s.tribe[o.root];
      const rank = s.depth[o.lord] + 2;
      const where = rid >= 0 ? `<b style="color:var(--t${s.realms[rid].tribe})">${s.realms[rid].name}</b>` : `a small ${this.tribe(t)} group`;
      const kin = s.tribe[o.lord] === s.tribe[this.slot] ? ', kin' : '';
      name = `Follow a ${this.tribe(s.tribe[o.lord])} leader in ${where} <span>rank ${rank}${kin}</span>`;
      dot = `<i class="opt-dot" style="background:var(--t${t})"></i>`;
    }
    const odds = o.allies / (o.allies + o.threat);
    const terms = [`<span title="Its side's share of the mass it can see: the odds of winning a fight here">odds ${pct(odds)}</span>`];
    if (o.tax < 0) terms.push(`<span title="Share of income left after tax">keeps ${pct(Math.exp(o.tax))}</span>`);
    if (o.rank > 0) terms.push(`<span title="Protection left after the ranks between it and the top leader">control ${pct(Math.exp(-o.rank))}</span>`);
    if (Math.abs(o.other) > 0.004) terms.push(`<span title="Distance to the leader, and a small bonus for keeping the current choice">ties ${Math.exp(-o.other).toFixed(2)}</span>`);
    const tag = current ? '<em>its choice now</em>' : better ? '<em class="next">scores higher: it would switch</em>' : '';
    return (
      `<div class="opt-row${current ? ' cur' : ''}">` +
      `<div class="opt-top">${dot}<span class="opt-name">${name}</span><span class="opt-score">${score.toFixed(2)}</span></div>` +
      `<div class="opt-bar"><i style="width:${Math.min(100, score * 100).toFixed(1)}%"></i></div>` +
      `<div class="opt-why">${terms.join(' × ')}${tag}</div></div>`
    );
  }

  // ---------------------------------------------------------------- the lens on the world

  private drawLens(): void {
    const { app } = this;
    const b = app.bodies;
    const s = app.world.society;
    if (!b || this.slot < 0) return;
    const canvas = app.stage.renderer.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const cam = app.stage.camera;
    const p = b.positionOf(this.slot, this.a);
    if (!Number.isFinite(p.x)) {
      this.lens.style.display = 'none';
      return;
    }
    this.lens.style.display = '';
    const depth = -this.b.copy(p).applyMatrix4(cam.matrixWorldInverse).z;
    p.project(cam);
    const x = (p.x * 0.5 + 0.5) * w;
    const y = (-p.y * 0.5 + 0.5) * h;
    const perUnit = h / (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(0.1, depth);
    set(this.me, { cx: x, cy: y, r: Math.max(9, s.radius[this.slot] * perUnit * 1.5) });
    set(this.sight, { cx: x, cy: y, r: s.p.senseRadius * perUnit });
    let n = 0;
    for (let q = 0; q < this.options.length; q++) {
      const o = this.options[q];
      if (o.lord < 0 || !s.alive[o.lord]) continue;
      const t = b.positionOf(o.lord, this.b);
      if (!Number.isFinite(t.x)) continue;
      t.project(cam);
      let line = this.lines[n];
      if (!line) {
        line = document.createElementNS(SVG, 'line');
        this.linesEl.appendChild(line);
        this.lines.push(line);
      }
      set(line, { x1: x, y1: y, x2: (t.x * 0.5 + 0.5) * w, y2: (-t.y * 0.5 + 0.5) * h });
      line.style.stroke = `var(--t${s.tribe[o.root >= 0 && s.alive[o.root] ? o.root : o.lord]})`;
      line.setAttribute('class', q === this.current ? 'cur' : '');
      line.style.display = '';
      n++;
    }
    for (let k = n; k < this.lines.length; k++) this.lines[k].style.display = 'none';
  }
}

function set(el: Element, attrs: Record<string, number>): void {
  for (const k in attrs) el.setAttribute(k, attrs[k].toFixed(1));
}
