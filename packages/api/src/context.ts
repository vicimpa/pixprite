import type {
  CommandInfo, DocumentInfo, EventMap, FormSchema, FormValues, Locks, LocksRecord, MetaTarget, PixelData, Point, Rect, Selection,
  SpriteSnapshot, StateKey, StateValues, TagInfo, LayerInfo, SliceInfo, ToolHandlers, Unsubscribe, Validator,
} from "./types";

/** Image produced by `sprite.render` */
export type RenderOptions = {
  /** Integer upscale, default 1 */
  scale?: number;
  /** Only these layers (indices), default all visible */
  layers?: number[];
  format?: 'bitmap' | 'png';
};

/** Work inside one undo step; every write in `fn` lands in it */
export type Transaction = SpriteApi;

export interface SpriteApi {
  /** Snapshot of the active document. Rejects when no document is open */
  get(): Promise<SpriteSnapshot>;
  /** Pixels of a cel; `rect` defaults to the canvas. Needs `sprite:read` */
  getPixels(layer: number, frame: number, rect?: Rect, format?: 'rgba' | 'index'): Promise<PixelData>;
  /** Writes pixels into a cel (creates it when empty). Needs `sprite:write` */
  putPixels(layer: number, frame: number, pixels: PixelData): Promise<void>;
  /** Flattened frame. `png` returns a Blob */
  render(frame: number, opts?: RenderOptions & { format?: 'bitmap'; }): Promise<ImageBitmap>;
  render(frame: number, opts: RenderOptions & { format: 'png'; }): Promise<Blob>;
  /** Groups all writes made in `fn` into a single undo step named `label` */
  transaction<T>(label: string, fn: (tx: Transaction) => Promise<T>): Promise<T>;

  layers: {
    add(opts?: Partial<Pick<LayerInfo, 'name' | 'opacity' | 'blend' | 'visible'>> & { at?: number; group?: boolean; }): Promise<number>;
    remove(index: number): Promise<void>;
    update(index: number, patch: Partial<Pick<LayerInfo, 'name' | 'visible' | 'locked' | 'opacity' | 'blend' | 'userData'>>): Promise<void>;
    move(from: number, to: number): Promise<void>;
  };
  frames: {
    add(at?: number, opts?: { duration?: number; copy?: boolean; }): Promise<number>;
    remove(index: number): Promise<void>;
    setDuration(index: number, ms: number): Promise<void>;
    move(from: number, to: number): Promise<void>;
  };
  tags: {
    add(tag: Pick<TagInfo, 'name' | 'from' | 'to'> & Partial<TagInfo>): Promise<number>;
    remove(index: number): Promise<void>;
    update(index: number, patch: Partial<TagInfo>): Promise<void>;
  };
  slices: {
    add(slice: Pick<SliceInfo, 'name'> & Partial<SliceInfo>): Promise<number>;
    remove(index: number): Promise<void>;
    update(index: number, patch: Partial<SliceInfo>): Promise<void>;
  };
  palette: {
    /**
     * Replaces the palette (1..256 css hex colors; the current one is in `get().palette`). One undo step.
     * In the indexed mode pixels follow their entries (an edited entry recolors them); with `keepPixels`
     * they keep their colors instead, for reordering. Needs `sprite:write`; the active document only
     */
    set(colors: string[], opts?: { keepPixels?: boolean; }): Promise<void>;
  };
  selection: {
    get(): Promise<Selection>;
    /** `null` deselects */
    set(sel: Selection | Rect | null): Promise<void>;
  };
}

export interface ExtensionContext {
  readonly id: string;
  /** Host API version */
  readonly apiVersion: number;

  sprite: SpriteApi;

  documents: {
    list(): Promise<DocumentInfo[]>;
    active(): Promise<DocumentInfo | null>;
    /** Opens a file (bytes + name) as a new document */
    open(file: { name: string; data: ArrayBuffer; }): Promise<string>;
    create(opts: { width: number; height: number; colorMode?: SpriteSnapshot['colorMode']; name?: string; }): Promise<string>;
    /** Active document changed */
    on(event: 'change', cb: (doc: DocumentInfo | null) => void): Unsubscribe;
  };

  events: {
    on<E extends keyof EventMap>(event: E, cb: (data: EventMap[E]) => void): Unsubscribe;
  };

  commands: {
    /** Binds a handler to a command declared in `contributes.commands` (or a new one) */
    register(id: string, run: (...args: unknown[]) => unknown): Unsubscribe;
    /**
     * Runs a command and resolves with its result. A built-in that has `params` takes one object of
     * arguments and then applies them without opening its dialog (`run('image.canvasSize', { width: 64 })`).
     * Another extension's command (`<ext id>:<command id>`) can be run only when it is `public`
     */
    run(id: string, ...args: unknown[]): Promise<unknown>;
    /**
     * Commands this extension may run now: built-ins, its own and other extensions' public ones.
     * `params` describes the arguments of a command that takes them; `ext` is the extension of the command
     */
    list(): Promise<CommandInfo[]>;
  };

  tools: {
    /** Binds handlers to a tool declared in `contributes.tools` */
    register(id: string, handlers: ToolHandlers): Unsubscribe;
    /** Draws a preview over the canvas during the current stroke; `null` clears it */
    overlay(pixels: PixelData | null): Promise<void>;
  };

  filters: {
    /** Filter declared in `contributes.filters`: gets the cel pixels and option values, returns new pixels */
    register(id: string, apply: (pixels: PixelData, options: FormValues) => PixelData | Promise<PixelData>): Unsubscribe;
  };

  io: {
    registerImporter(id: string, read: (file: { name: string; data: ArrayBuffer; }) => Promise<void>): Unsubscribe;
    registerExporter(id: string, write: (doc: SpriteSnapshot) => Promise<{ name: string; data: ArrayBuffer; }>): Unsubscribe;
  };

  ui: {
    notify(message: string, kind?: 'info' | 'success' | 'warning' | 'error'): Promise<void>;
    confirm(message: string, opts?: { title?: string; ok?: string; cancel?: string; }): Promise<boolean>;
    prompt(message: string, value?: string): Promise<string | null>;
    pickColor(initial?: string): Promise<string | null>;
    pickFile(opts?: { accept?: string; }): Promise<{ name: string; data: ArrayBuffer; } | null>;
    /** Progress indicator; returns an id to pass to `update` / `done` */
    progress(label: string): Promise<{ update(value: number): Promise<void>; done(): Promise<void>; }>;
    /** Modal form rendered by the core; null when cancelled */
    showForm(title: string, schema: FormSchema): Promise<FormValues | null>;
    /** Shows or hides one of the extension's own panels (needs `ui:panel`) */
    panels: {
      show(id: string): Promise<void>;
      hide(id: string): Promise<void>;
    };
  };

  view: {
    zoom(): Promise<number>;
    setZoom(zoom: number): Promise<void>;
    pan(): Promise<Point>;
    setPan(p: Point): Promise<void>;
    toScreen(p: Point): Promise<Point>;
    toSprite(p: Point): Promise<Point>;
    /**
     * Shows a place in the sprite: makes `layer` / `frame` active, moves the camera when `rect`
     * (sprite pixels) is out of view, and with `highlight` outlines `rect` for a moment
     */
    reveal(target: { layer?: number; frame?: number; rect?: Rect; highlight?: boolean; }): Promise<void>;
  };

  state: {
    get<K extends StateKey>(key: K): Promise<StateValues[K]>;
    set<K extends StateKey>(key: K, value: StateValues[K]): Promise<void>;
    on<K extends StateKey>(key: K, cb: (value: StateValues[K]) => void): Unsubscribe;
  };

  playback: {
    play(): Promise<void>;
    stop(): Promise<void>;
    seek(frame: number): Promise<void>;
  };

  /** Extension data saved in the project file, namespaced by extension id */
  meta: {
    get<T = unknown>(target: MetaTarget, key: string): Promise<T | undefined>;
    set(target: MetaTarget, key: string, value: unknown): Promise<void>;
    delete(target: MetaTarget, key: string): Promise<void>;
  };

  /** Per-extension key/value store (IndexedDB). Needs `storage` */
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
  };

  /** Structural locks enforced by the core. Needs `tags:lock` */
  locks: {
    get(): Promise<LocksRecord | null>;
    /** Replaces this extension's locks on the active document */
    set(locks: Locks): Promise<void>;
    clear(): Promise<void>;
  };

  validators: {
    /** Problems are shown in the core Problems panel */
    register(id: string, fn: Validator): Unsubscribe;
  };

  i18n: {
    /** Translates `ext.<id>.<key>`; `vars.count` picks a plural form */
    t(key: string, vars?: Record<string, string | number>): string;
    /** Translates a core key */
    core(key: string, vars?: Record<string, string | number>): string;
    readonly lang: string;
    readonly dir: 'ltr' | 'rtl';
    on(event: 'change', cb: (lang: string) => void): Unsubscribe;
    number(n: number, opts?: Intl.NumberFormatOptions): string;
    date(d: Date | number, opts?: Intl.DateTimeFormatOptions): string;
    list(items: string[], opts?: Intl.ListFormatOptions): string;
  };

  extensions: {
    /** Another extension's exported api (what its `activate` returned), or null */
    get<T = unknown>(id: string): Promise<ExtensionHandle<T> | null>;
  };

  net: {
    /** `fetch` limited to hosts in `network:<host>` permissions; body is returned whole */
    fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer; }):
      Promise<{ status: number; headers: Record<string, string>; body: ArrayBuffer; }>;
  };
}

/** Remote handle to another extension's api: every call is async */
export type ExtensionHandle<T> = {
  id: string;
  version: string;
  api: { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never };
};

/** What `activate` may return: an api object for other extensions */
export type ExtensionExports = Record<string, (...args: any[]) => unknown> | void;

export type ActivateFn = (ctx: ExtensionContext) => ExtensionExports | Promise<ExtensionExports>;
