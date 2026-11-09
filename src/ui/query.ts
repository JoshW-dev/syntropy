// The parts of the address a shared link carries, plus small storage helpers. ?look= holds the
// theme and ?p= holds environment overrides as base64url JSON of {"society": {...}}; the seed stays
// in the hash. Every write replaces the current history entry instead of adding one.

import type { Overrides } from '../sim/world.ts';

export function readQuery(name: string): string | null {
  return new URLSearchParams(location.search).get(name);
}

/** Set or clear one query parameter, keeping the rest of the address and the seed. */
export function writeQuery(name: string, value: string | null): void {
  const q = new URLSearchParams(location.search);
  if (value === null) q.delete(name);
  else q.set(name, value);
  const search = q.toString();
  const next = `${location.pathname}${search ? `?${search}` : ''}${location.hash}`;
  if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', next);
}

export function decodeOverrides(raw: string | null): Overrides | undefined {
  if (!raw) return undefined;
  try {
    const json = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const o = JSON.parse(json);
    return o && typeof o === 'object' ? (o as Overrides) : undefined;
  } catch {
    console.warn('Ignoring unreadable ?p= parameter');
    return undefined;
  }
}

export function encodeOverrides(o: Overrides): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isEmpty(o: Overrides): boolean {
  return !Object.keys(o.society ?? {}).length && !Object.keys(o.cells ?? {}).length && o.ticksPerGen === undefined;
}

/** localStorage can be missing or throw (private windows, blocked storage); fall back to nothing. */
export function load(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function save(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage is a convenience; the link still carries the choice.
  }
}
