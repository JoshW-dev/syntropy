import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import './style.css';
import { App, randomSeed, seedFromHash } from './app.ts';
import { Environment } from './ui/environment.ts';
import { decodeOverrides, readQuery } from './ui/query.ts';
import { Split } from './ui/split.ts';
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
  // The look goes on before the first world is built, so it starts in the right colours.
  const view = new View(app);
  app.start(seedFromHash() ?? randomSeed());
  const env = new Environment(app);
  // One overlay at a time: the Look popover and the Environment panel share the right side.
  view.onHide = () => env.close(false);
  view.onOpen = () => env.close(false);
  env.onOpen = () => view.closeLook();
  bindKeys(view, env, split);
  app.run();
  // Dev only: drive the loop from the console when the tab is in the background.
  if (import.meta.env.DEV) (window as unknown as { __syntropy: App }).__syntropy = app;
} catch (err) {
  console.error(err);
  // A look may already be painted; the note is styled for paper, so go back to it.
  document.documentElement.removeAttribute('style');
  document.body.style.background = '';
  const note = document.createElement('p');
  note.className = 'nogl';
  note.textContent = 'Syntropy draws with WebGL, and this browser could not start it. Try a recent Chrome, Safari, Firefox or Edge.';
  document.body.appendChild(note);
}

function bindKeys(view: View, env: Environment, split: Split): void {
  // Space on these controls presses them instead of pausing the world.
  for (const id of ['look', 'env-btn', 'env', 'show-ui']) {
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
      // Close the innermost thing first: the Look popover, then the panel, then bring the UI back.
      if (view.closeLook(true) || env.close() || view.setHidden(false)) e.preventDefault();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    if ((e.key === 'h' || e.key === 'H') && !typing(e.target)) view.toggleHidden();
    if ((e.key === 'p' || e.key === 'P') && !typing(e.target)) split.toggle();
  });
}
