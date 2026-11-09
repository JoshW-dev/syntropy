// Seeded randomness. Every random choice in the simulation goes through one of these,
// so a seed string always replays the same world (in the same JS engine).

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** Uniform float in [a, b). */
  range(a: number, b: number): number;
  /** Standard normal sample. */
  normal(): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** A new independent stream, derived deterministically from this one. */
  fork(): Rng;
}

/** Hash any string to a 32-bit unsigned integer (cyrb53-style mixing, truncated). */
export function hashString(s: string): number {
  let h1 = 0xdeadbeef ^ s.length;
  let h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/** sfc32: small, fast, and statistically solid for simulation work. */
export function makeRng(seed: number | string): Rng {
  const base = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  const sm = splitmix32(base);
  let a = sm();
  let b = sm();
  let c = sm();
  let d = sm();
  let spare: number | null = null;

  const raw = (): number => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) raw();

  const rng: Rng = {
    next: raw,
    int: (n) => Math.floor(raw() * n),
    range: (lo, hi) => lo + (hi - lo) * raw(),
    chance: (p) => raw() < p,
    normal: () => {
      if (spare !== null) {
        const s = spare;
        spare = null;
        return s;
      }
      let u = 0;
      let v = 0;
      while (u <= 1e-12) u = raw();
      v = raw();
      const m = Math.sqrt(-2 * Math.log(u));
      spare = m * Math.sin(2 * Math.PI * v);
      return m * Math.cos(2 * Math.PI * v);
    },
    fork: () => makeRng(Math.floor(raw() * 4294967296)),
  };
  return rng;
}

/** A short, readable seed for URLs: 6 chars from an unambiguous alphabet. */
export function randomSeed(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(6);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}
