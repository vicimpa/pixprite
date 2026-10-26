/**
 * The bit of Markdown models answer with: paragraphs, headings, lists, quotes, code blocks and
 * **bold** / *italic* / `code` / ~~strike~~ inside lines. Built from DOM nodes, never innerHTML,
 * so a reply can't inject markup; links are shown as text (a sandboxed panel can't open them).
 */

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, ...children: (Node | string)[]) => {
  const e = document.createElement(tag);
  e.append(...children);
  return e;
};

/** Longest first: `**` before `*`, so bold isn't read as two italics; `2*3*4` and `snake_case` stay as they are */
const INLINE = /(`+)([^`]+?)\1|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|(?<![\w*])\*([^*\s][^*]*?)\*(?![\w*])|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function inline(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, ticks, code, bold, bold2, strike, em, em2, label, url] = m;
    if (ticks) out.push(el('code', code));
    else if (bold ?? bold2) out.push(el('strong', ...inline(bold ?? bold2)));
    else if (strike) out.push(el('s', ...inline(strike)));
    else if (em ?? em2) out.push(el('em', ...inline(em ?? em2)));
    else if (label) out.push(el('span', ...inline(label), el('span', ` (${url})`)));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

export function markdown(src: string): DocumentFragment {
  const root = document.createDocumentFragment();
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const p = el('p');
    para.forEach((l, i) => { if (i) p.append(el('br')); p.append(...inline(l)); });
    root.append(p);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i]);
      root.append(el('pre', el('code', body.join('\n'))));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      root.append(el(`h${Math.min(6, heading[1].length + 2)}` as 'h3', ...inline(heading[2])));
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); root.append(el('hr')); continue; }
    if (line.startsWith('>')) {
      flush();
      const body: string[] = [];
      for (; i < lines.length && lines[i].startsWith('>'); i++) body.push(lines[i].replace(/^>\s?/, ''));
      i--;
      root.append(el('blockquote', markdown(body.join('\n'))));
      continue;
    }
    if (LIST.test(line)) {
      flush();
      i = list(lines, i, root) - 1;
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    para.push(line);
  }
  flush();
  return root;
}

/** A list from line `i` (nested by indent); returns the index of the first line after it */
function list(lines: string[], i: number, parent: Node): number {
  const [, indent, marker] = lines[i].match(LIST)!;
  const ordered = /\d/.test(marker);
  const ul = el(ordered ? 'ol' : 'ul');
  if (ordered && parseInt(marker) !== 1) ul.setAttribute('start', String(parseInt(marker)));
  let item: HTMLLIElement | null = null;
  while (i < lines.length) {
    const m = lines[i].match(LIST);
    if (m && m[1].length > indent.length && item) { i = list(lines, i, item); continue; }
    // A list of the other kind (bullets after numbers) starts anew
    if (m && m[1].length === indent.length && /\d/.test(m[2]) === ordered) {
      item = el('li', ...inline(m[3]));
      ul.append(item);
      i++;
      continue;
    }
    // A wrapped line of the item (indented text) continues it
    if (item && lines[i].trim() && /^\s+/.test(lines[i]) && !m) { item.append(' ', ...inline(lines[i].trim())); i++; continue; }
    break;
  }
  parent.appendChild(ul);
  return i;
}
