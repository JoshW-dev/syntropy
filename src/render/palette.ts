// Ink palette, taken from docs/taste/ciechanow.ski.md: light tinted fills at HSL lightness
// 55-68% under one 1.5px #555 outline, with deeper strokes saved for the thing being explained
// (here: who follows whom). Text names a tribe in its stroke colour, so the prose is the legend.

export const INK = {
  ground: '#F8F8F8',
  text: '#444444',
  heading: '#535353',
  muted: '#AAAAAA',
  faint: '#CCCCCC',
  outline: '#555555',
  hub: '#888888',
  trough: '#DDDDDD',
  control: '#777777',
  food: '#78AD6C',
} as const;

/** Body fills, one per tribe: Blue, Red, Gold, Green, Violet, Rose. */
export const TRIBE_FILL = ['#5EAAD4', '#D45E5E', '#FCD561', '#78AD6C', '#A589CF', '#DE7FAE'] as const;

/** Saturated strokes for command lines and for tribe names in text. */
export const TRIBE_STROKE = ['#1F6AEA', '#EB2D2D', '#CA9839', '#2F9E44', '#7B3FD1', '#D6337F'] as const;

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
