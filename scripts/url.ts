// Print a browser URL that previews a parameter file, e.g. a sweep result:
//   node scripts/url.ts [tuning/best.json] [--base http://localhost:5173] [--seed abc]

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? 'tuning/best.json';
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = flag('base') ?? 'http://localhost:5173';
const seed = flag('seed') ?? 'demo';
const { society, cells } = JSON.parse(readFileSync(file, 'utf8'));
const payload = Buffer.from(JSON.stringify({ society, cells })).toString('base64url');
console.log(`${base}/?p=${payload}#${seed}`);
