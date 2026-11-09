// A theme is everything that sets the look: paper, ink, the tribe palette, glow, line weight and the
// HUD's colours. Paper is the default and follows docs/taste/ciechanow.ski.md. Tribe colours keep
// their names in every theme (the Blue tribe stays blue), because the chronicle names tribes by colour.

import { INK, TRIBE_FILL, TRIBE_STROKE } from './palette.ts';

/** Custom properties every theme sets on :root, so switching never leaves a stale value behind. */
export const CSS_VARS = [
  '--ground',
  '--text',
  '--heading',
  '--figure',
  '--muted',
  '--faint',
  '--ink',
  '--trough',
  '--pill',
  '--control',
  '--press',
  '--press-hover',
  '--tip',
] as const;

export type CssVar = (typeof CSS_VARS)[number];

export interface Theme {
  id: string;
  name: string;
  /** Page and clear colour. Non-default grounds are repeated in index.html for the first paint. */
  ground: string;
  /** Ink for cube edges, body outlines and ruler rings. */
  outline: string;
  /** Cube edge width as a fraction of the cube (0 = no ink). */
  edge: number;
  /** 0 = shaded paper look, 1 = self-lit glow. */
  glow: number;
  /** Additive blending for lines, rings and food (reads as light on dark grounds). */
  additive: boolean;
  fills: readonly string[];
  strokes: readonly string[];
  lineOpacity: number;
  lineWidth: number;
  food: string;
  foodAlpha: number;
  frame: string;
  frameOpacity: number;
  /** Ruler rings, when they should differ from the outline (light rings on a dark ground). */
  ring?: string;
  /** Below 1, cubes are drawn as additive light at this strength instead of opaque solids. */
  cubeAlpha?: number;
  /** A drafting grid on the floor of the box. */
  grid?: { color: string; opacity: number };
  /** Dark grounds switch native controls and scrollbars to their dark style. */
  dark?: boolean;
  /** HUD custom properties, applied to :root. */
  css: Record<CssVar, string>;
}

export const PAPER: Theme = {
  id: 'paper',
  name: 'Paper',
  ground: INK.ground,
  outline: INK.outline,
  edge: 0.07,
  glow: 0,
  additive: false,
  fills: TRIBE_FILL,
  strokes: TRIBE_STROKE,
  lineOpacity: 0.75,
  lineWidth: 1.4,
  food: INK.food,
  foodAlpha: 1,
  frame: INK.outline,
  frameOpacity: 0.22,
  css: {
    '--ground': '#f8f8f8',
    '--text': '#444444',
    '--heading': '#535353',
    '--figure': '#333333',
    '--muted': '#aaaaaa',
    '--faint': '#cccccc',
    '--ink': '#555555',
    '--trough': '#dddddd',
    '--pill': '#f8f8f8',
    '--control': '#777777',
    '--press': 'rgba(0, 0, 0, 0.05)',
    '--press-hover': 'rgba(0, 0, 0, 0.08)',
    '--tip': 'rgba(248, 248, 248, 0.94)',
  },
};

/** Self-lit bodies on a blue-black ground; lines, rings and food add light. */
export const NIGHT: Theme = {
  id: 'night',
  name: 'Night',
  ground: '#0A0C12',
  outline: '#05070B',
  edge: 0.035,
  glow: 1,
  additive: true,
  fills: ['#3D9BFF', '#FF4D5A', '#FFC23D', '#38D98A', '#9D7BFF', '#FF5CB4'],
  strokes: ['#79BCFF', '#FF7A84', '#FFD36B', '#6EE7A8', '#B9A2FF', '#FF8DCB'],
  lineOpacity: 0.6,
  lineWidth: 1.3,
  food: '#3FC7B5',
  foodAlpha: 1,
  frame: '#8B9BC0',
  frameOpacity: 0.2,
  ring: '#C4D2EE',
  dark: true,
  css: {
    '--ground': '#0a0c12',
    '--text': '#c8cdd8',
    '--heading': '#e8ebf2',
    '--figure': '#e8ebf2',
    '--muted': '#8a91a3',
    '--faint': '#2c313d',
    '--ink': '#c8cdd8',
    '--trough': 'rgba(255, 255, 255, 0.08)',
    '--pill': 'rgba(255, 255, 255, 0.16)',
    '--control': '#9aa2b4',
    '--press': 'rgba(255, 255, 255, 0.07)',
    '--press-hover': 'rgba(255, 255, 255, 0.12)',
    '--tip': 'rgba(10, 12, 18, 0.92)',
  },
};

/** White ink on drafting blue, pale fills, thin lines and a grid on the floor. */
export const BLUEPRINT: Theme = {
  id: 'blueprint',
  name: 'Blueprint',
  ground: '#163C70',
  outline: '#E6F0FF',
  edge: 0.06,
  glow: 0,
  additive: false,
  fills: ['#7DB9F5', '#F59089', '#F5CF6A', '#7FD39A', '#B39CF5', '#F38FC6'],
  strokes: ['#A5D3FF', '#FFA9A3', '#FFDA7A', '#9DE8B4', '#CDBBFF', '#FFADD8'],
  lineOpacity: 0.85,
  lineWidth: 1,
  food: '#CFE4FF',
  foodAlpha: 0.6,
  frame: '#E6F0FF',
  frameOpacity: 0.45,
  grid: { color: '#E6F0FF', opacity: 0.12 },
  dark: true,
  css: {
    '--ground': '#163c70',
    '--text': '#dce7f7',
    '--heading': '#f4f8ff',
    '--figure': '#f4f8ff',
    '--muted': '#a3b9da',
    '--faint': 'rgba(230, 240, 255, 0.28)',
    '--ink': '#e6f0ff',
    '--trough': 'rgba(255, 255, 255, 0.12)',
    '--pill': 'rgba(255, 255, 255, 0.2)',
    '--control': '#c9d8ee',
    '--press': 'rgba(255, 255, 255, 0.1)',
    '--press-hover': 'rgba(255, 255, 255, 0.16)',
    '--tip': 'rgba(22, 60, 112, 0.95)',
  },
};

/** Sumi ink on rice paper: heavy black edges, muted washes and one vermilion tribe. */
export const SUMI: Theme = {
  id: 'ink',
  name: 'Ink',
  ground: '#F1EBDD',
  outline: '#1C1A17',
  edge: 0.1,
  glow: 0,
  additive: false,
  fills: ['#6487B0', '#C43C2A', '#E3BF6F', '#84AC74', '#9C80C6', '#E79CA4'],
  strokes: ['#2F4A68', '#B3301E', '#8A6620', '#46663A', '#6C4C8E', '#A35A5C'],
  lineOpacity: 0.8,
  lineWidth: 1.8,
  food: '#8F877A',
  foodAlpha: 0.9,
  frame: '#1C1A17',
  frameOpacity: 0.25,
  css: {
    '--ground': '#f1ebdd',
    '--text': '#3a3530',
    '--heading': '#24201c',
    '--figure': '#24201c',
    '--muted': '#7d7467',
    '--faint': '#cec4b3',
    '--ink': '#2b2722',
    '--trough': '#e1d8c7',
    '--pill': '#f1ebdd',
    '--control': '#6e665b',
    '--press': 'rgba(60, 40, 20, 0.06)',
    '--press-hover': 'rgba(60, 40, 20, 0.1)',
    '--tip': 'rgba(241, 235, 221, 0.95)',
  },
};

/** Bodies as translucent light: dense regions glow, like gas in a nebula. */
export const NEBULA: Theme = {
  id: 'nebula',
  name: 'Nebula',
  ground: '#04050A',
  outline: '#000000',
  edge: 0.06,
  glow: 1,
  additive: true,
  fills: ['#3F8CFF', '#FF4040', '#FFB52E', '#2EE68A', '#9B6BFF', '#FF4FA8'],
  strokes: ['#7FB6FF', '#FF7A7A', '#FFCE6B', '#6BF0AE', '#B89BFF', '#FF86C4'],
  lineOpacity: 0.45,
  lineWidth: 1.2,
  food: '#4F7BFF',
  foodAlpha: 0.8,
  frame: '#5A6A90',
  frameOpacity: 0.16,
  ring: '#9FB0D8',
  cubeAlpha: 0.28,
  dark: true,
  css: {
    '--ground': '#04050a',
    '--text': '#c3c8d4',
    '--heading': '#e6e9f0',
    '--figure': '#e6e9f0',
    '--muted': '#858c9c',
    '--faint': '#262a35',
    '--ink': '#c3c8d4',
    '--trough': 'rgba(255, 255, 255, 0.08)',
    '--pill': 'rgba(255, 255, 255, 0.16)',
    '--control': '#9aa2b4',
    '--press': 'rgba(255, 255, 255, 0.07)',
    '--press-hover': 'rgba(255, 255, 255, 0.12)',
    '--tip': 'rgba(4, 5, 10, 0.92)',
  },
};

export const THEMES: Theme[] = [PAPER, NIGHT, BLUEPRINT, SUMI, NEBULA];

export function themeById(id: string | null | undefined): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}
