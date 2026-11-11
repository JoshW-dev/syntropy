import 'katex/dist/katex.min.css';
import './paper.css';

// Inside the simulation's side pane, the topbar's links open new tabs instead of replacing the pane,
// and "Run the simulation" becomes a way out to the full page, since the world is already beside it.
if (window.self !== window.top) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.topbar a')) {
    if (a.getAttribute('href') === '/') {
      a.href = '/paper/';
      a.textContent = 'Open full page';
    }
    a.target = '_blank';
    a.rel = 'noopener';
  }
}
