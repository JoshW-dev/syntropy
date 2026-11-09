// Minimal SVG charts for the paper, in the site's ink style: hairline axes, Plex type, colour only
// where it carries meaning. Every figure is built from experiment JSON by scripts/figures.ts.

export const PALETTE = {
  ink: '#444444',
  axis: '#555555',
  grid: '#E6E6E6',
  muted: '#8A8A8A',
  blue: '#1F6AEA',
  red: '#EB2D2D',
  gold: '#CA9839',
  green: '#2F9E44',
  violet: '#7B3FD1',
  rose: '#D6337F',
  gray: '#9A9A9A',
};

const FONT = "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif";

export interface Axis {
  min: number;
  max: number;
  label: string;
  ticks?: number[];
  log?: boolean;
  format?: (v: number) => string;
}

export interface Series {
  type: 'line' | 'scatter' | 'step';
  points: [number, number][];
  color: string;
  width?: number;
  dash?: string;
  label?: string;
  r?: number;
  opacity?: number;
}

export interface Band {
  points: [number, number, number][];
  color: string;
  opacity?: number;
}

export interface ChartOpts {
  width?: number;
  height?: number;
  x: Axis;
  y: Axis;
  series: Series[];
  bands?: Band[];
  legend?: 'top-left' | 'top-right' | 'bottom-right' | 'none';
  hlines?: { y: number; color: string; dash?: string; label?: string }[];
  vlines?: { x: number; color: string; dash?: string; label?: string }[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function niceTicks(min: number, max: number, n = 5): number[] {
  const span = max - min;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Number(v.toPrecision(10)));
  return out;
}

function fmt(v: number): string {
  if (Math.abs(v) >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(3)));
}

export function chart(o: ChartOpts): string {
  const W = o.width ?? 640;
  const H = o.height ?? 360;
  const m = { l: 64, r: 18, t: 16, b: 52 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const sx = (v: number) => {
    const t = o.x.log ? (Math.log10(v) - Math.log10(o.x.min)) / (Math.log10(o.x.max) - Math.log10(o.x.min)) : (v - o.x.min) / (o.x.max - o.x.min);
    return m.l + t * pw;
  };
  const sy = (v: number) => {
    const t = o.y.log ? (Math.log10(v) - Math.log10(o.y.min)) / (Math.log10(o.y.max) - Math.log10(o.y.min)) : (v - o.y.min) / (o.y.max - o.y.min);
    return m.t + (1 - t) * ph;
  };
  const xt = o.x.ticks ?? niceTicks(o.x.min, o.x.max);
  const yt = o.y.ticks ?? niceTicks(o.y.min, o.y.max);
  const xf = o.x.format ?? fmt;
  const yf = o.y.format ?? fmt;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" font-size="12" fill="${PALETTE.ink}">`);
  for (const v of yt) parts.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" stroke="${PALETTE.grid}" stroke-width="1"/>`);
  for (const b of o.bands ?? []) {
    if (!b.points.length) continue;
    const top = b.points.map(([x, , hi]) => `${sx(x).toFixed(1)},${sy(hi).toFixed(1)}`);
    const bot = [...b.points].reverse().map(([x, lo]) => `${sx(x).toFixed(1)},${sy(lo).toFixed(1)}`);
    parts.push(`<polygon points="${[...top, ...bot].join(' ')}" fill="${b.color}" fill-opacity="${b.opacity ?? 0.15}" stroke="none"/>`);
  }
  for (const h of o.hlines ?? []) {
    parts.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${sy(h.y).toFixed(1)}" y2="${sy(h.y).toFixed(1)}" stroke="${h.color}" stroke-width="1" ${h.dash ? `stroke-dasharray="${h.dash}"` : ''}/>`);
    if (h.label) parts.push(`<text x="${m.l + pw - 4}" y="${(sy(h.y) - 5).toFixed(1)}" text-anchor="end" font-size="11" fill="${h.color}">${esc(h.label)}</text>`);
  }
  for (const v of o.vlines ?? []) {
    parts.push(`<line x1="${sx(v.x).toFixed(1)}" x2="${sx(v.x).toFixed(1)}" y1="${m.t}" y2="${m.t + ph}" stroke="${v.color}" stroke-width="1" ${v.dash ? `stroke-dasharray="${v.dash}"` : ''}/>`);
    if (v.label) parts.push(`<text x="${(sx(v.x) + 4).toFixed(1)}" y="${m.t + 11}" font-size="11" fill="${v.color}">${esc(v.label)}</text>`);
  }
  for (const s of o.series) {
    const pts = s.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && (!o.x.log || x > 0) && (!o.y.log || y > 0));
    if (!pts.length) continue;
    if (s.type === 'scatter') {
      for (const [x, y] of pts) parts.push(`<circle cx="${sx(x).toFixed(1)}" cy="${sy(y).toFixed(1)}" r="${s.r ?? 2.6}" fill="${s.color}" fill-opacity="${s.opacity ?? 0.7}"/>`);
    } else {
      let d = '';
      pts.forEach(([x, y], k) => {
        if (s.type === 'step' && k > 0) d += `L${sx(x).toFixed(1)},${sy(pts[k - 1][1]).toFixed(1)}`;
        d += `${k ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
      });
      parts.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 1.8}" stroke-linejoin="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-opacity="${s.opacity ?? 1}"/>`);
    }
  }
  parts.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="${PALETTE.axis}" stroke-width="1"/>`);
  parts.push(`<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="${PALETTE.axis}" stroke-width="1"/>`);
  for (const v of xt) {
    if (v < o.x.min - 1e-9 || v > o.x.max + 1e-9) continue;
    parts.push(`<line x1="${sx(v).toFixed(1)}" x2="${sx(v).toFixed(1)}" y1="${m.t + ph}" y2="${m.t + ph + 4}" stroke="${PALETTE.axis}"/>`);
    parts.push(`<text x="${sx(v).toFixed(1)}" y="${m.t + ph + 17}" text-anchor="middle">${esc(xf(v))}</text>`);
  }
  for (const v of yt) {
    if (v < o.y.min - 1e-9 || v > o.y.max + 1e-9) continue;
    parts.push(`<line x1="${m.l - 4}" x2="${m.l}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" stroke="${PALETTE.axis}"/>`);
    parts.push(`<text x="${m.l - 8}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${esc(yf(v))}</text>`);
  }
  parts.push(`<text x="${m.l + pw / 2}" y="${H - 12}" text-anchor="middle" fill="${PALETTE.ink}">${esc(o.x.label)}</text>`);
  parts.push(`<text transform="translate(16 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="${PALETTE.ink}">${esc(o.y.label)}</text>`);
  const labelled = o.series.filter((s) => s.label);
  if (labelled.length && o.legend !== 'none') {
    const pos = o.legend ?? 'top-left';
    const longest = Math.max(...labelled.map((s) => s.label!.length));
    const lw = 30 + longest * 6.2;
    const lx = pos === 'top-left' ? m.l + 12 : m.l + pw - lw;
    let ly = pos === 'bottom-right' ? m.t + ph - 14 * labelled.length - 6 : m.t + 12;
    for (const s of labelled) {
      parts.push(s.type === 'scatter'
        ? `<circle cx="${lx + 8}" cy="${ly - 4}" r="3.5" fill="${s.color}"/>`
        : `<line x1="${lx}" x2="${lx + 18}" y1="${ly - 4}" y2="${ly - 4}" stroke="${s.color}" stroke-width="2.2" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`);
      parts.push(`<text x="${lx + 24}" y="${ly}" font-size="11.5">${esc(s.label!)}</text>`);
      ly += 15;
    }
  }
  parts.push('</svg>');
  return parts.join('\n');
}

export interface BarOpts {
  width?: number;
  height?: number;
  categories: string[];
  groups: { label: string; color: string; values: number[] }[];
  y: Axis;
  valueFormat?: (v: number) => string;
}

/** Grouped horizontal bars: one row per category, one bar per group. */
export function bars(o: BarOpts): string {
  const W = o.width ?? 640;
  const rowH = 14 * o.groups.length + 12;
  const m = { l: 170, r: 56, t: 30, b: 40 };
  const H = o.height ?? m.t + m.b + rowH * o.categories.length;
  const pw = W - m.l - m.r;
  const sx = (v: number) => m.l + ((v - o.y.min) / (o.y.max - o.y.min)) * pw;
  const vf = o.valueFormat ?? ((v: number) => `${Math.round(v * 100)}%`);
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" font-size="12" fill="${PALETTE.ink}">`);
  const ticks = o.y.ticks ?? niceTicks(o.y.min, o.y.max, 4);
  for (const v of ticks) {
    parts.push(`<line x1="${sx(v).toFixed(1)}" x2="${sx(v).toFixed(1)}" y1="${m.t - 6}" y2="${H - m.b}" stroke="${PALETTE.grid}"/>`);
    parts.push(`<text x="${sx(v).toFixed(1)}" y="${H - m.b + 16}" text-anchor="middle">${esc((o.y.format ?? vf)(v))}</text>`);
  }
  let lx = m.l;
  for (const g of o.groups) {
    parts.push(`<rect x="${lx}" y="8" width="10" height="10" fill="${g.color}"/>`);
    parts.push(`<text x="${lx + 15}" y="17" font-size="11.5">${esc(g.label)}</text>`);
    lx += 15 + g.label.length * 6.6 + 16;
  }
  o.categories.forEach((c, i) => {
    const y0 = m.t + i * rowH;
    parts.push(`<text x="${m.l - 10}" y="${(y0 + rowH / 2 + 2).toFixed(1)}" text-anchor="end">${esc(c)}</text>`);
    o.groups.forEach((g, k) => {
      const v = g.values[i];
      const y = y0 + 6 + k * 14;
      parts.push(`<rect x="${m.l}" y="${y}" width="${Math.max(0, sx(v) - m.l).toFixed(1)}" height="11" fill="${g.color}"/>`);
      parts.push(`<text x="${(sx(v) + 5).toFixed(1)}" y="${y + 9.5}" font-size="10.5" fill="${PALETTE.muted}">${esc(vf(v))}</text>`);
    });
  });
  parts.push(`<line x1="${m.l}" x2="${m.l}" y1="${m.t - 6}" y2="${H - m.b}" stroke="${PALETTE.axis}"/>`);
  parts.push(`<text x="${m.l + pw / 2}" y="${H - 8}" text-anchor="middle">${esc(o.y.label)}</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

export interface HeatOpts {
  width?: number;
  height?: number;
  xs: number[];
  ys: number[];
  values: number[][];
  xLabel: string;
  yLabel: string;
  min: number;
  max: number;
  valueFormat?: (v: number) => string;
  title?: string;
}

/** A heatmap on a white-to-ink ramp, with each cell's value printed in it. */
export function heatmap(o: HeatOpts): string {
  const W = o.width ?? 420;
  const H = o.height ?? 360;
  const m = { l: 64, r: 14, t: o.title ? 28 : 12, b: 50 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const cw = pw / o.xs.length;
  const ch = ph / o.ys.length;
  const vf = o.valueFormat ?? ((v: number) => v.toFixed(2));
  const ramp = (t: number) => {
    // White to the site's blue stroke, perceptually even enough for 0-1 shares.
    const a = [248, 248, 248];
    const b = [31, 106, 234];
    const c = a.map((v, k) => Math.round(v + (b[k] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${FONT}" font-size="11" fill="${PALETTE.ink}">`);
  if (o.title) parts.push(`<text x="${m.l}" y="16" font-size="12.5" font-weight="500">${esc(o.title)}</text>`);
  o.ys.forEach((yv, j) => {
    o.xs.forEach((xv, i) => {
      const v = o.values[j][i];
      const t = Math.max(0, Math.min(1, (v - o.min) / (o.max - o.min)));
      const x = m.l + i * cw;
      const y = m.t + (o.ys.length - 1 - j) * ch;
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cw - 1).toFixed(1)}" height="${(ch - 1).toFixed(1)}" fill="${ramp(t)}"/>`);
      parts.push(`<text x="${(x + cw / 2).toFixed(1)}" y="${(y + ch / 2 + 4).toFixed(1)}" text-anchor="middle" fill="${t > 0.55 ? '#FFFFFF' : PALETTE.ink}">${esc(vf(v))}</text>`);
    });
  });
  o.xs.forEach((xv, i) => parts.push(`<text x="${(m.l + (i + 0.5) * cw).toFixed(1)}" y="${m.t + ph + 15}" text-anchor="middle">${esc(fmt(xv))}</text>`));
  o.ys.forEach((yv, j) => parts.push(`<text x="${m.l - 6}" y="${(m.t + (o.ys.length - 1 - j + 0.5) * ch + 4).toFixed(1)}" text-anchor="end">${esc(fmt(yv))}</text>`));
  parts.push(`<text x="${m.l + pw / 2}" y="${H - 12}" text-anchor="middle" font-size="12">${esc(o.xLabel)}</text>`);
  parts.push(`<text transform="translate(16 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="12">${esc(o.yLabel)}</text>`);
  parts.push('</svg>');
  return parts.join('\n');
}

/** Empirical quantiles of a sorted copy of xs. */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
