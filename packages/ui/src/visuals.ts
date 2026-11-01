import { defineElement, installStyle } from './base';
import { gradientPixels, type GradientCorners } from './gradient-pixels';
import { shaderProgram } from './program';

const css = `px-canvas,px-shader,px-gradient,px-grid-pattern{display:block;position:relative;width:100%;height:100%}px-canvas[inset],px-shader[inset],px-gradient[inset],px-grid-pattern[inset]{position:absolute;inset:0}px-canvas>canvas,px-shader>canvas,px-gradient>canvas,px-grid-pattern>canvas{position:absolute;left:0;top:0}px-icon{display:contents}`;
export type Draw = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) => void | (() => void);
export type Loop = (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D, delta: number, time: number) => void;

/** Canvas sizing, redraws, animation and cleanup shared by every consumer. */
export class PxCanvas extends HTMLElement {
  canvas: HTMLCanvasElement | null = null;
  private resize?: ResizeObserver;
  private frame = 0;
  private cleanup?: () => void;
  private _draw?: Draw;
  private _loop?: Loop;
  private last = 0;
  get hidpi() { return this.hasAttribute('hidpi'); }
  set hidpi(value: boolean) { this.toggleAttribute('hidpi', value); this.redraw(); }
  get draw() { return this._draw; }
  set draw(value: Draw | undefined) { this._draw = value; if (this.isConnected) this.redraw(); }
  get loop() { return this._loop; }
  set loop(value: Loop | undefined) { this._loop = value; this.scheduleLoop(); }
  connectedCallback() {
    installStyle(this.ownerDocument, 'pixprite-ui-visuals', css);
    this.canvas = this.querySelector(':scope > canvas') ?? this.ownerDocument.createElement('canvas');
    if (!this.canvas.parentElement) this.append(this.canvas);
    this.resize?.disconnect();
    this.resize = new ResizeObserver(() => this.redraw());
    this.resize.observe(this);
    this.redraw(); this.scheduleLoop();
  }
  disconnectedCallback() {
    this.resize?.disconnect(); this.resize = undefined;
    this.ownerDocument.defaultView?.cancelAnimationFrame(this.frame); this.frame = 0;
    this.cleanup?.(); this.cleanup = undefined;
  }
  connectedMoveCallback() { }
  protected fit() {
    const canvas = this.canvas;
    if (!canvas) return false;
    const r = this.getBoundingClientRect(), width = Math.round(r.width), height = Math.round(r.height);
    const k = this.hidpi ? this.ownerDocument.defaultView?.devicePixelRatio ?? 1 : 1;
    const w = Math.round(width * k), h = Math.round(height * k);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    return w > 0 && h > 0;
  }
  redraw() {
    if (!this.fit() || !this.canvas) return;
    const ctx = this.canvas.getContext('2d'); if (!ctx) return;
    this.cleanup?.(); this.cleanup = undefined;
    this._loop?.(this.canvas, ctx, 0, this.ownerDocument.defaultView?.performance.now() ?? 0);
    const cleanup = this._draw?.(this.canvas, ctx);
    if (typeof cleanup === 'function') this.cleanup = cleanup;
  }
  private scheduleLoop() {
    const win = this.ownerDocument.defaultView;
    if (!win) return;
    win.cancelAnimationFrame(this.frame); this.frame = 0; this.last = 0;
    if (!this._loop || !this.isConnected) return;
    const tick = (time: number) => {
      if (!this.isConnected || !this._loop) return;
      const canvas = this.canvas, ctx = canvas?.getContext('2d');
      if (canvas && ctx && this.fit()) this._loop(canvas, ctx, this.last ? time - this.last : 0, time);
      this.last = time; this.frame = win.requestAnimationFrame(tick);
    };
    this.frame = win.requestAnimationFrame(tick);
  }
}

export class PxGridPattern extends PxCanvas {
  static observedAttributes = ['size', 'dark', 'light'];
  connectedCallback() { super.connectedCallback(); this.draw = (canvas, ctx) => {
    const size = Math.max(1, Number(this.getAttribute('size')) || 16);
    const dark = this.getAttribute('dark') ?? '#555', light = this.getAttribute('light') ?? '#aaa';
    ctx.fillStyle = dark; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = light;
    for (let y = 0; y < canvas.height; y += size) for (let x = 0; x < canvas.width; x += size) if ((x / size + y / size) % 2 === 1) ctx.fillRect(x, y, size, size);
  }; }
  attributeChangedCallback() { this.redraw(); }
}

export type IconArtwork = { pixels: string } | { size: number; paths: { d: string; fill?: string; stroke?: string; strokeWidth?: number }[] };
const ns = 'http://www.w3.org/2000/svg';
const fills: Record<string, string> = { '#': 'currentColor', o: 'var(--icon-fill)', '+': 'var(--accent)' };
const ink = (value: string | undefined, fallback: string) => value === 'foreground' ? 'currentColor' : value === 'accent' ? 'var(--accent)' : value === 'fill' ? 'var(--icon-fill)' : value ?? fallback;
export class PxIcon extends HTMLElement {
  private _artwork?: IconArtwork;
  private _pixels = '#';
  private _scale: 'tool' | 'glyph' | number = 'tool';
  static observedAttributes = ['name', 'pack', 'scale', 'pixels'];
  get artwork() { return this._artwork; }
  set artwork(value: IconArtwork | undefined) { this._artwork = value; this.render(); }
  get pixels() { return this._pixels; }
  set pixels(value: string) { this._pixels = value; this.render(); }
  get scale() { return this._scale; }
  set scale(value: 'tool' | 'glyph' | number) { this._scale = value; this.render(); }
  connectedCallback() { installStyle(this.ownerDocument, 'pixprite-ui-visuals', css); this.render(); }
  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === 'pixels') this._pixels = value ?? '#';
    if (name === 'scale') this._scale = value === 'glyph' || value === 'tool' ? value : Number(value) || 'tool';
    this.render();
  }
  render() {
    if (!this.isConnected) return;
    const base = this._pixels.trim().split('\n').map(r => r.trim());
    const w = Math.max(1, ...base.map(r => r.length)), h = Math.max(1, base.length);
    const art = this._artwork;
    const pixel = art && 'pixels' in art ? art.pixels : art && 'paths' in art ? null : this._pixels;
    const svg = this.ownerDocument.createElementNS(ns, 'svg');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    svg.dataset.icon = this.getAttribute('name') ?? ''; svg.dataset.iconPack = this.getAttribute('pack') ?? '';
    svg.dataset.iconStyle = pixel !== null ? 'pixel' : 'vector';
    svg.style.display = 'block'; svg.style.flexShrink = '0';
    const scale = this._scale;
    svg.style.width = typeof scale === 'number' ? `${w * scale}px` : `calc(var(--${scale === 'tool' ? 'tool-icon' : 'glyph'}) * ${w}px)`;
    svg.style.height = typeof scale === 'number' ? `${h * scale}px` : `calc(var(--${scale === 'tool' ? 'tool-icon' : 'glyph'}) * ${h}px)`;
    if (pixel !== null) {
      const rows = pixel.trim().split('\n').map(r => r.trim());
      svg.setAttribute('viewBox', `0 0 ${Math.max(1, ...rows.map(r => r.length))} ${rows.length}`); svg.setAttribute('shape-rendering', 'crispEdges');
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length;) {
          const c = row[x]; if (!fills[c]) { x++; continue; }
          let length = 1; while (row[x + length] === c) length++;
          const rect = this.ownerDocument.createElementNS(ns, 'rect');
          for (const [key, value] of Object.entries({ x, y, width: length, height: 1, fill: fills[c] })) rect.setAttribute(key, String(value));
          svg.append(rect); x += length;
        }
      });
    } else if (art && 'paths' in art) {
      svg.setAttribute('viewBox', `0 0 ${art.size} ${art.size}`); svg.setAttribute('shape-rendering', 'geometricPrecision');
      for (const p of art.paths) {
        const path = this.ownerDocument.createElementNS(ns, 'path');
        for (const [key, value] of Object.entries({ d: p.d, fill: ink(p.fill, 'none'), stroke: ink(p.stroke, 'currentColor'), 'stroke-width': p.strokeWidth ?? 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(key, String(value));
        svg.append(path);
      }
    }
    this.replaceChildren(svg);
  }
}

const vertex = `#version 300 es
precision highp float;out vec2 fragCoord;void main(){int id=gl_VertexID;fragCoord=vec2(id&1,id>1);gl_Position=vec4(fragCoord*2.-1.,0,1);}`;
const prefix = `#version 300 es
precision highp float;uniform vec2 iResolution;uniform vec4 iMouse;uniform float iTime;uniform float iFrame;in vec2 fragCoord;out vec4 fragColor;void mainFrag(out vec4 color,in vec2 uv);void main(){mainFrag(fragColor,fragCoord);}\n`;
const contexts = new WeakMap<Document, { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext | null }>();
export type Uniforms = Record<string, number | Iterable<number>>;
export const DEFAULT_SHADER = 'void mainFrag(out vec4 color,in vec2 uv){color=vec4(uv,0,1);}';
export class PxShader extends PxCanvas {
  private _shader = DEFAULT_SHADER;
  private _uniforms: Uniforms = {};
  private program?: WebGLProgram;
  private programContext?: WebGL2RenderingContext;
  drawFallback?: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  get shader() { return this._shader; }
  set shader(value: string) { if (this._shader !== value) { this.disposeProgram(); this._shader = value; } this.redraw(); }
  get uniforms() { return this._uniforms; }
  set uniforms(value: Uniforms) { this._uniforms = value; this.redraw(); }
  connectedCallback() { super.connectedCallback(); this.draw = (canvas, ctx) => this.paint(canvas, ctx); }
  disconnectedCallback() { super.disconnectedCallback(); this.disposeProgram(); }
  private disposeProgram() { if (this.program) this.programContext?.deleteProgram(this.program); this.program = undefined; this.programContext = undefined; }
  private paint(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    let entry = contexts.get(this.ownerDocument);
    if (!entry) {
      const offscreen = this.ownerDocument.createElement('canvas');
      let gl: WebGL2RenderingContext | null = null;
      try { gl = offscreen.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false }); } catch { /* Canvas fallback */ }
      contexts.set(this.ownerDocument, entry = { canvas: offscreen, gl });
    }
    const { gl } = entry;
    if (!gl || gl.isContextLost()) { this.drawFallback?.(ctx, canvas.width, canvas.height); return; }
    if (this.program && !gl.isProgram(this.program)) this.disposeProgram();
    if (!this.program) {
      this.program = shaderProgram(gl, vertex, prefix + this._shader);
      this.programContext = gl;
      if (!this.program) { this.drawFallback?.(ctx, canvas.width, canvas.height); return; }
    }
    entry.canvas.width = canvas.width; entry.canvas.height = canvas.height;
    gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(this.program);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const uniformTypes = new Map<string, number>();
    for (let i = 0; i < Number(gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS)); i++) {
      const info = gl.getActiveUniform(this.program, i);
      if (info) uniformTypes.set(info.name.replace(/\[0\]$/, ''), info.type);
    }
    for (const [name, value] of Object.entries({ iResolution: [canvas.width, canvas.height], ...this._uniforms })) {
      const location = gl.getUniformLocation(this.program, name); if (location === null) continue;
      const type = uniformTypes.get(name), data = typeof value === 'number' ? [value] : Array.from(value);
      if (type === gl.INT || type === gl.BOOL || type === gl.SAMPLER_2D || type === gl.SAMPLER_CUBE) gl.uniform1iv(location, data);
      else if (type === gl.INT_VEC2 || type === gl.BOOL_VEC2) gl.uniform2iv(location, data);
      else if (type === gl.INT_VEC3 || type === gl.BOOL_VEC3) gl.uniform3iv(location, data);
      else if (type === gl.INT_VEC4 || type === gl.BOOL_VEC4) gl.uniform4iv(location, data);
      else if (type === gl.FLOAT_MAT2) gl.uniformMatrix2fv(location, false, data);
      else if (type === gl.FLOAT_MAT3) gl.uniformMatrix3fv(location, false, data);
      else if (type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(location, false, data);
      else if (type === gl.FLOAT_VEC2) gl.uniform2fv(location, data);
      else if (type === gl.FLOAT_VEC3) gl.uniform3fv(location, data);
      else if (type === gl.FLOAT_VEC4) gl.uniform4fv(location, data);
      else gl.uniform1fv(location, data);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(entry.canvas, 0, 0);
  }
}

const gradientFragment = `uniform vec4 a,b,c,d;
vec3 hsv(vec3 c){vec4 k=vec4(1.,2./3.,1./3.,3.);vec3 p=abs(fract(c.xxx+k.xyz)*6.-k.www);return c.z*mix(k.xxx,clamp(p-k.xxx,0.,1.),c.y);}
void mainFrag(out vec4 color,in vec2 uv){vec4 p=mix(mix(a,b,uv.x),mix(c,d,uv.x),uv.y);TRANSFORM;color=vec4(hsv(p.xyz),p.w);}`;
export class PxGradient extends PxShader {
  private _gradient: GradientCorners = {};
  private _hsl = false;
  get gradient() { return this._gradient; }
  set gradient(value: GradientCorners) { this._gradient = value; this.updateGradient(); }
  get hsl() { return this._hsl; }
  set hsl(value: boolean) { this._hsl = value; this.updateGradient(); }
  connectedCallback() { super.connectedCallback(); this.updateGradient(); }
  private updateGradient() {
    this.drawFallback = (ctx, width, height) => ctx.putImageData(new ImageData(gradientPixels(width, height, this._gradient, this._hsl), width, height), 0, 0);
    this.shader = gradientFragment.replace('TRANSFORM', this._hsl ? 'float v=p.z+p.y*min(p.z,1.-p.z);p.y=v==0.?0.:2.*(1.-p.z/v);p.z=v' : '');
    this.uniforms = { a: [0, 0, 0, 0], b: [0, 0, 0, 0], c: [0, 0, 0, 0], d: [0, 0, 0, 0], ...this._gradient };
  }
}

export function registerVisuals(registry: CustomElementRegistry = customElements) {
  for (const [name, element] of [['px-canvas', PxCanvas], ['px-grid-pattern', PxGridPattern], ['px-icon', PxIcon], ['px-shader', PxShader], ['px-gradient', PxGradient]] as const) defineElement(name, element, registry);
}
