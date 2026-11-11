import 'katex/dist/katex.min.css';
import './paper.css';

// Inside the simulation's side pane the paper is live. Its topbar links open new tabs, the empty
// "try" hosts in the text become buttons that run each claim in the world beside it, and two
// figures gain a line for that world on top of the 48-world result. On its own page and in the PDF
// none of this runs, and the paper reads as a plain document.
if (window.self !== window.top) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.topbar a')) {
    if (a.getAttribute('href') === '/') {
      a.href = '/paper/';
      a.textContent = 'Open full page';
    }
    a.target = '_blank';
    a.rel = 'noopener';
  }

  // Each button: its label, and its label while the experiment is running.
  const LABELS: Record<string, [string, string?]> = {
    choice: ['Show one organism weighing this choice'],
    deepest: ['Show the longest chain of command'],
    handoff: ['Restart this world and watch forms come loose'],
    history: ["Open this world's history"],
    'no-fear': ['Set fear to 0', 'Fear is 0. Restore it'],
    'no-fights': ['Restart this world with no fights', 'Fights are off. Restore them'],
    'no-control-loss': ['Set control loss to 0', 'Control loss is 0. Restore it'],
    'high-tribute': ['Raise tribute to 90%', 'Tribute is 90%. Restore it'],
    'kill-king': ['Remove the ruler of the largest realm'],
  };
  const send = (message: Record<string, unknown>) => window.parent.postMessage(message, location.origin);
  const buttons = new Map<string, HTMLButtonElement>();
  for (const host of document.querySelectorAll<HTMLElement>('.try')) {
    const lead = document.createElement('span');
    lead.className = 'try-lead';
    lead.textContent = 'Try it in the world:';
    host.appendChild(lead);
    for (const id of (host.dataset.try ?? '').split(' ')) {
      const label = LABELS[id];
      if (!label) continue;
      const b = document.createElement('button');
      b.className = 'try-btn';
      b.textContent = label[0];
      b.addEventListener('click', () => send({ type: 'syntropy:try', id }));
      host.appendChild(b);
      buttons.set(id, b);
    }
  }

  // The figures are drawn by scripts/plot.ts on a 640 by 360 canvas with these margins, so a line
  // in the same coordinates sits exactly on their axes: years 0 to 150 across, 0 to 1 up.
  const NS = 'http://www.w3.org/2000/svg';
  const sx = (year: number) => 64 + (Math.min(150, Math.max(0, year)) / 150) * 558;
  const sy = (v: number) => 308 - Math.min(1, Math.max(0, v)) * 292;
  const overlay = (file: string): { svg: SVGSVGElement; note: HTMLParagraphElement } | null => {
    const img = document.querySelector<HTMLImageElement>(`img[src*="figures/${file}"]`);
    if (!img?.parentElement) return null;
    const wrap = document.createElement('span');
    wrap.className = 'live-wrap';
    img.replaceWith(wrap);
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 640 360');
    wrap.append(img, svg);
    const note = document.createElement('p');
    note.className = 'live-note';
    wrap.after(note);
    return { svg, note };
  };
  const order = overlay('order.svg');
  const levels = overlay('levels.svg');
  const LEVEL_COLORS = ['', '#2F9E44', '#CA9839', '#EB2D2D', '#1F6AEA'];
  const LEVEL_NAMES = ['', 'organisms', 'tribes', 'hierarchy', 'government'];

  interface State {
    type: string;
    seed: string;
    levels: number[];
    active: string[];
    years: number[];
    syntropy: number[];
  }
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    const d = e.data as State | null;
    if (!d || d.type !== 'syntropy:state') return;
    for (const [id, b] of buttons) {
      const on = d.active.includes(id);
      b.classList.toggle('on', on);
      b.textContent = LABELS[id][on ? 1 : 0] ?? LABELS[id][0];
    }
    if (order) {
      const pts = d.years.map((y, k) => `${sx(y).toFixed(1)},${sy(d.syntropy[k]).toFixed(1)}`);
      const n = d.years.length;
      const end = n ? `<circle cx="${sx(d.years[n - 1]).toFixed(1)}" cy="${sy(d.syntropy[n - 1]).toFixed(1)}" r="3.2" fill="#1d1d1f"/>` : '';
      order.svg.innerHTML = `<polyline points="${pts.join(' ')}" fill="none" stroke="#1d1d1f" stroke-width="1.7" stroke-linejoin="round"/>${end}`;
      order.note.innerHTML = n
        ? `<b>Live.</b> The black line is the syntropy of world <b>${d.seed}</b>, running beside this page${n && d.years[n - 1] > 150 ? ' (its first 150 years)' : ''}.`
        : '';
    }
    if (levels) {
      const marks: string[] = [];
      const said: string[] = [];
      for (let lv = 1; lv <= 4; lv++) {
        const t = d.levels[lv];
        if (t === undefined || t < 0) continue;
        const x = sx(t / 100).toFixed(1);
        marks.push(`<line x1="${x}" x2="${x}" y1="16" y2="308" stroke="${LEVEL_COLORS[lv]}" stroke-width="1.4" stroke-dasharray="4 3"/><circle cx="${x}" cy="308" r="3.4" fill="${LEVEL_COLORS[lv]}"/>`);
        said.push(`${LEVEL_NAMES[lv]} in year ${Math.floor(t / 100)}`);
      }
      levels.svg.innerHTML = marks.join('');
      levels.note.innerHTML = said.length ? `<b>Live.</b> The dashed lines mark world <b>${d.seed}</b>, running beside this page: ${said.join(', ')}.` : '';
    }
  });
  send({ type: 'syntropy:hello' });
}
