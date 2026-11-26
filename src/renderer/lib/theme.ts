// Looks ("themes") and the user's own colors. A theme is a set of CSS rules keyed on
// <html data-theme="…">; custom colors are CSS variables set on <html> on top of it.
import type { ColorKey, CustomColors, Settings, ThemeId } from '../../shared/model';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  desc: string;
  /** The theme's own colors (what a custom color replaces). */
  base: Record<ColorKey, string>;
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    desc: 'Glass panels, glowing accents and bolder type. New in 1.7.',
    base: { accent: '#4d8dff', accent2: '#ff7a3d', background: '#05070f', surface: '#111729', text: '#f2f5fc', win: '#2fd27a', loss: '#ff6b6b' },
  },
  {
    id: 'classic',
    name: 'Classic',
    desc: 'The original RL Journal look.',
    base: { accent: '#3987e5', accent2: '#f0782f', background: '#070b16', surface: '#0e1424', text: '#eef2fa', win: '#22b35a', loss: '#e66767' },
  },
];

export const themeInfo = (id: ThemeId | undefined) => THEMES.find((t) => t.id === id) ?? THEMES[0];

export const COLOR_FIELDS: { key: ColorKey; label: string; help: string }[] = [
  { key: 'accent', label: 'Accent', help: 'Buttons, links, the active page, progress bars' },
  { key: 'accent2', label: 'Second accent', help: 'Games, highlights and the other half of gradients' },
  { key: 'background', label: 'Background', help: 'Behind everything' },
  { key: 'surface', label: 'Cards', help: 'Panels, cards and inputs' },
  { key: 'text', label: 'Text', help: 'Headings and normal text (muted text follows it)' },
  { key: 'win', label: 'Wins', help: 'Wins and good changes' },
  { key: 'loss', label: 'Losses', help: 'Losses and bad changes' },
];

/** Ready-made color sets (only the colors they name are changed). */
export const PALETTES: { name: string; colors: CustomColors }[] = [
  { name: 'Blue & orange', colors: {} },
  { name: 'Purple haze', colors: { accent: '#9b6bff', accent2: '#ff5fa2', background: '#07050f', surface: '#151027' } },
  { name: 'Toxic', colors: { accent: '#3ddc84', accent2: '#c6ff3d', background: '#040a07', surface: '#0d1a14' } },
  { name: 'Champion gold', colors: { accent: '#f5b83d', accent2: '#ff7a3d', background: '#0a0805', surface: '#1a1509' } },
  { name: 'Ice', colors: { accent: '#4fd1ff', accent2: '#a78bfa', background: '#040a12', surface: '#0c1724' } },
  { name: 'Crimson', colors: { accent: '#ff4d6d', accent2: '#ffb020', background: '#0d0507', surface: '#1c0d12' } },
  { name: 'Mono', colors: { accent: '#d7dce8', accent2: '#8d96ab', background: '#08090c', surface: '#14161c' } },
];

// ---------------------------------------------------------------- color math

const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: [number, number, number]) {
  return `#${[r, g, b].map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`;
}

/** a mixed with b: t = 0 → a, t = 1 → b. */
export function mix(a: string, b: string, t: number) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

export const validHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** The colors in use: the theme's own, with the user's on top. */
export function effectiveColors(settings: Pick<Settings, 'theme' | 'customColors'>): Record<ColorKey, string> {
  const base = themeInfo(settings.theme).base;
  const out = { ...base };
  for (const [k, v] of Object.entries(settings.customColors ?? {})) if (validHex(v)) out[k as ColorKey] = v;
  return out;
}

/** CSS variables for the colors the user changed (the theme's stylesheet has the rest). */
export function customVars(settings: Pick<Settings, 'theme' | 'customColors'>): Record<string, string> {
  const custom = settings.customColors ?? {};
  const c = effectiveColors(settings);
  const vars: Record<string, string> = {};
  const has = (k: ColorKey) => validHex(custom[k]);
  if (has('accent')) {
    vars['--blue'] = c.accent;
    vars['--blue-2'] = mix(c.accent, '#000000', 0.16);
    vars['--series-1'] = c.accent;
  }
  if (has('accent2')) {
    vars['--orange'] = c.accent2;
    vars['--orange-2'] = mix(c.accent2, '#000000', 0.12);
    vars['--series-2'] = mix(c.accent2, '#000000', 0.1);
  }
  if (has('background')) {
    vars['--bg'] = c.background;
    vars['--bg-2'] = mix(c.background, '#ffffff', 0.025);
  }
  if (has('surface') || has('background')) {
    vars['--panel'] = c.surface;
    vars['--panel-2'] = mix(c.surface, '#ffffff', 0.04);
    vars['--panel-3'] = mix(c.surface, '#ffffff', 0.09);
    vars['--grid'] = mix(c.surface, '#ffffff', 0.07);
    vars['--axis'] = mix(c.surface, '#ffffff', 0.15);
  }
  if (has('text') || has('background')) {
    vars['--text'] = c.text;
    vars['--text-2'] = mix(c.text, c.background, 0.3);
    vars['--muted'] = mix(c.text, c.background, 0.5);
  }
  if (has('win')) vars['--good'] = c.win;
  if (has('loss')) vars['--bad'] = c.loss;
  return vars;
}

let applied: string[] = [];
let lastTitleBar = '';

/** Put the look and colors on the page (and the Windows title bar buttons). */
export function applyTheme(settings: Pick<Settings, 'theme' | 'customColors'>) {
  const root = document.documentElement;
  const theme = themeInfo(settings.theme).id;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  const vars = customVars(settings);
  for (const k of applied) if (!(k in vars)) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  applied = Object.keys(vars);
  const c = effectiveColors(settings);
  const bar = { color: c.background, symbolColor: mix(c.text, c.background, 0.35) };
  const key = `${bar.color}|${bar.symbolColor}`;
  if (key !== lastTitleBar) {
    lastTitleBar = key;
    void window.rlj?.setTitleBar?.(bar);
  }
}
