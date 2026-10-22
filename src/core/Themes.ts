/**
 * Color themes: `src/themes/<id>.json` is `{ name, vars }`, the css variables of the theme; adding a
 * theme is dropping a file there. A theme may set only some variables, the default one fills the rest
 * (extensions register themes the same way). The active theme is one <style> of variables.
 */

import { signal } from "@preact/signals-react";

export type ThemeVars = Record<string, string>;
type ThemeFile = { name?: string; vars: ThemeVars; };

const FILES = import.meta.glob<ThemeFile>('../themes/*.json', { import: 'default', eager: true });
const VARS: Record<string, ThemeVars> = Object.fromEntries(
  Object.entries(FILES).map(([path, t]) => [path.match(/([^/]+)\.json$/)![1], t.vars])
);

export const DEFAULT_THEME = 'dusk';

/** Available themes: id → display name, the default first */
export const THEMES: Record<string, string> = Object.fromEntries(
  Object.entries(FILES)
    .map(([path, t]) => { const id = path.match(/([^/]+)\.json$/)![1]; return [id, t.name ?? id] as const; })
    .sort(([a], [b]) => a === DEFAULT_THEME ? -1 : b === DEFAULT_THEME ? 1 : a.localeCompare(b))
);

export const themesVersion = signal(0);

/** Only custom properties, with values that can't break out of the block */
const clean = (vars: ThemeVars): ThemeVars => Object.fromEntries(
  Object.entries(vars).filter(([k]) => /^--[\w-]+$/.test(k)).map(([k, v]) => [k, String(v).replace(/[;{}<]/g, '')])
);

/** Adds a theme (an extension's contribution); returns the function that removes it */
export function registerTheme(id: string, label: string, vars: ThemeVars) {
  const own = clean(vars);
  VARS[id] = own;
  THEMES[id] = label;
  themesVersion.value++;
  if (current === id) void applyTheme(id);
  return () => {
    if (VARS[id] !== own) return;
    delete VARS[id];
    delete THEMES[id];
    themesVersion.value++;
    if (current === id) void applyTheme(DEFAULT_THEME);
  };
}

let style: HTMLStyleElement | null = null;
let current = '';

/** Shows a theme (an unknown id: the default one) */
export function applyTheme(id: string) {
  const theme = id in VARS ? id : DEFAULT_THEME;
  const vars = { ...VARS[DEFAULT_THEME], ...VARS[theme] };
  style ??= document.head.appendChild(Object.assign(document.createElement('style'), { id: 'pixprite-theme' }));
  style.textContent = `:root {\n${Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`;
  current = theme;
  document.documentElement.dataset.theme = theme;
  // Browser chrome follows the workspace background
  if (vars['--bg']) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', vars['--bg']);
  return Promise.resolve();
}

/** The theme is applied synchronously; kept for callers that wait for it before the first paint */
export const themeReady = () => Promise.resolve();
