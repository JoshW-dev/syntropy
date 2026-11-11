// Retake the images that show the world with its labels: the paper's Figure 1, the README hero and
// the share image. All three are seed cedar at tick 4500 (year 45), with captions and the guided
// camera off and the paper pane folded, so a retake after a wording or layout change matches.
//   node scripts/capture.ts        (the dev server must be running on port 5188)
// Set CHROME_PATH to a Chrome or Chromium binary; without it the installed Google Chrome is used.

import { chromium } from 'playwright-core';

interface Shot {
  file: string;
  w: number;
  h: number;
  /** Device scale factor: the saved image is w * dsf by h * dsf pixels. */
  dsf: number;
  zoom: number;
  type: 'png' | 'jpeg';
  /** Selectors to hide for this shot. */
  hide: string;
}

const SHOTS: Shot[] = [
  { file: 'paper/figures/world.jpg', w: 1200, h: 760, dsf: 1.5, zoom: 0.93, type: 'jpeg', hide: '.mast,.left,.chronicle,.controls,.readout,.foot,.side,.divider,.show-ui,.history,.tip' },
  { file: 'docs/hero.png', w: 1280, h: 800, dsf: 1.25, zoom: 1, type: 'png', hide: '.divider,.tip' },
  { file: 'public/og.png', w: 1200, h: 630, dsf: 1, zoom: 0.95, type: 'png', hide: '.chronicle,.controls,.readout,.foot,.tip,.side,.divider,.realms' },
];

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
for (const s of SHOTS) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.dsf });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('syntropy.layout', 'sim');
    localStorage.setItem('syntropy.show', JSON.stringify({ chronicle: true, lines: true, rings: true, food: true, captions: false, camera: false, spin: false }));
  });
  await page.goto('http://localhost:5188/#cedar');
  await page.waitForFunction(() => !!(window as unknown as { __syntropy?: { world?: unknown } }).__syntropy?.world);
  const tick = await page.evaluate(async (o) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = (window as any).__syntropy;
    app.start('cedar'); // from tick 0, so every shot is the same moment
    app.advance(75);
    app.paused = true;
    app.stage.camera.zoom = o.zoom;
    app.stage.camera.updateProjectionMatrix();
    const style = document.createElement('style');
    style.textContent = `${o.hide}{display:none!important}`;
    document.head.appendChild(style);
    await new Promise((done) => setTimeout(done, 700));
    return app.world.tick as number;
  }, { zoom: s.zoom, hide: s.hide });
  await page.screenshot({ path: s.file, type: s.type, ...(s.type === 'jpeg' ? { quality: 88 } : {}) });
  console.log(`wrote ${s.file} at tick ${tick}`);
  await ctx.close();
}
await browser.close();
