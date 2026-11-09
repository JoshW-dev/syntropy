// Render the paper's math with KaTeX at build time and write paper/index.html.
//   node scripts/build-paper.ts
// Source: paper/paper.src.html. Display math is $$...$$, inline math is \(...\).

import { readFileSync, writeFileSync } from 'node:fs';
import katex from 'katex';

// Numbers in the text come from the experiments: {{path.to.value|format}} reads paper/data/summary.json.
const summary = JSON.parse(readFileSync('paper/data/summary.json', 'utf8'));
const lookup = (path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), summary);
const formats: Record<string, (v: number) => string> = {
  pct: (v) => `${Math.round(v * 100)}%`,
  pct1: (v) => `${(v * 100).toFixed(1)}%`,
  f1: (v) => v.toFixed(1),
  f2: (v) => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2),
  f3: (v) => v.toFixed(3),
  f4: (v) => v.toFixed(4),
  int: (v) => Math.round(v).toLocaleString('en-US'),
  year: (v) => String(Math.round(v)),
};
let missing = 0;
const src = readFileSync('paper/paper.src.html', 'utf8').replace(/\{\{([^}|]+)(?:\|([a-z0-9]+))?\}\}/g, (_, path: string, f?: string) => {
  const v = lookup(path.trim());
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    missing++;
    console.warn(`missing number: ${path}`);
    return `<span style="color:red">${path}</span>`;
  }
  return (formats[f ?? 'raw'] ?? ((x: number) => String(x)))(v);
});
let eq = 0;
const render = (tex: string, display: boolean) => katex.renderToString(tex.trim(), { displayMode: display, throwOnError: true, output: 'html', strict: 'ignore' });
let out = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex: string) => {
  // \label{name} gives the equation a number we can cite as (n).
  const m = tex.match(/\\label\{([^}]+)\}/);
  const body = tex.replace(/\\label\{[^}]+\}/, '');
  if (!m) return `<div class="eq">${render(body, true)}</div>`;
  eq++;
  return `<div class="eq numbered" id="eq-${m[1]}">${render(body, true)}<span class="eqno">(${eq})</span></div>`;
});
// Resolve \eqref{name} to the equation number.
const numbers = new Map<string, number>();
let k = 0;
for (const m of src.matchAll(/\$\$[\s\S]+?\$\$/g)) {
  const l = m[0].match(/\\label\{([^}]+)\}/);
  if (l) numbers.set(l[1], ++k);
}
out = out.replace(/\\eqref\{([^}]+)\}/g, (_, name: string) => `<a href="#eq-${name}">(${numbers.get(name) ?? '?'})</a>`);
out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => render(tex, false));
writeFileSync('paper/index.html', out);
console.log(`paper/index.html: ${eq} numbered equations, ${out.length.toLocaleString()} bytes, ${missing} missing numbers`);
if (missing) process.exitCode = 1;
