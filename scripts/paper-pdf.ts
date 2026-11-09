// Print the paper to public/paper/syntropy.pdf with headless Chromium.
//   node scripts/paper-pdf.ts [--url http://localhost:5188/paper/] [--out public/paper/syntropy.pdf]
// Set CHROME_PATH to a Chrome or Chromium binary; without it the installed Google Chrome is used.

import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const flag = (k: string, d: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const url = flag('url', 'http://localhost:5188/paper/');
const out = flag('out', 'public/paper/syntropy.pdf');
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: out,
  format: 'Letter',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="width:100%;text-align:center;font-size:8.5px;color:#555;font-family:Georgia,serif;"><span class="pageNumber"></span></div>',
  // Keep these in step with @page in paper/paper.css, which a browser's own print dialog uses.
  margin: { top: '0.65in', bottom: '0.75in', left: '0.8in', right: '0.8in' },
});
await browser.close();
console.log(`wrote ${out}`);
