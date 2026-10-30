import { IncrementalDocument } from './IncrementalDocument';
import { Cancelled, isCancelled, runTask } from './BackgroundTask';
import { isQuotaError } from "~/core/Storage";
import { Color } from "~/core/Color";
import { PaletteMap } from "~/core/ColorMode";
import { t } from "~/core/i18n";
import { applyTheme } from "~/core/Themes";
import {
  deleteSession, getProjectMeta, homeFolder, loadProjectData, loadProjectState, loadSession, loadSnapshot, listSnapshots, loadLastGoodProject, loadLastGoodSession, newProjectId, saveProjectData, saveSessionRecord, saveSnapshot,
  type SessionHead,
} from "~/core/Projects";
import type { Bitmap } from "~/core/Image";
import { Mask, type SelectMode } from "~/core/Mask";
import type { TilesetMode } from "~/core/Tilemap";
import { historyLimits, Sprite, type Guide, type Range, type RangeClip } from "~/core/Sprite";
import { prop, reactive } from "@vicimpa/decorators";
import { effect, untracked } from "@preact/signals-react";

/** Default palette: 32 hand-picked colors, dark to light per hue ramp */
export const DEFAULT_PALETTE = [
  '#000000', '#1b1a24', '#3a3848', '#5d5b6e', '#8c8aa0', '#c2c0d2', '#f2f1f8', '#ffffff',
  '#3b1726', '#7a2438', '#c43b45', '#ef7a5a', '#f7b57a', '#fbe3b2', '#5a3a1c', '#9b6a35',
  '#e2b04a', '#f8e36a', '#24452f', '#3e7a3a', '#76b043', '#bfe36a', '#163a4a', '#1f6d86',
  '#38a6c4', '#8fe0e8', '#232a6a', '#3e4fc4', '#7b8cf0', '#5a2a7a', '#9a4bb8', '#e48fd8',
];

export type ToolName =
  | 'marquee' | 'ellipseMarquee' | 'lasso' | 'polyLasso' | 'wand'
  | 'pencil' | 'spray'
  | 'eraser' | 'picker'
  | 'zoom' | 'hand'
  | 'move'
  | 'fill' | 'gradient'
  | 'line' | 'curve'
  | 'rect' | 'ellipse'
  | 'contour' | 'polygon'
  | 'blur' | 'jumble'
  | 'text' | 'slice';

export type Ink = 'simple' | 'alpha' | 'copy' | 'lockAlpha' | 'shade';
/** Two-color pattern used by the brush and the bucket: on cells take the primary color, off cells the secondary */
export type PaintPattern = 'none' | 'checker' | 'ordered2' | 'ordered4' | 'custom';
export type BrushShape = 'square' | 'circle' | 'line';
export type PickChannel = 'all' | 'color' | 'alpha';
export type RightClick = 'secondary' | 'pick' | 'erase' | 'scroll';
export type PivotAnchor = 'nw' | 'n' | 'ne' | 'w' | 'center' | 'e' | 'sw' | 's' | 'se';
export type OnionMode = 'merge' | 'tint';

/** A brush captured from pixels; `align` decides how its pattern lines up while painting */
export type CustomBrush = { bmp: Bitmap; ox: number; oy: number; align: 'source' | 'stroke' | 'dab'; };
/** A saved brush or two-color pattern in JSON-friendly form (pixels as base64 RGBA or bits) */
export type LibraryItem = { id: string; name: string; kind: 'brush' | 'pattern'; w: number; h: number; data: string; ox?: number; oy?: number; align?: CustomBrush['align']; };
/** Named tool settings switched in one click */
export type ToolPreset = { name: string; tool: ToolName; values: Record<string, unknown>; };
/** Pen pressure mapping: which parameters follow the pressure, and the lowest share it scales down to (%) */
export type PressureMap = { size: boolean; opacity: boolean; density: boolean; min: number; };
export type Theme = string;
export type Side = 'left' | 'right';
export type TimelineDock = 'bottom' | 'top';
export type UiSize = 'small' | 'medium' | 'large';
export type UiFont = 'pixelify' | 'system' | 'tiny5';

/** Fonts offered by the text tool (the pixel ones are bundled with the app) */
export const TEXT_FONTS: Record<string, string> = {
  'Pixelify Sans': "'Pixelify Sans', sans-serif",
  'Tiny5': "'Tiny5', monospace",
  'Sans serif': 'system-ui, sans-serif',
  'Serif': 'Georgia, serif',
  'Monospace': 'ui-monospace, Menlo, monospace',
};

export const UI_FONTS: Record<UiFont, { label: string; family: string; }> = {
  system: { label: 'font.systemFont', family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  pixelify: { label: 'font.pixelifySansPixelStyle', family: "'Pixelify Sans', system-ui, sans-serif" },
  tiny5: { label: 'font.tiny5TinyPixel', family: "'Tiny5', monospace" },
};

/** Pixel metrics per UI size; Tiny5 stays crisp at these font sizes */
export const UI_SIZES: Record<UiSize, { font: number; row: number; cell: number; glyph: number; tool: number; bar: number; }> = {
  small: { font: 12, row: 20, cell: 20, glyph: 1, tool: 2, bar: 30 },
  medium: { font: 15, row: 24, cell: 24, glyph: 2, tool: 2, bar: 32 },
  large: { font: 18, row: 30, cell: 30, glyph: 2, tool: 3, bar: 40 },
};

export type Prefs = {
  theme: Theme;
  uiSize: UiSize;
  uiFont: UiFont;
  /** Interface language */
  language: string;
  /** How key names are written: Mac symbols or Windows / Linux words ('auto' follows the system) */
  keyStyle: 'auto' | 'mac' | 'pc';
  /** Show the controls hint in the corner of the canvas */
  showHints: boolean;
  checkerSize: number;
  checkerA: string;
  checkerB: string;
  gridW: number;
  gridH: number;
  gridColor: string;
  pixelGridColor: string;
  onionBefore: number;
  onionAfter: number;
  onionOpacity: number;
  onionStep: number;
  onionMode: OnionMode;
  onionFront: boolean;
  onionInTag: boolean;
  rightClick: RightClick;
  playOnce: boolean;
  rewindOnStop: boolean;
  playSpeed: number;
  keepSelectionOnClear: boolean;
  gridX: number;
  gridY: number;
  gridAutoOpacity: boolean;
  checkerFollowsZoom: boolean;
  brushPreview: 'full' | 'outline' | 'none';
  /** Slice edits create a key on the current frame (animated slices) */
  sliceKeysPerFrame: boolean;
  /** Show the document tabs even with a single document */
  alwaysShowTabs: boolean;
  /** Ctrl with the move tool outlines cels and measures distances */
  autoGuides: boolean;
  autosave: boolean;
  /** Registries (registry.json urls) the extension store reads, all at once */
  extensionCatalogs: string[];
  /** Undo history limits: steps, and memory in MB (0 = no limit) */
  historySteps: number;
  historyMB: number;
  historyOperationMB: number;
};

export type Layout = {
  toolbar: Side;
  colors: Side;
  timeline: TimelineDock;
  showToolbar: boolean;
  showColors: boolean;
  showTimeline: boolean;
  showOptions: boolean;
  showStatus: boolean;
  showPreview: boolean;
  colorsSize: number;
  timelineSize: number;
  pickerSize: number;
  paletteBox: number;
  /** Color panel: which picker is shown */
  pickerTab: 'hsl' | 'hsv' | 'rgb';
  /** Preview window place (distance from the top-right corner) and size */
  previewX: number;
  previewY: number;
  previewW: number;
  previewH: number;
  previewFollow: boolean;
  previewPlaying: boolean;
};

/** The extensions/ folder, served by the editor's dev server */
export const LOCAL_CATALOG = './extensions/registry.json';
/** The published catalog: the `extensions` branch, through jsDelivr (see .github/workflows/extensions.yml) */
export const PUBLIC_CATALOG = 'https://cdn.jsdelivr.net/gh/vicimpa/pixprite@extensions/registry.json';

export const DEFAULT_PREFS: Prefs = {
  theme: 'dusk',
  uiSize: 'medium',
  uiFont: 'system',
  showHints: true,
  keyStyle: 'auto',
  language: typeof navigator !== 'undefined' && navigator.language?.startsWith('ru') ? 'ru' : 'en',
  checkerSize: 4,
  checkerA: '#8e8a9c',
  checkerB: '#a9a6b6',
  gridW: 16,
  gridH: 16,
  gridColor: '#4d7cff',
  pixelGridColor: '#00000033',
  onionBefore: 1,
  onionAfter: 0,
  onionOpacity: 0.4,
  onionStep: 0.15,
  onionMode: 'merge',
  onionFront: false,
  onionInTag: true,
  rightClick: 'secondary',
  playOnce: false,
  rewindOnStop: false,
  playSpeed: 1,
  keepSelectionOnClear: false,
  gridX: 0,
  gridY: 0,
  gridAutoOpacity: true,
  checkerFollowsZoom: true,
  brushPreview: 'full',
  alwaysShowTabs: false,
  sliceKeysPerFrame: false,
  autoGuides: true,
  autosave: true,
  historySteps: 256,
  historyMB: 0,
  historyOperationMB: 0,
  extensionCatalogs: [import.meta.env.DEV ? LOCAL_CATALOG : PUBLIC_CATALOG],
};

export const DEFAULT_LAYOUT: Layout = {
  toolbar: 'right',
  colors: 'left',
  timeline: 'bottom',
  showToolbar: true,
  showColors: true,
  showTimeline: true,
  showOptions: true,
  showStatus: true,
  showPreview: false,
  colorsSize: 220,
  timelineSize: 180,
  pickerSize: 240,
  paletteBox: 16,
  pickerTab: 'hsl',
  previewX: 16,
  previewY: 16,
  previewW: 200,
  previewH: 200,
  previewFollow: true,
  previewPlaying: true,
};

/** Preferences that describe the document rather than the user */
const DOC_PREFS = [
  'gridX', 'gridY', 'gridW', 'gridH', 'gridColor', 'gridAutoOpacity', 'pixelGridColor',
  'onionBefore', 'onionAfter', 'onionOpacity', 'onionStep', 'onionMode', 'onionFront', 'onionInTag',
  'playOnce', 'rewindOnStop', 'playSpeed', 'checkerSize', 'checkerA', 'checkerB', 'checkerFollowsZoom',
] as const;

type EncodedMask = { w: number; h: number; runs: number[]; };

/** After opening: saved, unless the last session left unsaved changes */
function restoreSaved(doc: Sprite) {
  doc.markSaved();
  if ((doc.editor?.doc as { unsaved?: boolean; } | undefined)?.unsaved) doc.savedVersion = -1;
}

/** Selection as alternating run lengths, starting with unselected pixels */
function encodeMask(m: Mask): EncodedMask {
  const runs: number[] = [];
  let cur = 0, n = 0;
  for (const v of m.data) {
    const b = v ? 1 : 0;
    if (b === cur) n++;
    else { runs.push(n); cur = b; n = 1; }
  }
  runs.push(n);
  return { w: m.w, h: m.h, runs };
}

function decodeMask(e: EncodedMask) {
  const data = new Uint8Array(e.w * e.h);
  let i = 0, v = 0;
  for (const n of e.runs) { if (v) data.fill(1, i, i + n); i += n; v ^= 1; }
  return new Mask(e.w, e.h, data);
}

/** State fields remembered per project (besides colors, palette and camera) */
const EDITOR_KEYS = [
  'tool', 'brushSize', 'brushShape', 'brushAngle', 'ink', 'opacity', 'pixelPerfect', 'filled', 'cornerRadius',
  'contiguous', 'tolerance', 'sampleAll', 'fillDiagonal', 'paintPattern', 'patternDensity', 'pickMerged', 'pickChannel', 'stopAtGrid', 'sprayWidth', 'spraySpeed',
  'gradientType', 'gradientDither', 'stabilizer', 'selectMode', 'autoSelectLayer', 'pivotAnchor',
  'textFont', 'textSize', 'textBold', 'textItalic', 'textAntialias',
  'symmetryX', 'symmetryY', 'symmetryD1', 'symmetryD2', 'symAxisX', 'symAxisY', 'tiledX', 'tiledY',
  'showGrid', 'showPixelGrid', 'snapToGrid', 'snapToGuides', 'onion', 'showLayerEdges', 'showSlices',
  'tilemapMode', 'tileA', 'tileB',
  'docBrushes',
] as const;

/** Small preview of a document's first frame for the project list */
/** Recovery snapshots: how often per document, and when each was last taken */
const SNAPSHOT_MS = 2 * 60_000;
const lastSnapshot = new WeakMap<Sprite, number>();

/** Layout fields that are personal habits rather than part of an arrangement */
const PERSONAL = ['pickerTab', 'previewX', 'previewY', 'previewW', 'previewH', 'previewFollow', 'previewPlaying'] as const;
const personal = (l: Layout) => Object.fromEntries(PERSONAL.map(k => [k, l[k]])) as Partial<Layout>;
const panelsOf = (l: Layout) => Object.fromEntries(Object.entries({ ...DEFAULT_LAYOUT, ...l }).filter(([k]) => !(PERSONAL as readonly string[]).includes(k)));

/** Built-in panel arrangements */
export const LAYOUT_PRESETS: Record<string, Layout> = {
  Default: DEFAULT_LAYOUT,
  Mirrored: { ...DEFAULT_LAYOUT, toolbar: 'left', colors: 'right' },
  Animation: { ...DEFAULT_LAYOUT, timelineSize: 320, showPreview: true },
  Focus: { ...DEFAULT_LAYOUT, showColors: false, showTimeline: false, showOptions: false },
};

function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
}

@reactive()
export class State {
  /** The document being edited */
  @prop sprite = new Sprite(32, 32);
  /** Open documents, in tab order */
  @prop docs: Sprite[] = [];
  /** The home page tab is shown instead of the editor */
  @prop home = true;
  /** Bumped whenever stored projects change (the home page re-reads them) */
  @prop projectsVersion = 0;
  /** The previous visit ended without closing the page normally (crash, killed tab) */
  @prop uncleanExit = false;

  @prop colorA = Color.fromHex('#c43b45');
  @prop colorB = Color.fromHex('#1b1a24');
  @prop palette = DEFAULT_PALETTE.slice();

  @prop tool: ToolName = 'pencil';
  /** Tool used while a modifier is held (Alt → picker, Space → hand) */
  @prop quickTool: ToolName | null = null;
  @prop brushSize = 1;
  @prop brushShape: BrushShape = 'square';
  @prop brushAngle = 0;
  @prop customBrush: CustomBrush | null = null;
  @prop ink: Ink = 'simple';
  @prop stopAtGrid = true;
  @prop pickChannel: PickChannel = 'all';
  @prop autoSelectLayer = false;
  @prop pivotAnchor: PivotAnchor = 'center';
  @prop showPivot = false;
  /** Palette entries selected in the palette view; with 2+ they form the shading ramp */
  @prop paletteSelection: number[] = [];
  /** While on, picking a color rewrites the selected palette entry */
  @prop editPaletteEntry = false;
  /** Symmetry axes in sprite pixels (between pixels when .0) */
  @prop symAxisX = 16;
  @prop symAxisY = 16;
  /** Transient message near the status bar */
  @prop tip = '';
  /** Live filter preview replacing one cel while a filter dialog is open */
  @prop filterPreview: { layer: number; frame: number; data: Uint32Array; } | null = null;
  @prop opacity = 255;
  @prop pixelPerfect = false;
  @prop filled = false;
  /** Rounded corners for rectangles and box selections, in pixels */
  @prop cornerRadius = 0;
  @prop gradientType: 'linear' | 'radial' = 'linear';
  /** Ordered dither matrix size for gradients (0 = smooth) */
  @prop gradientDither: 0 | 2 | 4 | 8 | -1 = 0;
  /** Pen pressure settings (the mouse is not affected) */
  @prop pressure: PressureMap = load('pixprite:pressure', { size: false, opacity: false, density: false, min: 10 });
  /** Brushes and patterns kept across sessions */
  @prop brushLibrary: LibraryItem[] = load('pixprite:brushes', { items: [] as LibraryItem[] }).items;
  /** Brushes and patterns saved with the current project */
  @prop docBrushes: LibraryItem[] = [];
  @prop toolPresets: ToolPreset[] = load('pixprite:toolPresets', { items: [] as ToolPreset[] }).items;
  /** Freehand smoothing: the brush trails the pointer like on a string (0 = off) */
  @prop stabilizer = 0;
  /** Text tool: where the text box sits (sprite pixels) while typing */
  @prop textAt: { x: number; y: number; } | null = null;
  @prop textFont = 'Pixelify Sans';
  @prop textSize = 16;
  @prop textBold = false;
  @prop textItalic = false;
  /** Off = hard pixel edges, the usual choice for pixel art */
  @prop textAntialias = false;
  @prop contiguous = true;
  @prop tolerance = 0;
  @prop sampleAll = false;
  /** Bucket and wand also spread through corners (8 neighbours instead of 4) */
  @prop fillDiagonal = false;
  @prop paintPattern: PaintPattern = 'none';
  /** Share of primary-color cells for ordered patterns, 1..99 % */
  @prop patternDensity = 50;
  /** User pattern captured from a selection: 1 = primary, 0 = secondary */
  @prop patternBits: { w: number; h: number; bits: Uint8Array; } | null = null;
  @prop pickMerged = true;
  @prop sprayWidth = 8;
  @prop spraySpeed = 40;
  @prop selectMode: SelectMode = 'replace';
  @prop symmetryX = false;
  @prop symmetryY = false;
  /** Diagonal mirrors through the axes' crossing point: ╲ and ╱ */
  @prop symmetryD1 = false;
  @prop symmetryD2 = false;
  get symmetryOn() { return this.symmetryX || this.symmetryY || this.symmetryD1 || this.symmetryD2; }
  @prop tiledX = false;
  @prop tiledY = false;

  @prop zoom = 8;
  /** Camera: the sprite point (in pixels) shown at the center of the viewport */
  @prop camX = 16;
  @prop camY = 16;
  /** Where the smooth zoom/camera animation is heading */
  @prop zoomTarget = 8;
  private camTarget: { x: number; y: number; } | null = null;
  /** Screen point kept fixed while zooming toward `zoomTarget` (null = viewport center) */
  private zoomAnchor: { x: number; y: number; } | null = null;
  /** Keep the sprite fitted to the viewport until the user zooms or pans */
  @prop autoFit = true;
  @prop viewW = 0;
  @prop viewH = 0;
  @prop cursorX = -100;
  @prop cursorY = -100;

  @prop showPixelGrid = true;
  @prop showGrid = false;
  /** Outline of the active cel's own bounds (it can extend past the canvas) */
  @prop showLayerEdges = false;
  @prop showSlices = true;
  /** Editor shows the sprite mirrored left/right; pixels stay as they are */
  @prop flipView = false;
  @prop showRulers = false;
  /** Guide lines in sprite pixels: vertical ones at x, horizontal ones at y */
  get guides() { return this.sprite.guides; }
  set guides(v: Guide[]) { this.sprite.guides = v; this.sprite.touch(); }
  /** Snap tools to guides (and canvas edges/center, active cel edges) within a few screen pixels */
  @prop snapToGuides = true;
  /** Lines the current drag snapped to (guides, canvas or cel edges), highlighted in the view */
  @prop snapLines: Guide[] = [];
  @prop commandPalette = false;
  /** On tilemap layers: paint pixels (turned into tiles) or place whole tiles */
  @prop tilemapMode: 'pixels' | 'tiles' = 'pixels';
  /** Tiles used by the left / right button in tiles mode */
  @prop tileA = 1;
  @prop tileB = 0;
  @prop snapToGrid = false;
  @prop onion = false;
  @prop playing = false;
  @prop fullscreenPreview = false;
  /** Status line message, e.g. hints from tools */
  @prop hint = '';

  @prop prefs: Prefs = load('pixprite:prefs', DEFAULT_PREFS);
  @prop layout: Layout = load('pixprite:layout', DEFAULT_LAYOUT);
  /** User-made arrangements by name */
  @prop savedLayouts: Record<string, Layout> = load('pixprite:layouts', {});
  /** Which arrangement is in use (built-in or saved) */
  @prop layoutName: string = load('pixprite:layoutName', { name: 'Default' }).name;

  /** The active built-in arrangement was changed since it was applied */
  get layoutModified() {
    const base = LAYOUT_PRESETS[this.layoutName];
    return !!base && JSON.stringify(panelsOf(base)) !== JSON.stringify(panelsOf(this.layout));
  }

  applyLayout(name: string) {
    const l = this.savedLayouts[name] ?? LAYOUT_PRESETS[name];
    if (!l) return;
    // Name first: the auto-save of user layouts must not see the new panels under the old name
    this.layoutName = name;
    // Only the panel arrangement changes; picker tab and preview window stay as they are
    this.layout = { ...DEFAULT_LAYOUT, ...panelsOf(l), ...personal(this.layout) };
  }

  saveLayoutAs(name: string) {
    name = name.trim();
    if (!name || LAYOUT_PRESETS[name]) return false;
    this.savedLayouts = { ...this.savedLayouts, [name]: { ...this.layout } };
    this.layoutName = name;
    return true;
  }

  deleteLayout(name: string) {
    const { [name]: _, ...rest } = this.savedLayouts;
    this.savedLayouts = rest;
    if (this.layoutName === name) this.applyLayout('Default');
  }

  /** Copied pixels and where they were copied from (to paste them back in place) */
  clipboard: (Bitmap & { x?: number; y?: number; }) | null = null;
  /** Cels, frames or layers copied from the timeline */
  rangeClipboard: RangeClip | null = null;
  /** Where the timeline clipboard came from (outlined until pasted) */
  @prop clipSource: { sprite: Sprite; range: Range; } | null = null;
  /** Which of the two clipboards was filled last */
  clipKind: 'pixels' | 'range' = 'pixels';

  /** Where pasted pixels go: back to their origin if visible, else centered in the view (per axis) */
  pastePosition(bmp: Bitmap & { x?: number; y?: number; }) {
    const vw = this.viewW / this.zoom, vh = this.viewH / this.zoom;
    const axis = (origin: number | undefined, size: number, cam: number, view: number) => {
      const center = Math.round(cam - size / 2);
      if (origin === undefined || !view) return center;
      const mid = origin + size / 2;
      return mid < cam - view / 2 || mid > cam + view / 2 ? center : origin;
    };
    return { x: axis(bmp.x, bmp.w, this.camX, vw), y: axis(bmp.y, bmp.h, this.camY, vh) };
  }

  get activeTool() { return this.quickTool ?? this.tool; }
  get ui() {
    const ui = UI_SIZES[this.prefs.uiSize] ?? UI_SIZES.medium;
    // Tiny5 is only crisp at multiples of 5px
    if (this.prefs.uiFont === 'tiny5') return { ...ui, font: { small: 10, medium: 15, large: 20 }[this.prefs.uiSize] ?? 15 };
    return ui;
  }

  setPrefs(patch: Partial<Prefs>) {
    this.prefs = { ...this.prefs, ...patch };
  }

  setLayout(patch: Partial<Layout>) {
    this.layout = { ...this.layout, ...patch };
  }

  private tipTimer = 0;

  /** Short notice near the status bar (e.g. why an action was refused) */
  showTip(text: string, ms = 1500) {
    this.tip = text;
    clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => { this.tip = ''; }, ms);
  }

  /** Status line text that hover hints can't overwrite until it expires */
  @prop notice = '';
  private noticeTimer = 0;

  showNotice(text: string, ms = 1500) {
    this.notice = text;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => { this.notice = ''; }, ms);
  }

  swapColors() {
    [this.colorA, this.colorB] = [this.colorB, this.colorA];
  }

  addToPalette(color: Color) {
    const hex = color.toHexString();
    if (!this.palette.includes(hex))
      this.palette = [...this.palette, hex];
  }

  removeFromPalette(index: number) {
    this.palette = this.palette.filter((_, i) => i !== index);
  }

  // View

  /** Screen position of the sprite's top-left corner, derived from the centered camera */
  get offsetX() { return Math.round(this.viewW / 2 - this.camX * this.zoom); }
  set offsetX(v: number) { this.camX = (this.viewW / 2 - v) / this.zoom; }
  get offsetY() { return Math.round(this.viewH / 2 - this.camY * this.zoom); }
  set offsetY(v: number) { this.camY = (this.viewH / 2 - v) / this.zoom; }

  /** Largest integer zoom that fits the sprite into the viewport with a margin */
  fitZoom() {
    const { sprite, viewW, viewH } = this;
    if (!viewW || !viewH) return this.zoom;
    return Math.max(1, Math.floor(Math.min(viewW / sprite.width, viewH / sprite.height) * 0.85));
  }

  /** Fit instantly and keep fitting while the viewport settles (new / opened sprites) */
  fit() {
    this.autoFit = true;
    this.applyFit();
  }

  applyFit() {
    if (!this.viewW || !this.viewH) return;
    this.zoom = this.zoomTarget = this.fitZoom();
    this.camX = this.sprite.width / 2;
    this.camY = this.sprite.height / 2;
    this.camTarget = null;
  }

  /** Smoothly move the camera to (camX, camY) at the given zoom */
  flyTo(zoom: number, camX = this.camX, camY = this.camY) {
    this.autoFit = false;
    this.zoomTarget = Math.max(0.25, Math.min(128, zoom));
    this.camTarget = { x: camX, y: camY };
    this.zoomAnchor = null;
  }

  fitSmooth() {
    this.flyTo(this.fitZoom(), this.sprite.width / 2, this.sprite.height / 2);
  }

  center() {
    this.flyTo(this.zoomTarget, this.sprite.width / 2, this.sprite.height / 2);
  }

  /** Smoothly zoom to `zoom`, keeping the screen point (x, y) fixed */
  zoomTo(zoom: number, x?: number, y?: number) {
    this.autoFit = false;
    this.camTarget = null;
    this.zoomTarget = Math.max(0.25, Math.min(128, zoom));
    this.zoomAnchor = x === undefined || y === undefined ? null : { x, y };
  }

  zoomStep(dir: 1 | -1, x?: number, y?: number) {
    const steps = [0.25, 0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64, 96, 128];
    const from = this.zoomTarget;
    const next = dir > 0
      ? steps.find(s => s > from + 1e-6) ?? 128
      : [...steps].reverse().find(s => s < from - 1e-6) ?? 0.25;
    this.zoomTo(next, x, y);
  }

  /** Pan by a screen-space delta */
  panBy(dx: number, dy: number) {
    this.autoFit = false;
    this.camTarget = null;
    this.camX += dx / this.zoom;
    this.camY += dy / this.zoom;
  }

  panTo(camX: number, camY: number) {
    this.autoFit = false;
    this.camTarget = null;
    this.camX = camX;
    this.camY = camY;
  }

  /** Instantly set zoom keeping the screen point (x, y) fixed */
  private zoomAround(zoom: number, x = this.viewW / 2, y = this.viewH / 2) {
    // Exact (unrounded) sprite point under (x, y), so repeated calls don't drift
    const px = this.camX + (x - this.viewW / 2) / this.zoom;
    const py = this.camY + (y - this.viewH / 2) / this.zoom;
    this.zoom = zoom;
    this.camX = px - (x - this.viewW / 2) / zoom;
    this.camY = py - (y - this.viewH / 2) / zoom;
  }

  /** Advance the zoom/camera animation; called every frame by the view */
  tickCamera(dt: number) {
    if (this.autoFit) return this.applyFit();
    const k = 1 - Math.exp(-dt / 60);
    const target = this.zoomTarget;
    if (this.zoom !== target) {
      // Interpolate in log space so zooming in and out feel the same
      let z = Math.exp(Math.log(this.zoom) + (Math.log(target) - Math.log(this.zoom)) * k);
      if (Math.abs(z / target - 1) < 0.002) z = target;
      if (this.camTarget) this.zoom = z;
      else this.zoomAround(z, this.zoomAnchor?.x, this.zoomAnchor?.y);
    }
    const c = this.camTarget;
    if (c) {
      this.camX += (c.x - this.camX) * k;
      this.camY += (c.y - this.camY) * k;
      if (Math.abs(c.x - this.camX) < 0.01 && Math.abs(c.y - this.camY) < 0.01) {
        this.camX = c.x;
        this.camY = c.y;
        if (this.zoom === target) this.camTarget = null;
      }
    }
  }

  // Persistence

  private saveTimer = 0;
  private persistQueue: Promise<void> | null = null;
  private persistRequested = false;
  private autosaveReadyAt = 0;
  private preparations = new Map<Sprite, { version: number; controller: AbortController }>();
  private incremental = new WeakMap<Sprite, IncrementalDocument>();

  private preparationFor(doc: Sprite) {
    let cache = this.incremental.get(doc);
    if (!cache) this.incremental.set(doc, cache = new IncrementalDocument());
    return cache;
  }

  private cancelObsoletePreparations() {
    for (const [doc, job] of this.preparations) if (doc.version !== job.version || !this.docs.includes(doc)) job.controller.abort();
  }
  /** Observe mutations only for the lifetime of a flush, including its quiet wait.
   * Pencil moves touch version before pointerup calls save(); they must cancel/debounce too. */
  private watchPersistenceChanges() {
    let previous: Map<Sprite, number> | undefined;
    return effect(() => {
      const current = new Map(this.docs.map(doc => [doc, doc.version]));
      untracked(() => {
        if (previous) {
          for (const [doc, version] of current) if (previous.get(doc) !== version) {
            this.autosaveReadyAt = performance.now() + 300;
            this.persistRequested = true;
          }
          this.cancelObsoletePreparations();
        }
        previous = current;
      });
    });
  }
  private documentSaves = new WeakMap<Sprite, Promise<void>>();
  private failedSessions = new Set<string>();

  /** Autosave of the open editors (not the project files) shortly after the last change */
  save() {
    store('pixprite:palette', this.palette);
    this.cancelObsoletePreparations();
    if (!this.prefs.autosave) return;
    this.autosaveReadyAt = performance.now() + 300;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.persist(), 300);
  }

  /** An untouched empty document isn't worth keeping */
  private pristine(doc: Sprite) {
    return !doc.projectId && doc.name === 'untitled' && !doc.undoDepth && doc.layers.every(l => l.cels.every(c => !c));
  }

  /** Editor state of a document: live for the shown one, remembered for the others */
  private editorOf(doc: Sprite) {
    return doc === this.sprite && !this.home ? this.captureEditor() : doc.editor;
  }

  /**
   * Writes the open editors: each tab's working copy and editor state, and which tabs are open.
   * Project files are not touched here; they change only on save.
   */
  persist(): Promise<void> {
    this.persistRequested = true;
    this.cancelObsoletePreparations();
    if (!this.persistQueue) {
      this.persistQueue = (async () => {
        const stopWatching = this.watchPersistenceChanges();
        try {
          // Calls during a flush request one latest pass, rather than enqueueing every edit.
          let again = false;
          while (this.persistRequested) {
            // A cancelled preparation waits for the edit burst to settle before capturing again.
            if (again) while (performance.now() < this.autosaveReadyAt)
              await new Promise(resolve => setTimeout(resolve, this.autosaveReadyAt - performance.now()));
            this.persistRequested = false;
            await this.persistEditors();
            again = true;
          }
        } finally { stopWatching(); this.persistQueue = null; }
      })();
    }
    return this.persistQueue;
  }

  private async persistEditors() {
    for (const doc of this.docs) {
      try {
        const sid = doc.sessionId ??= newProjectId();
        const rememberedEditor = doc.editor;
        const editor = structuredClone(this.editorOf(doc));
        const json = JSON.stringify(editor);
        const changed = doc.version !== doc.storedVersion;
        if (!changed && json === doc.storedEditor) continue;
        const version = doc.version;
        const head = { projectId: doc.projectId, name: doc.name } satisfies SessionHead;
        const now = Date.now();
        const snapshot = changed && now - (lastSnapshot.get(doc) ?? 0) >= SNAPSHOT_MS;
        const capture = changed ? this.preparationFor(doc).capture(doc, snapshot) : null;
        const raw = capture?.raw;
        const controller = new AbortController();
        this.preparations.set(doc, { version, controller });
        let prepared: Awaited<ReturnType<typeof runTask<'prepareDocument'>>> | null = null;
        try {
          prepared = capture ? await runTask('prepareDocument', { raw: capture.raw, preview: capture.preview }, { signal: controller.signal }) : null;
        } finally { this.preparations.delete(doc); }
        const thumb = prepared && capture ? capture.accept(prepared.data, prepared.thumb) : '';
        const data = prepared?.data ?? null;
        if (!this.docs.includes(doc)) continue;
        if (doc.version !== version) { this.persistRequested = true; continue; }
        await saveSessionRecord(sid, { head, data, editor }, changed);
        // A tab switch may have captured newer view/tool state while the worker was running.
        if (doc.editor === rememberedEditor) doc.editor = editor;
        doc.storedEditor = json;
        if (changed) doc.storedVersion = version;
        if (snapshot && raw && prepared && this.docs.includes(doc)) {
          try {
            await saveSnapshot({
              owner: head.projectId ?? sid, name: raw.name ?? 'untitled', width: raw.width, height: raw.height, frames: raw.frames.length, thumb,
            }, data);
            lastSnapshot.set(doc, now);
            this.projectsVersion++;
          } catch (e) {
            this.showTip(`${t('msg.couldNotSave')}: ${isQuotaError(e) ? t('storage.quotaExceeded') : (e as Error).message}`, 4000);
          }
        }
      } catch (e) {
        if (isCancelled(e)) { if (this.docs.includes(doc)) this.persistRequested = true; continue; }
        console.warn('Saving the working copy failed', e);
        this.showTip(`${t('msg.couldNotSave')}: ${isQuotaError(e) ? t('storage.quotaExceeded') : (e as Error).message}`, 4000);
      }
    }
    store('pixprite:session', {
      tabs: [...new Set([...this.docs.flatMap(d => d.sessionId ? [d.sessionId] : []), ...this.failedSessions])],
      active: this.home ? 'home' : this.sprite.sessionId,
    });
  }

  /** Writes of one document are serialized, including its first project ID assignment. */
  saveDocument(doc = this.sprite): Promise<void> {
    const next = (this.documentSaves.get(doc) ?? Promise.resolve()).catch(() => {}).then(() => this.writeDocument(doc));
    this.documentSaves.set(doc, next);
    return next;
  }

  private async writeDocument(doc: Sprite) {
    const wasOpen = this.docs.includes(doc);
    const now = Date.now(), id = doc.projectId ?? newProjectId();
    const meta = await getProjectMeta(id);
    const version = doc.version;
    const capture = this.preparationFor(doc).capture(doc, true), raw = capture.raw;
    const editor = structuredClone(this.editorOf(doc));
    const folderId = meta ? meta.folderId ?? null : homeFolder.value;
    const prepared = await runTask('prepareDocument', { raw, preview: capture.preview });
    const thumb = capture.accept(prepared.data, prepared.thumb);
    if (wasOpen && !this.docs.includes(doc)) throw new Cancelled();
    await saveProjectData({
      id, name: raw.name ?? 'untitled', created: meta?.created ?? now, updated: now,
      width: raw.width, height: raw.height, frames: raw.frames.length, layers: raw.layers.length,
      colorMode: raw.colorMode ?? 'rgb', thumb, info: raw.info as Sprite['info'],
      folderId,
    }, prepared.data, editor ? { ...editor, doc: { ...(editor.doc as object), unsaved: false } } : undefined);
    doc.projectId = id;
    // Edits made while the transaction was in flight still count as unsaved.
    doc.savedVersion = version;
    this.projectsVersion++;
    doc.storedVersion = -1;
    doc.storedEditor = '';
    await this.persist();
  }

  /** A loaded document in its own tab (shown right away) */
  openDocument(doc: Sprite) {
    this.docs = [...this.docs, doc];
    this.switchTo(doc);
  }

  /** Saves a loaded document as a project without opening it (files dropped on the home page) */
  async importProject(doc: Sprite) {
    await this.saveDocument(doc);
  }

  /** Ctrl+S */
  async saveNow() {
    const doc = this.sprite;
    if (!this.docs.includes(doc)) return;
    clearTimeout(this.saveTimer);
    try {
      await this.saveDocument(doc);
      this.showNotice(t('msg.savedName', { name: doc.name }));
    } catch (e) {
      if (isCancelled(e)) return;
      this.showTip(`${t('msg.couldNotSave')}: ${isQuotaError(e) ? t('storage.quotaExceeded') : (e as Error).message}`, 3000);
    }
  }

  /** Save as: a copy under a new name that becomes the open document */
  async saveAs(name: string) {
    const doc = this.sprite;
    if (!this.docs.includes(doc) || !name.trim()) return;
    doc.name = name.trim();
    doc.projectId = null;
    await this.saveNow();
  }

  /** Opens a stored project in a tab (or switches to the tab already showing it) */
  async openProject(id: string) {
    const open = this.docs.find(d => d.projectId === id);
    if (open) return this.switchTo(open);
    try {
      const data = await loadProjectData(id);
      if (!data) throw new Error(t('msg.theProjectCouldNot'));
      const doc = new Sprite(32, 32);
      await doc.loadAsync(data);
      doc.projectId = id;
      doc.editor = await loadProjectState(id) ?? null;
      doc.markSaved();
      this.docs = [...this.docs, doc];
      this.switchTo(doc);
      this.save();
    } catch (e) {
      this.showTip(`${t('recovery.openFailed')}: ${(e as Error).message}`, 6000);
    }
  }

  /** Recovery never replaces or removes the damaged stored project. */
  async recoverProject(id: string) {
    try {
      const saved = await loadLastGoodProject(id);
      if (!saved) return this.showTip(t('recovery.noPrevious'), 5000);
      const doc = new Sprite(1, 1);
      await doc.loadAsync(saved.data);
      doc.name = `${doc.name} (${t('recovery.copy')})`;
      this.openDocument(doc);
      this.save();
      this.showNotice(t('recovery.openedCopy'));
    } catch (e) { this.showTip(`${t('recovery.failed')}: ${(e as Error).message}`, 5000); }
  }

  /** Opens a recovery snapshot as a new unsaved document */
  async openSnapshot(id: string) {
    const data = await loadSnapshot(id);
    if (!data) return this.showTip(t('msg.theSnapshotCouldNot'));
    const doc = new Sprite(32, 32);
    await doc.loadAsync(data);
    const time = (await listSnapshots()).find(s => s.id === id)?.time ?? Date.now();
    doc.name = `${doc.name} (${new Date(time).toLocaleString()})`;
    doc.projectId = null;
    doc.storedVersion = -1;
    this.openDocument(doc);
    this.save();
  }

  /** Asks what to do with unsaved changes when a tab closes (set by the interface) */
  confirmClose: (doc: Sprite) => Promise<'save' | 'discard' | 'cancel'> = async () => 'discard';

  showHome() {
    this.playing = false;
    this.sprite.dropFloating();
    this.home = true;
    void this.persist();
  }

  // Documents

  /** Shows another open document, keeping each one's camera */
  switchTo(doc: Sprite) {
    if (!this.docs.includes(doc)) return;
    const wasHome = this.home;
    this.home = false;
    if (doc === this.sprite && !wasHome) return;
    this.playing = false;
    if (doc !== this.sprite && this.docs.includes(this.sprite)) {
      this.sprite.dropFloating();
      this.sprite.editor = this.captureEditor();
    }
    this.sprite = doc;
    this.textAt = null;
    if (doc.editor) this.applyEditor(doc.editor);
    else this.fit();
  }

  /** Editor state saved with each project */
  captureEditor(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of EDITOR_KEYS) out[k] = (this as unknown as Record<string, unknown>)[k];
    out.colorA = this.colorA.toHexString(true);
    out.colorB = this.colorB.toHexString(true);
    out.palette = this.palette.slice();
    out.zoom = this.zoomTarget;
    out.camX = this.camX;
    out.camY = this.camY;
    // Panels: sizes, sides, shown panels, picker tab, preview window
    out.layout = { ...this.layout };
    out.layoutName = this.layoutName;
    // Settings that belong to the document: grid, onion skin, playback, checkerboard
    out.prefs = Object.fromEntries(DOC_PREFS.map(k => [k, this.prefs[k]]));
    out.paletteSelection = this.paletteSelection.slice();
    out.editPaletteEntry = this.editPaletteEntry;
    out.showPivot = this.showPivot;
    // Pattern captured from a selection (plain array: the state may go through JSON)
    const pb = this.patternBits;
    out.patternBits = pb ? { w: pb.w, h: pb.h, bits: Array.from(pb.bits) } : null;
    // Where the user was in the document
    const doc = this.sprite;
    out.doc = {
      unsaved: doc.modified,
      frame: doc.frame, layer: doc.layer, range: doc.range, selectedSlices: doc.selectedSlices.slice(),
      tilesetMode: doc.tilesetMode, transformAlgo: doc.transformAlgo,
      mask: doc.mask && !doc.floating ? encodeMask(doc.mask) : null,
    };
    return out;
  }

  applyEditor(e: Record<string, unknown>) {
    const self = this as unknown as Record<string, unknown>;
    for (const k of EDITOR_KEYS) if (k in e && e[k] !== undefined) self[k] = e[k];
    if (!Array.isArray(e.docBrushes)) this.docBrushes = [];
    if (typeof e.colorA === 'string') this.colorA = Color.fromHex(e.colorA);
    if (typeof e.colorB === 'string') this.colorB = Color.fromHex(e.colorB);
    if (Array.isArray(e.palette) && e.palette.length) this.sprite.paletteHost?.set(e.palette as string[]) ?? (this.palette = e.palette as string[]);
    if (e.prefs && typeof e.prefs === 'object') this.setPrefs(e.prefs as Partial<Prefs>);
    if (Array.isArray(e.paletteSelection)) this.paletteSelection = e.paletteSelection as number[];
    if (typeof e.editPaletteEntry === 'boolean') this.editPaletteEntry = e.editPaletteEntry;
    if (typeof e.showPivot === 'boolean') this.showPivot = e.showPivot;
    if ('patternBits' in e) {
      const pb = e.patternBits as { w: number; h: number; bits: ArrayLike<number>; } | null;
      this.patternBits = pb && pb.w > 0 && pb.h > 0 && pb.bits?.length === pb.w * pb.h ? { w: pb.w, h: pb.h, bits: Uint8Array.from(pb.bits) } : null;
      if (!this.patternBits && this.paintPattern === 'custom') this.paintPattern = 'none';
    }
    const d = e.doc as { frame?: number; layer?: number; range?: Range | null; selectedSlices?: number[]; tilesetMode?: TilesetMode; transformAlgo?: 'fast' | 'rotsprite' | 'edge'; mask?: EncodedMask | null; } | undefined;
    if (d) {
      const doc = this.sprite;
      if (typeof d.frame === 'number') doc.frame = Math.max(0, Math.min(doc.frames.length - 1, d.frame));
      if (typeof d.layer === 'number') doc.layer = Math.max(0, Math.min(doc.layers.length - 1, d.layer));
      doc.range = d.range ?? null;
      doc.selectedSlices = (d.selectedSlices ?? []).filter(i => i < doc.slices.length);
      if (d.tilesetMode) doc.tilesetMode = d.tilesetMode;
      if (d.transformAlgo) doc.transformAlgo = d.transformAlgo;
      if (!doc.floating) doc.mask = d.mask && d.mask.w === doc.width && d.mask.h === doc.height ? decodeMask(d.mask) : null;
    }
    if (e.layout && typeof e.layout === 'object') this.layout = { ...DEFAULT_LAYOUT, ...e.layout as Partial<Layout> };
    if (typeof e.layoutName === 'string') this.layoutName = e.layoutName;
    if (typeof e.zoom === 'number') {
      this.zoom = this.zoomTarget = e.zoom;
      this.camX = e.camX as number;
      this.camY = e.camY as number;
      this.autoFit = false;
    }
  }

  /** A fresh document in a new tab (open tabs are never replaced) */
  newDocument() {
    const doc = new Sprite(32, 32);
    this.docs = [...this.docs, doc];
    this.switchTo(doc);
    return doc;
  }

  /** Closes a tab; unsaved changes are saved or dropped as the user chooses */
  async closeDocument(doc = this.sprite) {
    if (!this.docs.includes(doc)) return false;
    if (doc.modified) {
      const choice = await this.confirmClose(doc);
      if (choice === 'cancel') return false;
      if (choice === 'save') await this.saveDocument(doc);
    }
    if (doc.sessionId) void deleteSession(doc.sessionId);
    const i = this.docs.indexOf(doc);
    const rest = this.docs.filter(d => d !== doc);
    if (this.clipSource?.sprite === doc) this.clipSource = null;
    if (doc === this.sprite) this.playing = false;
    this.preparations.get(doc)?.controller.abort();
    if (!rest.length) {
      // Last tab: back to the home page
      this.docs = [];
      this.sprite = new Sprite(1, 1);
      this.textAt = null;
      this.home = true;
      doc.releaseEditorMemory();
      void this.persist();
      return true;
    }
    if (doc === this.sprite) {
      // The tab to the right takes over, or the one to the left at the end
      this.switchTo(rest[Math.min(i, rest.length - 1)]);
    }
    this.docs = rest;
    doc.releaseEditorMemory();
    void this.persist();
    return true;
  }

  /** Ends typing with the text tool: applies the text (or throws it away) */
  finishText(apply: boolean) {
    const sprite = this.sprite;
    if (!this.textAt) return;
    if (sprite.floating) {
      if (apply) {
        sprite.dropFloating();
        // The text is plain pixels now; no selection outline left behind
        sprite.mask = null;
      } else sprite.cancelFloating();
    }
    this.textAt = null;
    if (apply) this.save();
  }

  /** A copy of a document in a new tab */
  async duplicateDocument(doc = this.sprite) {
    const raw = doc.captureDocument();
    raw.name = `${doc.name} copy`;
    const { data } = await runTask('prepareDocument', { raw });
    const copy = new Sprite(32, 32);
    await copy.loadAsync(data);
    copy.storedVersion = -1;
    this.docs = [...this.docs, copy];
    this.switchTo(copy);
    this.save();
  }

  moveDocument(doc: Sprite, to: number) {
    const rest = this.docs.filter(d => d !== doc);
    rest.splice(Math.max(0, Math.min(rest.length, to)), 0, doc);
    this.docs = rest;
  }

  /** Reopens the tabs of the last session; older localStorage saves move into project storage */
  async restore() {
    try {
      const palette = localStorage.getItem('pixprite:palette');
      if (palette) { try { this.palette = JSON.parse(palette); } catch { /* ignore damaged preferences */ } }
      // Tools and view as they were last used (a project's own settings apply on top when it opens)
      const last = localStorage.getItem('pixprite:editor');
      if (last) { try { this.applyEditor(JSON.parse(last)); } catch { /* ignore damaged preferences */ } }
      const session = load('pixprite:session', { tabs: [] as string[], active: 'home' as string | null });
      const tabs = Array.isArray(session.tabs) ? session.tabs.filter((id): id is string => typeof id === 'string') : [];
      this.failedSessions = new Set(tabs);
      // One-time migration of documents kept in localStorage by earlier versions: they become projects
      const legacy = localStorage.getItem('pixprite:docs') ?? localStorage.getItem('pixprite:project');
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy);
          const failed: unknown[] = [];
          for (const d of parsed?.docs ?? [parsed]) {
            try {
              const document = new Sprite(32, 32);
              await document.loadAsync(d);
              if (!this.pristine(document)) await this.saveDocument(document);
            } catch (e) { failed.push(d); console.warn('Legacy project migration failed', e); }
          }
          const key = localStorage.getItem('pixprite:docs') !== null ? 'pixprite:docs' : 'pixprite:project';
          if (failed.length) {
            // Keep only the records that were not migrated; successful ones must not duplicate next launch.
            localStorage.setItem(key, JSON.stringify({ docs: failed }));
            this.showTip(t('recovery.someFailed'), 6000);
          } else localStorage.removeItem(key);
        } catch (e) {
          // Malformed legacy JSON remains intact and cannot block the current session.
          console.warn('Legacy project migration failed', e);
          this.showTip(t('recovery.someFailed'), 6000);
        }
      }
      // Reopen the editors of the last visit, unsaved edits included
      let damaged = false;
      for (const id of tabs) {
        try {
          const saved = await loadSession(id);
          const doc = new Sprite(32, 32);
          if (saved) {
            await doc.loadAsync(saved.data);
            doc.sessionId = id;
            doc.projectId = saved.head?.projectId ?? null;
            doc.editor = saved.editor;
            doc.storedVersion = doc.version;
            doc.storedEditor = JSON.stringify(saved.editor);
          } else {
            const data = await loadProjectData(id);
            if (!data) throw new Error('Missing session document');
            await doc.loadAsync(data);
            doc.projectId = id;
            doc.editor = await loadProjectState(id);
          }
          restoreSaved(doc);
          this.docs = [...this.docs, doc];
          this.failedSessions.delete(id);
        } catch (e) {
          damaged = true;
          console.warn('Failed to restore document', id, e);
          // Keep the original session reference, and open its previous working copy separately.
          try {
            const recoveryId = `recovery:${id}`;
            const previous = tabs.includes(recoveryId) ? null : await loadLastGoodSession(id);
            if (previous) {
              const recovered = new Sprite(1, 1);
              await recovered.loadAsync(previous.data);
              recovered.sessionId = recoveryId;
              recovered.name = `${recovered.name} (${t('recovery.copy')})`;
              this.docs = [...this.docs, recovered];
            }
          } catch { /* leave the unreadable record available for external recovery */ }
        }
      }
      if (damaged) this.showTip(t('recovery.someFailed'), 6000);
      const active = this.docs.find(d => d.sessionId === session.active || d.projectId === session.active);
      if (active) this.switchTo(active);
      else this.home = true;
      void this.persist();
    } catch (e) {
      console.warn('Failed to restore projects', e);
    }
  }
}

export const state = new State();

// Effects live outside the constructor: @reactive turns fields into signals only after construction
/** '#rrggbb' → packed opaque pixel */
const hexToPixel = (hex: string) => {
  const v = parseInt(hex.slice(1, 7), 16);
  return (0xff000000 | ((v & 255) << 16) | (v & 0xff00) | (v >> 16 & 255)) >>> 0;
};

// The indexed mode reads the app palette; editing an entry recolors the pixels that used it.
// Palette edits are undoable steps (restoring one from history doesn't record a new step).
let lastPalette: number[] = [];
let lastHex: string[] = [];
let lastSprite: Sprite | null = null;
let restoringPalette = false;
/** Palette reorders: entries move, pixels keep their colors (no recolor in the indexed mode) */
let keepPixels = false;
export function setPaletteKeepingPixels(p: string[]) {
  keepPixels = true;
  try { state.palette = p; } finally { keepPixels = false; }
}
effect(() => {
  const colors = state.palette.map(hexToPixel);
  const sprite = state.sprite;
  untracked(() => {
    sprite.paletteHost ??= {
      get: () => state.palette.slice(),
      set: p => { restoringPalette = true; state.palette = p.slice(); restoringPalette = false; },
    };
    const switched = sprite !== lastSprite;
    lastSprite = sprite;
    const edited = !switched && !restoringPalette && lastHex.length && lastHex.join() !== state.palette.join();
    if (edited) sprite.paletteStep(lastHex);
    lastHex = state.palette.slice();
    // With palettes per frame, an edit changes the palette of the current frame
    const key = sprite.framePaletteAt();
    if (edited && key) sprite.framePalettes = sprite.framePalettes.map(k => k === key ? { ...k, colors: state.palette.slice() } : k);
    if (!switched && !restoringPalette && !keepPixels && sprite.colorMode === 'indexed' && lastPalette.length === colors.length) {
      const changes = new Map<number, number>();
      colors.forEach((c, i) => {
        const old = lastPalette[i];
        // Only entries whose old color was unique: a duplicate would make the change ambiguous
        if (old !== c && lastPalette.indexOf(old) === lastPalette.lastIndexOf(old)) changes.set(old, c);
      });
      sprite.recolor(changes, key ? sprite.framesOfPalette(sprite.framePalettes.find(k => k.frame === key.frame) ?? key) : undefined);
    }
    sprite.palette = new PaletteMap(colors, sprite.transparentIndex);
  });
  lastPalette = colors;
});

effect(() => store('pixprite:prefs', state.prefs));
effect(() => {
  historyLimits.steps = state.prefs.historySteps ?? 256;
  historyLimits.bytes = (state.prefs.historyMB ?? 0) * (1 << 20);
  historyLimits.operationBytes = (state.prefs.historyOperationMB ?? 0) * (1 << 20);
  const docs = state.docs;
  untracked(() => { for (const d of docs) d.trimHistory(); });
});
effect(() => store('pixprite:layout', state.layout));
effect(() => store('pixprite:layouts', state.savedLayouts));
effect(() => store('pixprite:pressure', state.pressure));
effect(() => store('pixprite:brushes', { items: state.brushLibrary }));
effect(() => store('pixprite:toolPresets', { items: state.toolPresets }));
// Tool and view changes are saved with the project too (a little later, they come in bursts)
let editorTimer = 0;
effect(() => {
  for (const k of EDITOR_KEYS) void (state as unknown as Record<string, unknown>)[k];
  void state.colorA; void state.colorB; void state.zoomTarget; void state.camX; void state.camY; void state.layout;
  void state.paletteSelection; void state.editPaletteEntry; void state.showPivot;
  for (const k of DOC_PREFS) void state.prefs[k];
  const doc = state.sprite;
  void doc.frame; void doc.tags; void doc.hiddenFrameRanges; void doc.layer; void doc.range; void doc.mask; void doc.selectedSlices; void doc.tilesetMode; void doc.transformAlgo;
  clearTimeout(editorTimer);
  editorTimer = window.setTimeout(() => {
    // The last tools and view settings, for new documents and the next start
    const { zoom: _z, camX: _x, camY: _y, palette: _p, doc: _d, docBrushes: _b, ...last } = state.captureEditor();
    store('pixprite:editor', last);
    if (state.prefs.autosave && !state.home) void state.persist();
  }, 600);
});
// Moving between frames shows each frame's own palette
effect(() => {
  const key = state.sprite.framePaletteAt(state.sprite.frame);
  if (!key) return;
  untracked(() => {
    if (key.colors.join() !== state.palette.join()) state.sprite.paletteHost?.set(key.colors);
  });
});
effect(() => { state.sprite.sliceKeysPerFrame = state.prefs.sliceKeysPerFrame; });
effect(() => store('pixprite:layoutName', { name: state.layoutName }));
// A user arrangement in use keeps every change made to the panels
effect(() => {
  const l = state.layout;
  untracked(() => {
    const name = state.layoutName;
    if (state.savedLayouts[name] && JSON.stringify(state.savedLayouts[name]) !== JSON.stringify(l))
      state.savedLayouts = { ...state.savedLayouts, [name]: { ...l } };
  });
});
effect(() => void applyTheme(state.prefs.theme));
effect(() => { document.documentElement.dataset.font = state.prefs.uiFont; });
effect(() => {
  const ui = state.ui, style = document.documentElement.style;
  style.setProperty('--font-size', `${ui.font}px`);
  style.setProperty('--font', (UI_FONTS[state.prefs.uiFont] ?? UI_FONTS.system).family);
  style.setProperty('--row', `${ui.row}px`);
  style.setProperty('--cell', `${ui.cell}px`);
  style.setProperty('--glyph', String(ui.glyph));
  style.setProperty('--tool-icon', String(ui.tool));
});
// The transparency checkerboard colors, for swatches and previews drawn with CSS
effect(() => {
  const style = document.documentElement.style;
  style.setProperty('--checker-a', state.prefs.checkerA);
  style.setProperty('--checker-b', state.prefs.checkerB);
});

// Background layers are filled with the secondary color
effect(() => {
  const [r, g, b] = state.colorB.rgb;
  state.sprite.backgroundFill = (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
});

// Symmetry axes start in the middle of a new canvas size
effect(() => {
  state.symAxisX = state.sprite.width / 2;
  state.symAxisY = state.sprite.height / 2;
});

// Edit mode: changing the primary color rewrites the single selected palette entry
effect(() => {
  const hex = state.colorA.toHexString();
  if (!state.editPaletteEntry) return;
  const sel = state.paletteSelection;
  if (sel.length !== 1) return;
  const i = sel[0];
  if (state.palette[i] === undefined || state.palette[i] === hex) return;
  const pal = state.palette.slice();
  pal[i] = hex;
  state.palette = pal;
});
