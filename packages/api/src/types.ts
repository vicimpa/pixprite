/**
 * Public types of the Pixprite extension API (apiVersion 1).
 * Everything here is plain data: it crosses the worker/iframe boundary via structured clone.
 */

/** Current API version; manifests must declare `apiVersion: 1` */
export const API_VERSION = 1;

/**
 * What an extension may do. `network:<host>` allows `ctx.net.fetch` to that host only
 * (e.g. `network:api.example.com`).
 */
export type Permission =
  | 'sprite:read' | 'sprite:write' | 'tags:lock' | 'ui:panel' | 'storage' | 'clipboard'
  | `network:${string}`;

/** Text in a manifest: plain, or `%key%` resolved against the extension's own locale */
export type LocalizedString = string;

/** One field of a form rendered by the core with its own ui components */
export type FormField = {
  /** Key in the resulting values object */
  key: string;
  type: 'slider' | 'number' | 'color' | 'select' | 'checkbox' | 'text' | 'layer' | 'tag';
  label: LocalizedString;
  min?: number;
  max?: number;
  step?: number;
  /** For `select`: choices; `label` may be `%key%` */
  options?: { value: string | number; label: LocalizedString; }[];
  default?: FormValue;
};

export type FormSchema = FormField[];
/** `color` is a css hex string, `layer` / `tag` are indices */
export type FormValue = string | number | boolean;
export type FormValues = Record<string, FormValue>;

export type ThemeContribution = { id: string; label: LocalizedString; /** css var name → value */ vars: Record<string, string>; };
export type CommandContribution = {
  id: string;
  label: LocalizedString;
  /** Main menu id to show the command in */
  menu?: string;
  /** Default hotkey, e.g. `Ctrl+Shift+K` */
  key?: string;
  /** Context condition, e.g. `sprite`, `selection` */
  when?: string;
};
export type ToolContribution = {
  id: string;
  label: LocalizedString;
  /** Path to an icon inside the extension (svg/png) */
  icon: string;
  /** Toolbar group to put the tool in */
  group: string;
  /** Css cursor */
  cursor?: string;
  options?: FormSchema;
};
export type PanelContribution = {
  id: string; label: LocalizedString; dock: 'left' | 'right' | 'bottom' | 'float';
  /** Html page inside the extension */
  page: string;
  /** Not shown until the extension opens it (`ctx.ui.panels.show`) or the user does from the menu */
  hidden?: boolean;
  /** Size of a floating panel in css pixels */
  width?: number;
  height?: number;
  /** Smallest size the user can make it, css pixels (docked columns and windows alike) */
  minWidth?: number;
  minHeight?: number;
  /** The user may move it between its dock and a floating window; off unless the extension allows it */
  detachable?: boolean;
};
export type WidgetContribution = { id: string; slot: 'statusbar' | 'toolbar'; page: string; };
export type MenuContribution = {
  /** Context menu (`canvas`, `layer`, `frame`, `tag`, `palette`) or a main menu id */
  location: 'canvas' | 'layer' | 'frame' | 'tag' | 'palette' | (string & {});
  /** Command id (own, or a built-in) */
  command: string;
};
export type FilterContribution = { id: string; label: LocalizedString; options: FormSchema; };
export type IoContribution = { id: string; label: LocalizedString; /** Without the dot: `['ase', 'aseprite']` */ extensions: string[]; };
export type LanguageContribution = {
  /** BCP 47 code: `de`, `pt-BR` */
  code: string;
  /** Native name: `Deutsch` */
  name: string;
  dir: 'ltr' | 'rtl';
  /** Path to the core dictionary json (flat `key → string`) */
  dict: string;
  /** Translations for other extensions: ext id → json path (keys without the `ext.<id>.` prefix) */
  extensions?: Record<string, string>;
};

export type Contributes = {
  themes?: ThemeContribution[];
  commands?: CommandContribution[];
  tools?: ToolContribution[];
  panels?: PanelContribution[];
  widgets?: WidgetContribution[];
  menus?: MenuContribution[];
  filters?: FilterContribution[];
  importers?: IoContribution[];
  exporters?: IoContribution[];
  languages?: LanguageContribution[];
  /** Folder with `<lang>.json` for the extension's own strings, e.g. `locales/` */
  locales?: string;
};

/** manifest.json */
export type Manifest = {
  /** Lowercase, `[a-z0-9-.]`, unique; also the i18n namespace `ext.<id>.*` */
  id: string;
  name: LocalizedString;
  /** Semver */
  version: string;
  apiVersion: 1;
  author?: string;
  description?: LocalizedString;
  icon?: string;
  /** Worker module: `main.js` runs `src/main.ts`. Data-only extensions (themes, language packs) have none */
  entry?: string;
  /** Published to the public catalog; false keeps it to the repository (templates, work in progress). Default true */
  public?: boolean;
  permissions?: Permission[];
  contributes?: Contributes;
};

export type Rect = { x: number; y: number; w: number; h: number; };
export type Point = { x: number; y: number; };
export type ColorMode = 'rgb' | 'indexed' | 'gray';
export type BlendMode = string;
export type TagDirection = 'forward' | 'reverse' | 'pingpong' | 'pingpong-reverse';
export type UserData = { text?: string; color?: string; };

/** A cel without pixels; read them with `sprite.getPixels` */
export type CelInfo = Rect & {
  /** Same id in several frames = linked cel */
  id: number;
  opacity: number;
  tilemap: boolean;
};

export type LayerInfo = {
  name: string;
  visible: boolean;
  locked: boolean;
  background: boolean;
  continuous: boolean;
  /** 0..255 */
  opacity: number;
  blend: BlendMode;
  group: boolean;
  /** Nesting depth in the flat layer list (0 = top level) */
  depth: number;
  collapsed: boolean;
  /** Tileset index, -1 for a normal layer */
  tileset: number;
  clip?: boolean;
  reference: boolean;
  userData?: UserData;
  /** One per frame, null = empty cel */
  cels: (CelInfo | null)[];
};

export type FrameInfo = { /** ms */ duration: number; };

export type TagInfo = {
  name: string;
  from: number;
  to: number;
  color: string;
  direction: TagDirection;
  repeat?: number;
  userData?: UserData;
};

export type SliceKeyInfo = Rect & { frame: number; center?: Rect; pivot?: Point; };
export type SliceInfo = { name: string; color: string; keys: SliceKeyInfo[]; userData?: UserData; };

/** Read-only picture of a document at one moment */
export type SpriteSnapshot = {
  /** Document id (stable while open) */
  id: string;
  name: string;
  width: number;
  height: number;
  colorMode: ColorMode;
  /** Css hex colors; null in rgb mode without a palette */
  palette: string[] | null;
  transparentIndex: number;
  layers: LayerInfo[];
  frames: FrameInfo[];
  tags: TagInfo[];
  slices: SliceInfo[];
  /** Active layer / frame */
  layer: number;
  frame: number;
  /** Playback loop range */
  loop: [number, number] | null;
};

/**
 * Pixels of a rect. `rgba`: 4 bytes per pixel, straight alpha.
 * `index`: 1 byte per pixel (palette index), indexed mode only.
 */
export type PixelData = { rect: Rect; format: 'rgba' | 'index'; data: Uint8ClampedArray; };

export type Selection = {
  /** Bounding box in sprite coordinates, null when nothing is selected */
  bounds: Rect | null;
  /** One byte per pixel of `bounds` (0 / 255) */
  mask: Uint8Array | null;
};

export type DocumentInfo = { id: string; name: string; width: number; height: number; dirty: boolean; };

export type LockFlags = { create?: boolean; delete?: boolean; rename?: boolean; move?: boolean; resize?: boolean; };

export type Locks = {
  tags?: LockFlags;
  layers?: LockFlags;
  frames?: LockFlags;
  slices?: LockFlags;
  palette?: LockFlags;
  constraints?: {
    /** Canvas must stay this size */
    canvasSize?: { w: number; h: number; };
    maxColors?: number;
    /** Frame count must be a multiple of this */
    frameMultiple?: number;
  };
};

/** Locks as stored in a document: who set them */
export type LocksRecord = Locks & { owner: string; };

export type Problem = {
  severity: 'error' | 'warning' | 'info';
  /** Already translated text */
  message: string;
  /** Where to jump on click */
  at?: { layer?: number; frame?: number; tag?: number; slice?: number; rect?: Rect; };
};

export type Validator = (sprite: SpriteSnapshot) => Problem[] | Promise<Problem[]>;

export type PointerInfo = {
  /** Sprite coordinates (integer pixel) */
  x: number;
  y: number;
  button: number;
  pressure: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  layer: number;
  frame: number;
  /** Current tool option values */
  options: FormValues;
};

export type ToolHandlers = {
  onDown?(e: PointerInfo): void | Promise<void>;
  onMove?(e: PointerInfo): void | Promise<void>;
  onUp?(e: PointerInfo): void | Promise<void>;
  onCancel?(): void | Promise<void>;
};

/** Event name → payload */
export type EventMap = {
  'sprite:change': { document: string; };
  'selection': { document: string; bounds: Rect | null; };
  'frame': { frame: number; };
  'tool': { tool: string; };
  'tags': { document: string; };
  'playback': { playing: boolean; frame: number; };
  'history': { document: string; label: string; kind: 'do' | 'undo' | 'redo'; };
};

export type EventName = keyof EventMap;
export type Unsubscribe = () => void;

/** Owner of a piece of extension meta data */
export type MetaTarget =
  | { kind: 'sprite'; }
  | { kind: 'layer'; layer: number; }
  | { kind: 'frame'; frame: number; }
  | { kind: 'tag'; tag: number; }
  | { kind: 'slice'; slice: number; }
  | { kind: 'cel'; layer: number; frame: number; };

export type StateKey = 'fg' | 'bg' | 'tool' | 'brushSize';
export type StateValues = { fg: string; bg: string; tool: string; brushSize: number; };
