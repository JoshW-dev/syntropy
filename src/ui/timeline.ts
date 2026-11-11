// The history of one world, drawn as it happens. Time runs left to right. The grey shape is the
// whole population; each coloured band inside it is a realm, in its founding lineage's colour, as
// tall as its members. Order shows as colour filling the grey. Marks under the chart show every
// realm that lost its ruler and whether it held. A click pins a year, and the world can be replayed
// from its seed up to that year. The chart can be saved as an image with the seed's link on it.

import { TICKS_PER_YEAR, type App } from '../app.ts';
import { LADDER } from '../sim/world.ts';

interface Snap {
  tick: number;
  pop: number;
  syn: number;
  /** Pairs of realm id and size. */
  realms: number[];
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A band's top and bottom at one snapshot. */
interface Slice {
  k: number;
  top: number;
  bot: number;
  size: number;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const FONT = "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif";
const SITE = 'syntropy-sim.vercel.app';

export class Timeline {
  private app: App;
  private el = $<HTMLElement>('history');
  private canvas = $<HTMLCanvasElement>('hist-canvas');
  private tip = $<HTMLDivElement>('hist-tip');
  private title = $<HTMLHeadingElement>('hist-title');
  private sub = $<HTMLParagraphElement>('hist-sub');
  private replay = $<HTMLButtonElement>('hist-replay');
  private btn = $<HTMLButtonElement>('hist-btn');
  private snaps: Snap[] = [];
  private dirty = true;
  private hover: { x: number; y: number } | null = null;
  private pin = -1;
  private bands = new Map<number, Slice[]>();
  private plot: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private tMax = 1;
  isOpen = false;

  constructor(app: App) {
    this.app = app;
    app.onStart.push(() => {
      this.snaps = [];
      this.pin = -1;
      this.replay.hidden = true;
      this.dirty = true;
    });
    app.onSurvey.push(() => this.record());
    app.onFrame.push(() => this.frame());
    this.btn.addEventListener('click', () => this.toggle());
    $<HTMLButtonElement>('hist-close').addEventListener('click', () => this.close());
    $<HTMLButtonElement>('hist-save').addEventListener('click', () => this.saveImage());
    this.replay.addEventListener('click', () => {
      const t = this.pin;
      this.close();
      if (t >= 0) app.seek(t);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.dirty = true;
    });
    this.canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      this.tip.hidden = true;
      this.dirty = true;
    });
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const t = this.tickAt(e.clientX - r.left);
      if (t < 0) return;
      this.pin = t;
      this.replay.textContent = `Replay from year ${Math.floor(t / TICKS_PER_YEAR)}`;
      this.replay.hidden = false;
      this.dirty = true;
    });
    new ResizeObserver(() => (this.dirty = true)).observe(this.canvas);
  }

  /** Syntropy through time, for the paper's live figure. */
  series(): { years: number[]; syntropy: number[] } {
    return { years: this.snaps.map((s) => +(s.tick / TICKS_PER_YEAR).toFixed(2)), syntropy: this.snaps.map((s) => +s.syn.toFixed(3)) };
  }

  get samples(): number {
    return this.snaps.length;
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.el.hidden = false;
    this.btn.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('hist-open');
    this.dirty = true;
  }

  /** Returns true when the sheet was open. */
  close(): boolean {
    if (!this.isOpen) return false;
    this.isOpen = false;
    this.el.hidden = true;
    this.tip.hidden = true;
    this.btn.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('hist-open');
    return true;
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private record(): void {
    const s = this.app.world.society;
    const h = s.history[s.history.length - 1];
    if (!h) return;
    const realms: number[] = [];
    for (const r of s.realms) if (r.ended < 0 && r.sovereign >= 0 && r.size >= s.p.realmMin) realms.push(r.id, r.size);
    this.snaps.push({ tick: h.tick, pop: h.pop, syn: h.syntropy, realms });
    this.dirty = true;
  }

  private frame(): void {
    if (!this.isOpen || !this.dirty) return;
    this.dirty = false;
    const { canvas } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 10 || h < 10) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.paint(ctx, { x: 0, y: 0, w, h }, true);
    this.paintHeader();
    this.paintTip();
  }

  private paintHeader(): void {
    const { app } = this;
    const s = app.world.society;
    const years = Math.floor(app.world.tick / TICKS_PER_YEAR);
    const title = `World ${app.seed}, year ${years}`;
    if (this.title.textContent !== title) this.title.textContent = title;
    const notable = s.realms.filter((r) => r.notable);
    const fell = notable.filter((r) => r.ended >= 0).length;
    const sub = `${notable.length} group${notable.length === 1 ? ' has' : 's have'} grown to 15 or more, and ${fell} ${fell === 1 ? 'has' : 'have'} ended.`;
    if (this.sub.textContent !== sub) this.sub.textContent = sub;
  }

  // ---------------------------------------------------------------- drawing

  private colors(): { ground: string; text: string; muted: string; trough: string; ink: string } {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    return { ground: v('--ground', '#f8f8f8'), text: v('--text', '#444'), muted: v('--muted', '#aaa'), trough: v('--trough', '#ddd'), ink: v('--ink', '#555') };
  }

  /** Draw the chart into `box`. `live` adds the pointer's crosshair and the pin. */
  private paint(ctx: CanvasRenderingContext2D, box: Rect, live: boolean): void {
    const { app, snaps } = this;
    const s = app.world.society;
    const c = this.colors();
    const strokes = app.theme.strokes;
    const plot: Rect = { x: box.x + 12, y: box.y + 20, w: box.w - 24, h: box.h - 20 - 34 };
    const last = snaps.length ? snaps[snaps.length - 1].tick : 0;
    const tMax = Math.max(last, 20 * TICKS_PER_YEAR);
    let maxPop = 60;
    for (const sn of snaps) if (sn.pop > maxPop) maxPop = sn.pop;
    const sx = (t: number) => plot.x + (t / tMax) * plot.w;
    const sy = plot.h / maxPop;
    const mid = plot.y + plot.h / 2;
    if (live) {
      this.plot = plot;
      this.tMax = tMax;
    }
    ctx.font = `12px ${FONT}`;
    ctx.textBaseline = 'alphabetic';

    // The whole population.
    if (snaps.length > 1) {
      ctx.beginPath();
      snaps.forEach((sn, k) => (k ? ctx.lineTo(sx(sn.tick), mid - (sn.pop / 2) * sy) : ctx.moveTo(sx(sn.tick), mid - (sn.pop / 2) * sy)));
      for (let k = snaps.length - 1; k >= 0; k--) ctx.lineTo(sx(snaps[k].tick), mid + (snaps[k].pop / 2) * sy);
      ctx.closePath();
      ctx.fillStyle = c.trough;
      ctx.fill();
    }

    // Realms, stacked in founding order around the middle.
    const bands = new Map<number, Slice[]>();
    // Only realms that grew to count as major get a band; the small bands stay in the grey, so the
    // chart reads as a few histories instead of thirty stripes.
    const major = (id: number) => !!s.realms[id]?.notable;
    snaps.forEach((sn, k) => {
      let sum = 0;
      for (let q = 0; q < sn.realms.length; q += 2) if (major(sn.realms[q])) sum += sn.realms[q + 1];
      let y = mid - (sum / 2) * sy;
      for (let q = 0; q < sn.realms.length; q += 2) {
        if (!major(sn.realms[q])) continue;
        const size = sn.realms[q + 1];
        let list = bands.get(sn.realms[q]);
        if (!list) bands.set(sn.realms[q], (list = []));
        list.push({ k, top: y, bot: y + size * sy, size });
        y += size * sy;
      }
    });
    if (live) this.bands = bands;
    ctx.lineJoin = 'round';
    const labels: { x: number; y: number; name: string; lo: number; hi: number }[] = [];
    ctx.font = `500 10.5px ${FONT}`;
    for (const [id, list] of bands) {
      const realm = s.realms[id];
      if (!realm) continue;
      ctx.fillStyle = strokes[realm.tribe];
      ctx.strokeStyle = c.ground;
      ctx.lineWidth = 0.75;
      let best: Slice | null = null;
      let lo = 0;
      let hi = 0;
      const room = ctx.measureText(realm.name).width + 10;
      let from = 0;
      for (let q = 1; q <= list.length; q++) {
        if (q < list.length && list[q].k === list[q - 1].k + 1) continue;
        // One unbroken run of this realm: list[from .. q - 1].
        const run = list.slice(from, q);
        ctx.beginPath();
        const x0 = sx(snaps[run[0].k].tick);
        const x1 = sx(snaps[run[run.length - 1].k].tick) + (run.length === 1 ? 1.5 : 0);
        ctx.moveTo(x0, run[0].top);
        for (const sl of run) ctx.lineTo(sx(snaps[sl.k].tick), sl.top);
        ctx.lineTo(x1, run[run.length - 1].top);
        ctx.lineTo(x1, run[run.length - 1].bot);
        for (let r = run.length - 1; r >= 0; r--) ctx.lineTo(sx(snaps[run[r].k].tick), run[r].bot);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // A name goes on the run's tallest point, if the run is wide enough to hold it.
        if (x1 - x0 > room) {
          for (const sl of run) {
            if (!best || sl.size > best.size) {
              best = sl;
              lo = x0 + room / 2;
              hi = x1 - room / 2;
            }
          }
        }
        from = q;
      }
      if (best && best.bot - best.top >= 10.5) labels.push({ x: sx(snaps[best.k].tick), y: (best.top + best.bot) / 2 + 3.5, name: realm.name, lo, hi });
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = c.ground;
    for (const l of labels) ctx.fillText(l.name, Math.min(l.hi, Math.max(l.lo, l.x)), l.y);

    // Levels: a hairline at the year each was first measured.
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'left';
    let lastX = -99;
    for (let lv = 1; lv < s.levels.length; lv++) {
      const t = s.levels[lv];
      if (t < 0) continue;
      const x = Math.round(sx(t)) + 0.5;
      ctx.strokeStyle = c.muted;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x, plot.y - 4);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
      ctx.setLineDash([]);
      if (x - lastX > 62) {
        ctx.fillStyle = c.text;
        ctx.fillText(LADDER[lv], Math.min(x + 4, plot.x + plot.w - 70), plot.y - 7);
        lastX = x;
      }
    }

    // Under the chart: every realm of 20 or more that lost its ruler, and the viewer's strikes.
    const row = plot.y + plot.h + 9;
    for (const r of s.successions) {
      if (r.members < 20) continue;
      const x = sx(r.tick - s.p.govWindow);
      ctx.beginPath();
      ctx.arc(x, row, 3, 0, Math.PI * 2);
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1.2;
      if (r.survived) {
        ctx.fillStyle = c.ink;
        ctx.fill();
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#eb2d2d';
    for (const k of app.strikes) {
      const x = sx(k.tick);
      ctx.beginPath();
      ctx.moveTo(x - 4, row - 4);
      ctx.lineTo(x + 4, row - 4);
      ctx.lineTo(x, row + 3.5);
      ctx.closePath();
      ctx.fill();
    }

    // Years.
    ctx.fillStyle = c.muted;
    ctx.textAlign = 'center';
    const span = tMax / TICKS_PER_YEAR;
    const step = span > 120 ? 20 : span > 50 ? 10 : 5;
    for (let y = 0; y <= span; y += step) ctx.fillText(y === 0 ? 'year 0' : String(y), Math.max(plot.x + 16, sx(y * TICKS_PER_YEAR)), box.y + box.h - 4);
    // A scale for the height: this bar is 100 organisms.
    const bar = 100 * sy;
    if (bar < plot.h) {
      ctx.strokeStyle = c.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plot.x + 0.5, plot.y + plot.h - bar);
      ctx.lineTo(plot.x + 0.5, plot.y + plot.h);
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillText('100 organisms', plot.x + 5, plot.y + plot.h - 3);
    }

    if (!live) return;
    const line = (t: number, color: string) => {
      const x = Math.round(sx(t)) + 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, plot.y - 4);
      ctx.lineTo(x, plot.y + plot.h + 16);
      ctx.stroke();
    };
    if (this.pin >= 0) line(this.pin, c.ink);
    if (this.hover) {
      const t = this.tickAt(this.hover.x);
      if (t >= 0) line(t, c.muted);
    }
  }

  private tickAt(x: number): number {
    const { plot, snaps } = this;
    if (!snaps.length || x < plot.x || x > plot.x + plot.w) return -1;
    const t = ((x - plot.x) / plot.w) * this.tMax;
    return t > snaps[snaps.length - 1].tick ? -1 : Math.round(t);
  }

  private paintTip(): void {
    const { hover, snaps, app } = this;
    const t = hover ? this.tickAt(hover.x) : -1;
    if (!hover || t < 0) {
      this.tip.hidden = true;
      return;
    }
    const s = app.world.society;
    let k = 0;
    for (let q = 1; q < snaps.length; q++) if (Math.abs(snaps[q].tick - t) < Math.abs(snaps[k].tick - t)) k = q;
    const sn = snaps[k];
    let inRealms = 0;
    for (let q = 0; q < sn.realms.length; q += 2) if (s.realms[sn.realms[q]]?.notable) inRealms += sn.realms[q + 1];
    const lines = [`<b>Year ${Math.floor(sn.tick / TICKS_PER_YEAR)}</b>: ${sn.pop} organisms, ${sn.pop ? Math.round((inRealms / sn.pop) * 100) : 0}% in major groups`];
    for (const [id, list] of this.bands) {
      const sl = list.find((x) => x.k === k);
      const r = s.realms[id];
      if (sl && r && hover.y >= sl.top && hover.y <= sl.bot) {
        lines.push(`<b style="color:var(--t${r.tribe})">${r.name}</b>: ${sl.size} members, founded in year ${Math.floor(r.founded / TICKS_PER_YEAR)}`);
      }
    }
    lines.push('<i>Click to pin this year</i>');
    this.tip.innerHTML = lines.join('<br>');
    this.tip.hidden = false;
    const w = this.canvas.clientWidth;
    this.tip.style.left = `${Math.min(w - 250, Math.max(8, hover.x + 14))}px`;
  }

  // ---------------------------------------------------------------- the image

  private saveImage(): void {
    const { app } = this;
    const s = app.world.society;
    const c = this.colors();
    const W = 1200;
    const H = 630;
    const canvas = document.createElement('canvas');
    canvas.width = W * 2;
    canvas.height = H * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.fillStyle = c.ground;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = c.text;
    ctx.textAlign = 'left';
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText(`World ${app.seed}`, 48, 70);
    ctx.font = `16px ${FONT}`;
    const reached = LADDER.map((name, lv) => (lv > 0 && s.levels[lv] >= 0 ? `${name} in year ${Math.floor(s.levels[lv] / TICKS_PER_YEAR)}` : '')).filter(Boolean);
    const years = Math.floor(app.world.tick / TICKS_PER_YEAR);
    ctx.fillStyle = c.ink;
    ctx.fillText(`${years} years of a Syntropy world. ${reached.join(', ')}.`, 48, 100);
    this.paint(ctx, { x: 36, y: 130, w: W - 72, h: 400 }, false);
    ctx.font = `14px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = c.ink;
    ctx.fillText('Each band is a group that grew to 15 or more, as tall as its members. Grey is everyone else. No rule in the simulation names a group.', 48, 572);
    ctx.fillStyle = c.muted;
    const query = location.search;
    ctx.fillText(`${SITE}/${query}#${app.seed}`, 48, 598);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `syntropy-${app.seed}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }
}
