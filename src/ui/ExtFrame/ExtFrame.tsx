/**
 * Sandboxed iframe for an extension panel or widget. The page runs with `allow-scripts` only
 * (opaque origin: no access to the editor, its storage or cookies); everything goes through
 * postMessage, which this component forwards to the host's RPC bridge.
 * Before the page's own markup it gets the theme as css variables, the shared kit (ext-ui.css)
 * and `lang` / `dir`; theme changes are pushed live by a tiny injected listener.
 */

import { currentDir, currentLanguage } from "~/core/i18n";
import { state } from "~/core/State";
import { extensionsHost, themeCss } from "~/modules/Extensions/bridge";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState, type CSSProperties, type FC } from "react";

/** Event the injected listener applies: `{ css }` replaces the theme variables */
const THEME_EVENT = 'pixprite:theme';

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The page's html with the editor's head prepended */
function compose(html: string, base: string | null) {
  const kit = new URL('ext-ui.css', document.baseURI).href;
  // Controls the browser draws its own way (select lists) get the editor's look
  const kitJs = new URL('ext-ui.js', document.baseURI).href;
  const head = [
    '<meta charset="utf-8">',
    base ? `<base href="${escapeAttr(base)}">` : '',
    `<style id="pixprite-theme">${themeCss()}</style>`,
    `<link rel="stylesheet" href="${escapeAttr(kit)}">`,
    `<script defer src="${escapeAttr(kitJs)}"></script>`,
    // Applies live theme updates; ignores anything not from the parent
    `<script>addEventListener('message',function(e){if(e.source!==parent)return;var m=e.data;` +
    `if(m&&m.type==='event'&&m.event==='${THEME_EVENT}')document.getElementById('pixprite-theme').textContent=m.data.css;});</script>`,
  ].join('');
  const lang = `lang="${escapeAttr(currentLanguage.peek())}" dir="${currentDir.peek()}"`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${head}`).replace(/<html(?![^>]*\blang=)/i, `<html ${lang}`);
  return `<!doctype html><html ${lang}><head>${head}</head><body>${html}</body></html>`;
}

export type ExtFrameProps = {
  ext: string;
  role: 'panel' | 'widget';
  contribution: string;
  page: string;
  style?: CSSProperties;
  title?: string;
};

const ids = new WeakMap<object, number>();
let nextId = 1;
/** A stable number per extension instance, to remount the iframe when it changes */
function instanceKey(instance: object | null) {
  if (!instance) return 0;
  if (!ids.has(instance)) ids.set(instance, nextId++);
  return ids.get(instance)!;
}

export const ExtFrame: FC<ExtFrameProps> = ({ ext, role, contribution, page, style, title }) => {
  useSignals();
  const host = extensionsHost.value;
  // A restarted (or updated) extension gets a fresh page: the old one talks to the stopped instance
  const instance = host?.instance(ext) ?? null;
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!host) return;
    let alive = true;
    (async () => {
      const html = await host.readText(ext, page);
      // Relative urls in the page (scripts, images) resolve inside the extension when it is served over http
      const url = await host.fileUrl(ext, page).catch(() => null);
      if (alive) setDoc(compose(html, url && /^https?:/.test(url) ? url : null));
    })().catch(e => alive && setError(String(e?.message ?? e)));
    return () => { alive = false; };
  }, [host, instance, ext, page]);

  // Bridge: the host listens to this iframe only and posts to it only
  useEffect(() => {
    const el = frame.current;
    if (!host || !el || !doc) return;
    return host.connectFrame(ext, role, contribution, el);
  }, [host, instance, doc, ext, role, contribution]);

  // Live theme: re-read the variables after the theme stylesheet switched
  const theme = state.prefs.theme;
  useEffect(() => {
    const id = setTimeout(() => frame.current?.contentWindow?.postMessage({ type: 'event', event: THEME_EVENT, data: { css: themeCss() } }, '*'), 50);
    return () => clearTimeout(id);
  }, [theme]);

  if (error) return <div style={{ padding: 6, color: 'var(--danger)', ...style }}>{error}</div>;
  if (!doc) return null;
  return (
    <iframe
      key={instanceKey(instance)}
      ref={frame}
      title={title ?? `${ext}/${contribution}`}
      sandbox="allow-scripts"
      srcDoc={doc}
      style={{ border: 'none', display: 'block', background: 'transparent', colorScheme: 'normal', ...style }}
    />
  );
};
