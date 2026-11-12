import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import './style.css';
import { App, parseStrikes, randomSeed, seedFromHash } from './app.ts';
import { Bridge } from './ui/bridge.ts';
import { Card } from './ui/card.ts';
import { Climate } from './ui/climate.ts';
import { Director } from './ui/director.ts';
import { Environment } from './ui/environment.ts';
import { Measure } from './ui/measure.ts';
import { Realms } from './ui/realms.ts';
import { Story } from './ui/story.ts';
import { Timeline } from './ui/timeline.ts';
import { decodeOverrides, readQuery } from './ui/query.ts';
import { Split } from './ui/split.ts';
import { Folds } from './ui/folds.ts';
import { View } from './ui/view.ts';

const query = new URLSearchParams(location.search);
const speed = Number(query.get('speed'));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const split = new Split();
try {
  const app = new App(canvas, {
    // Environment overrides: ?p=<base64url JSON of {"society": {...}}>, from the panel or a tuning file.
    overrides: decodeOverrides(readQuery('p')),
    speed: [1, 2, 4, 8].includes(speed) ? speed : undefined,
    reducedMotion,
  });
  // The guide: a camera that goes to what matters, a narrator, and the panels that explain one
  // organism, list the realms and draw the world's history. They only read the simulation.
  const director = new Director(app.stage);
  const story = new Story(app, director);
  const timeline = new Timeline(app);
  new Card(app, story, director);
  new Realms(app);
  story.onHistory = () => timeline.open();
  app.onFrame.push((dt) => director.update(dt));
  // The look goes on before the first world is built, so it starts in the right colours.
  const view = new View(
    app,
    {
      captions: (on) => story.setCaptions(on),
      camera: (on) => (director.enabled = on),
      spin: (on) => (app.stage.controls.autoRotate = on),
    },
    reducedMotion,
  );
  new Folds(view);
  // A link's ?k= replays the rulers its sender removed, at the ticks they removed them.
  app.start(seedFromHash() ?? randomSeed(), undefined, parseStrikes(readQuery('k')));
  const env = new Environment(app);
  const measure = new Measure(app);
  new Climate(app);
  story.onMeasure = () => env.open();
  new Bridge(app, env, story, timeline, split);
  // One overlay at a time: the Look popover and the Environment panel share the right side.
  view.onHide = () => env.close(false);
  view.onOpen = () => env.close(false);
  env.onOpen = () => view.closeLook();
  bindKeys(app, view, env, split, timeline);
  app.run();
  // Dev only: drive the loop from the console when the tab is in the background.
  if (import.meta.env.DEV) Object.assign(window, { __syntropy: app, __director: director, __measure: measure });
} catch (err) {
  console.error(err);
  // A look may already be painted; the note is styled for paper, so go back to it.
  document.documentElement.removeAttribute('style');
  document.body.style.background = '';
  const note = document.createElement('p');
  note.className = 'nogl';
  note.textContent = 'This simulation draws with WebGL, and this browser could not start it. Try a recent Chrome, Safari, Firefox or Edge.';
  document.body.appendChild(note);
}

function bindKeys(app: App, view: View, env: Environment, split: Split, timeline: Timeline): void {
  // Space on these controls presses them instead of pausing the world.
  for (const id of ['look', 'env-btn', 'env', 'show-ui', 'side', 'history', 'hist-btn']) {
    document.getElementById(id)?.addEventListener('keydown', (e) => {
      if (e.key === ' ') e.stopPropagation();
    });
  }
  const typing = (t: EventTarget | null) =>
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable) ||
    (t instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(t.type));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Close the innermost thing first: the Look popover, the panel, the history, the picked
      // organism, and last bring the UI back.
      const unpick = () => app.selected >= 0 && (app.select(-1), true);
      if (view.closeLook(true) || env.close() || timeline.close() || unpick() || view.setHidden(false)) e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if ((e.key === 'h' || e.key === 'H') && !typing(e.target)) view.toggleHidden();
    if ((e.key === 'p' || e.key === 'P') && !typing(e.target)) split.toggle();
    if ((e.key === 'r' || e.key === 'R') && !typing(e.target)) view.flip('spin');
  });
}
