import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import './style.css';
import { App, randomSeed, seedFromHash } from './app.ts';

// Tuning preview: ?p=<base64url JSON of {"society": {...}}> overrides parameters for this tab.
function overridesFromQuery(): object | undefined {
  const raw = new URLSearchParams(location.search).get('p');
  if (!raw) return undefined;
  try {
    const json = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    console.warn('Ignoring unreadable ?p= parameter');
    return undefined;
  }
}

const query = new URLSearchParams(location.search);
const speed = Number(query.get('speed'));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('scene') as HTMLCanvasElement;
try {
  const app = new App(canvas, {
    overrides: overridesFromQuery(),
    speed: [1, 2, 4, 8].includes(speed) ? speed : undefined,
    reducedMotion,
  });
  app.start(seedFromHash() ?? randomSeed());
  app.run();
  // Dev only: drive the loop from the console when the tab is in the background.
  if (import.meta.env.DEV) (window as unknown as { __syntropy: App }).__syntropy = app;
} catch (err) {
  console.error(err);
  const note = document.createElement('p');
  note.className = 'nogl';
  note.textContent = 'Syntropy draws with WebGL, and this browser could not start it. Try a recent Chrome, Safari, Firefox or Edge.';
  document.body.appendChild(note);
}
