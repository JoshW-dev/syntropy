// The link between the paper and the world. The paper's "Try it" buttons post a message here, and
// this module runs the experiment in the world on the left: set a parameter the paper's claim is
// about, pick an organism, or remove a ruler. It also sends the paper a little live state, so the
// paper can draw this world's curve over its figures and show which experiment is running. An
// experiment is only ever a parameter of the model or a strike; the world's answer is its own.

import type { App } from '../app.ts';
import type { Environment } from './environment.ts';
import type { Split } from './split.ts';
import type { Story } from './story.ts';
import type { Timeline } from './timeline.ts';

interface Experiment {
  id: string;
  /** How the chip names the change. */
  what: string;
  set: Record<string, number>;
  /** Start the same seed again, for claims about what forms from the beginning. */
  restart?: boolean;
  kicker: string;
  body: string;
}

const EXPERIMENTS: Experiment[] = [
  {
    id: 'no-fear', what: 'fear is 0', set: { fear: 0 }, kicker: 'Fear is off',
    body: 'Each organism now gives no weight to unallied mass nearby, so no leader is worth its tax. Followers leave at their next choice, within one year. The paper found fear to be the one ingredient nothing forms without.',
  },
  {
    id: 'no-fights', what: 'fights are off', set: { fightChance: 0 }, restart: true, kicker: 'No fights, from year 0',
    body: 'This world starts again with fighting switched off. Watch whether groups still form. In the paper they do: a strong neighbour is a threat whether or not it ever attacks.',
  },
  {
    id: 'no-control-loss', what: 'control loss is 0', set: { controlLoss: 0 }, kicker: 'Control loss is off',
    body: 'Protection no longer fades with each rank between a follower and its top leader. Chains of command are now free to grow much deeper, and the largest group can hold far more.',
  },
  {
    id: 'high-tribute', what: 'tax is 90%', set: { tribute: 0.9 }, kicker: 'Tax is 90%',
    body: 'A leader now takes nearly everything a follower gathers. For most followers, standing alone scores higher, so they leave at their next choice.',
  },
];

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Bridge {
  private app: App;
  private env: Environment;
  private story: Story;
  private timeline: Timeline;
  private split: Split;
  private frame = $<HTMLIFrameElement>('paper-frame');
  private chip = $<HTMLDivElement>('exp');
  private chipText = $<HTMLSpanElement>('exp-text');
  private since = 0;
  private sent = '';

  constructor(app: App, env: Environment, story: Story, timeline: Timeline, split: Split) {
    this.app = app;
    this.env = env;
    this.story = story;
    this.timeline = timeline;
    this.split = split;
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== this.frame.contentWindow) return;
      const d = e.data as { type?: unknown; id?: unknown } | null;
      if (!d || typeof d.type !== 'string') return;
      if (d.type === 'syntropy:try' && typeof d.id === 'string') this.run(d.id);
      else if (d.type === 'syntropy:hello') this.post(true);
    });
    $<HTMLButtonElement>('exp-restore').addEventListener('click', () => this.restore());
    app.onStart.push(() => (this.sent = ''));
    app.onFrame.push((dt) => {
      this.since += dt;
      if (this.since < 0.5) return;
      this.since = 0;
      this.paintChip();
      this.post(false);
    });
  }

  /** Experiments whose settings the running world has right now. */
  private active(): Experiment[] {
    return EXPERIMENTS.filter((x) => Object.entries(x.set).every(([k, v]) => near(this.env.value(k).now, v) && !near(v, this.env.value(k).def)));
  }

  /** Run one of the paper's experiments or actions by id. */
  run(id: string): void {
    const { app, story } = this;
    const s = app.world.society;
    this.split.reveal();
    const x = EXPERIMENTS.find((e) => e.id === id);
    if (x) {
      if (this.active().includes(x)) {
        this.restore();
        return;
      }
      this.env.set(x.set);
      if (x.restart) app.start(app.seed, app.getOverrides());
      story.tell(x.kicker, x.body, 12);
    } else if (id === 'choice' || id === 'deepest') {
      const slot = id === 'choice' ? this.sample() : this.deepest();
      if (slot >= 0) app.select(slot);
      else story.tell('No organism yet', 'Wait for the first form to come loose from the lattice, then try again.', 6);
    } else if (id === 'kill-king') {
      const realm = s.standingRealms()[0];
      if (!realm || !story.strike(realm.sovereign)) story.tell('No group yet', 'Wait until a group forms, then try again.', 6);
    } else if (id === 'handoff') {
      app.start(app.seed, app.getOverrides());
      app.setSpeed(1);
    } else if (id === 'history') {
      this.timeline.open();
    }
    this.paintChip();
    this.post(true);
  }

  private restore(): void {
    const back: Record<string, number> = {};
    for (const x of this.active()) for (const k of Object.keys(x.set)) back[k] = this.env.value(k).def;
    if (!Object.keys(back).length) return;
    this.env.set(back);
    this.story.tell('Settings restored', 'The model has its tuned values again. The same rule now rebuilds what it can from where the world stands.', 8);
    this.paintChip();
    this.post(true);
  }

  /** A follower in the largest realm with the most options in view: a good one to explain. */
  private sample(): number {
    const s = this.app.world.society;
    const realm = s.standingRealms()[0];
    let best = -1;
    let bestN = 0;
    for (let i = 0, seen = 0; i < s.M && seen < 60; i++) {
      if (!s.alive[i]) continue;
      if (realm && (s.root[i] !== realm.sovereign || s.lord[i] < 0)) continue;
      seen++;
      const n = s.explain(i)?.options.length ?? 0;
      if (n > bestN) {
        bestN = n;
        best = i;
      }
    }
    return best;
  }

  private deepest(): number {
    const s = this.app.world.society;
    let best = -1;
    for (let i = 0; i < s.M; i++) if (s.alive[i] && (best < 0 || s.depth[i] > s.depth[best])) best = i;
    return best;
  }

  private paintChip(): void {
    const on = this.active();
    this.chip.hidden = on.length === 0;
    const text = on.length ? `Experiment: ${on.map((x) => x.what).join(', ')}.` : '';
    if (this.chipText.textContent !== text) this.chipText.textContent = text;
  }

  /** Send the paper this world's state. Throttled by the caller; skipped when nothing changed. */
  private post(force: boolean): void {
    const win = this.frame.contentWindow;
    if (!win || !this.frame.getAttribute('src')) return;
    const { app } = this;
    const s = app.world.society;
    const active = this.active().map((x) => x.id);
    const key = `${app.seed}|${this.timeline.samples}|${active.join()}|${s.levels.join()}`;
    if (!force && key === this.sent) return;
    this.sent = key;
    win.postMessage({ type: 'syntropy:state', seed: app.seed, levels: [...s.levels], active, ...this.timeline.series() }, location.origin);
  }
}
