/**
 * AI assistant panel: chat with an OpenAI-compatible model that can look at and edit the sprite
 * through function calls (see tools.ts). Endpoint, model and key live in the extension storage.
 * Requests go through `ctx.net.fetch`, so only hosts from the manifest's `network:` permissions work.
 */
import { connect, type DocumentInfo } from "@pixprite/api";
import { markdown } from "./markdown";
import { makeTools, TOOL_SCHEMAS } from "./tools";

const ctx = await connect();
const { t } = ctx.i18n;

type Settings = { endpoint: string; model: string; key: string; follow: boolean; maxRounds: number; };
const DEFAULTS: Settings = { endpoint: 'https://api.deepseek.com', model: 'deepseek-chat', key: '', follow: true, maxRounds: 50 };
/**
 * Each project has its own chats: the list under `chats:<project>`, the messages of one under
 * `chat:<project>:<id>`; a chat is kept under the storage limit (4 MB) by dropping its oldest turns
 */
const listKey = (project: string) => `chats:${project}`;
const chatKey = (project: string, id: string) => `chat:${project}:${id}`;
const MAX_HISTORY = 2 << 20;
/** Chat titles are taken from the first message */
const TITLE_LENGTH = 48;

type Message =
  | { role: 'system' | 'user'; content: string; }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; }
  | { role: 'tool'; tool_call_id: string; content: string; };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string; }; };
type Chat = { id: string; title: string; updated: number; };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = $('log'), text = $<HTMLTextAreaElement>('text'), send = $<HTMLButtonElement>('send');
const queueEl = $('queue'), drawer = $('drawer'), list = $('list'), toggle = $<HTMLButtonElement>('chats'), newChat = $<HTMLButtonElement>('new');
const tools = makeTools(ctx, () => settings.follow);

let settings: Settings = { ...DEFAULTS, ...(await ctx.storage.get<Partial<Settings>>('settings').catch(() => undefined)) };
let history: Message[] = [];
/** Chats of the current project, newest first */
let chats: Chat[] = [];
/** The open chat; null for a new one that isn't stored until its first message */
let chat: Chat | null = null;
/** The open document the conversation belongs to; null on the home page */
let doc: DocumentInfo | null = null;
/** The active document changed during a reply: switch once it is over */
let switchPending = false;
let busy = false;
/** Set by the Stop button; checked between requests and tool calls (a request in flight can't be cancelled) */
let stopped = false;
/**
 * Messages written during a reply, sent one by one when it ends. A stop or an error holds them:
 * Send with an empty field sends the next one
 */
let queue: string[] = [];

const system = (): Message => ({ role: 'system', content: t('system', { lang: ctx.i18n.lang }) });

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
/** Local servers (Ollama, LM Studio) work without a key */
const ready = () => !!settings.key || /^(localhost|127\.0\.0\.1)(:|$)/.test(hostOf(settings.endpoint));

function labels() {
  $('settings').title = t('settings');
  toggle.title = t('chats');
  newChat.title = t('newChat');
  $('title').textContent = chat?.title ?? t('newChat');
  $('drawer-title').textContent = t('chats');
  send.textContent = busy ? t('stop') : t('send');
  send.title = busy ? t('stop') : `${t('send')} (Enter)`;
  text.placeholder = t('placeholder');
  $('hint').textContent = t('hint');
  $('model').textContent = ready() ? `${settings.model} · ${hostOf(settings.endpoint)}` : t('noKey');
}

function add(kind: string, content: string, image?: Blob) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  if (kind === 'assistant') el.append(markdown(content));
  else el.textContent = content;
  if (image) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(image);
    el.append(img);
  }
  log.append(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

async function editSettings() {
  const v = await ctx.ui.showForm(t('settings'), [
    { key: 'endpoint', type: 'text', label: t('form.endpoint'), default: settings.endpoint },
    { key: 'model', type: 'text', label: t('form.model'), default: settings.model },
    { key: 'key', type: 'text', label: t('form.key'), default: settings.key },
    { key: 'follow', type: 'checkbox', label: t('form.follow'), default: settings.follow },
    // A safety net against a model stuck in a loop (each round is a paid request); 0 = none
    { key: 'maxRounds', type: 'number', label: t('form.maxRounds'), min: 0, max: 1000, default: settings.maxRounds },
  ]);
  if (!v) return;
  settings = {
    endpoint: String(v.endpoint || DEFAULTS.endpoint).replace(/\/+$/, ''), model: String(v.model || DEFAULTS.model),
    key: String(v.key ?? '').trim(), follow: v.follow !== false,
    maxRounds: Math.max(0, Math.round(Number(v.maxRounds) || 0)),
  };
  await ctx.storage.set('settings', settings);
  labels();
}

/**
 * Cuts a saved conversation before tool calls left without answers (the page was closed mid-reply):
 * the API rejects such a history
 */
function unbroken(list: Message[]) {
  const answered = new Set(list.map(m => m.role === 'tool' ? m.tool_call_id : null));
  const broken = list.findIndex(m => m.role === 'assistant' && m.tool_calls?.some(c => !answered.has(c.id)));
  return broken < 0 ? list : list.slice(0, broken);
}

/** Saves the open chat (creating it on its first message); the oldest turns go when it outgrows the limit */
async function save() {
  if (!doc || !history.length) return;
  await follow();
  while (JSON.stringify(history).length > MAX_HISTORY) {
    const next = history.findIndex((m, i) => i > 0 && m.role === 'user');
    history = next > 0 ? history.slice(next) : [];
  }
  if (!chat) {
    const first = (history.find(m => m.role === 'user')?.content ?? '').replace(/\s+/g, ' ').trim() ?? '';
    chat = { id: crypto.randomUUID(), title: first.length > TITLE_LENGTH ? `${first.slice(0, TITLE_LENGTH - 1)}…` : first || t('newChat'), updated: 0 };
  }
  chat.updated = Date.now();
  chats = [chat, ...chats.filter(c => c.id !== chat!.id)];
  await Promise.all([
    ctx.storage.set(chatKey(doc.project, chat.id), history),
    ctx.storage.set(listKey(doc.project), chats),
  ]).catch(e => console.warn('ai-assistant: chat not saved', e));
  labels();
  renderList();
}

/** An unsaved document gets its lasting project key when first saved: its chats move along */
async function follow() {
  const now = await ctx.documents.active().catch(() => null);
  if (!doc || now?.id !== doc.id || now.project === doc.project) return;
  const from = doc.project;
  for (const c of chats) {
    const messages = await ctx.storage.get(chatKey(from, c.id)).catch(() => undefined);
    if (messages) await ctx.storage.set(chatKey(now.project, c.id), messages);
    await ctx.storage.delete(chatKey(from, c.id)).catch(() => { });
  }
  await ctx.storage.set(listKey(now.project), chats);
  await ctx.storage.delete(listKey(from)).catch(() => { });
  doc = now;
}

/** Shows the chats of the active document, opening the latest one */
async function load(next: DocumentInfo | null) {
  doc = next;
  chats = doc ? await ctx.storage.get<Chat[]>(listKey(doc.project)).catch(() => undefined) ?? [] : [];
  if (doc && !chats.length) await migrate(doc.project);
  await open(chats[0] ?? null);
}

/** The single conversation per project of the previous version becomes its first chat */
async function migrate(project: string) {
  const old = await ctx.storage.get<Message[]>(`history:${project}`).catch(() => undefined);
  if (!old?.length) return;
  history = old;
  chat = null;
  await save();
  await ctx.storage.delete(`history:${project}`).catch(() => { });
}

/** Opens a chat of the current project; null starts a new one */
async function open(next: Chat | null) {
  chat = next;
  queue = [];
  renderQueue();
  history = doc && chat ? unbroken(await ctx.storage.get<Message[]>(chatKey(doc.project, chat.id)).catch(() => undefined) ?? []) : [];
  log.replaceChildren();
  replay();
  labels();
  renderList();
  showList(false);
}

async function remove(c: Chat) {
  if (!doc || !await ctx.ui.confirm(t('deleteChat', { title: c.title }))) return;
  chats = chats.filter(x => x.id !== c.id);
  await ctx.storage.delete(chatKey(doc.project, c.id)).catch(() => { });
  await ctx.storage.set(listKey(doc.project), chats);
  if (chat?.id === c.id) await open(chats[0] ?? null);
  else renderList();
}

async function rename(c: Chat) {
  const title = (await ctx.ui.prompt(t('renameChat'), c.title))?.trim();
  if (!doc || !title) return;
  c.title = title;
  await ctx.storage.set(listKey(doc.project), chats);
  labels();
  renderList();
}

function renderList() {
  list.replaceChildren(...chats.map(c => {
    const row = document.createElement('div');
    row.className = `chat${c.id === chat?.id ? ' active' : ''}`;
    row.title = t('renameHint');
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: c.title });
    const date = Object.assign(document.createElement('span'), {
      className: 'date',
      textContent: ctx.i18n.date(c.updated, Date.now() - c.updated < 864e5 ? { timeStyle: 'short' } : { dateStyle: 'short' }),
    });
    const del = Object.assign(document.createElement('button'), { className: 'del', textContent: '×', title: t('deleteChatTitle') });
    del.addEventListener('click', e => { e.stopPropagation(); void remove(c); });
    row.addEventListener('click', () => { if (!busy && c.id !== chat?.id) void open(c); else showList(false); });
    row.addEventListener('dblclick', () => void rename(c));
    row.append(name, date, del);
    return row;
  }));
  if (!chats.length) list.append(Object.assign(document.createElement('div'), { className: 'empty', textContent: doc ? t('noChats') : t('noDocument') }));
}

function showList(show = drawer.hidden) {
  drawer.hidden = !show;
  toggle.classList.toggle('on', show);
}

/** Shows a saved conversation the way it looked (rendered images are not kept) */
function replay() {
  const failed = new Set(history.filter(m => m.role === 'tool' && m.content.startsWith('{"error"')).map(m => m.role === 'tool' && m.tool_call_id));
  for (const m of history) {
    if (m.role === 'user') add('user', m.content);
    if (m.role !== 'assistant') continue;
    if (m.content) add('assistant', m.content);
    for (const call of m.tool_calls ?? [])
      add('tool', `${failed.has(call.id) ? '✗' : '→'} ${call.function.name}(${call.function.arguments.slice(0, 120)})`);
  }
}

async function complete(messages: Message[]): Promise<Extract<Message, { role: 'assistant'; }>> {
  const res = await ctx.net.fetch(`${settings.endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...settings.key ? { Authorization: `Bearer ${settings.key}` } : {} },
    body: JSON.stringify({ model: settings.model, messages, tools: TOOL_SCHEMAS, tool_choice: 'auto' }),
  });
  const body = new TextDecoder().decode(res.body);
  if (res.status >= 400) throw new Error(t('error.http', { status: res.status, body: body.slice(0, 300) }));
  const msg = JSON.parse(body).choices?.[0]?.message;
  if (!msg) throw new Error(t('error.empty'));
  return { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls?.length ? msg.tool_calls : undefined };
}

/** Sends `prompt`; without one, lets the model go on from where it stopped (after the round limit) */
async function ask(prompt?: string) {
  if (!doc) { add('error', t('noDocument')); return; }
  if (!ready()) { await editSettings(); if (!ready()) return; }
  busy = true;
  stopped = false;
  newChat.disabled = true;
  list.classList.add('locked');
  send.classList.add('stop');
  labels();
  if (prompt !== undefined) {
    history.push({ role: 'user', content: prompt });
    add('user', prompt);
  }
  const thinking = add('tool', t('thinking'));
  let failed = false;
  try {
    const limit = settings.maxRounds || Infinity;
    for (let round = 0; round < limit; round++) {
      const reply = await complete([system(), ...history]);
      // The answer to a stopped request is dropped, so history stays as the user last saw it
      if (stopped) { add('error', t('stopped')); return; }
      history.push(reply);
      await save();
      if (reply.content) add('assistant', reply.content);
      if (!reply.tool_calls) return;
      for (const call of reply.tool_calls) {
        // Every tool call needs an answer, or the next request is rejected
        if (stopped) { history.push({ role: 'tool', tool_call_id: call.id, content: '{"error":"stopped by the user"}' }); continue; }
        const fn = tools[call.function.name];
        add('tool', `→ ${call.function.name}(${call.function.arguments.slice(0, 120)})`);
        let content: string;
        try {
          if (!fn) throw new Error(`unknown tool ${call.function.name}`);
          const out = await fn(JSON.parse(call.function.arguments || '{}'));
          if (out.image) add('tool', t('rendered'), out.image);
          content = out.content;
        } catch (e) {
          content = JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
          add('tool', `✗ ${content}`);
        }
        history.push({ role: 'tool', tool_call_id: call.id, content });
      }
      await save();
      if (stopped) { add('error', t('stopped')); return; }
    }
    paused(limit);
  } catch (e) {
    failed = true;
    add('error', e instanceof Error ? e.message : String(e));
  } finally {
    await save();
    thinking.remove();
    busy = false;
    newChat.disabled = false;
    list.classList.remove('locked');
    send.classList.remove('stop');
    labels();
    if (switchPending) { switchPending = false; await load(await ctx.documents.active().catch(() => null)); }
    else if (!stopped && !failed) next();
  }
}

/** Sends the next queued message */
function next() {
  const prompt = queue.shift();
  renderQueue();
  if (prompt !== undefined) setTimeout(() => void ask(prompt));
}

function renderQueue() {
  queueEl.hidden = !queue.length;
  queueEl.replaceChildren(...queue.map((prompt, i) => {
    const row = Object.assign(document.createElement('div'), { className: 'queued', title: t('queued') });
    const del = Object.assign(document.createElement('button'), { className: 'del', textContent: '×', title: t('unqueue') });
    del.addEventListener('click', () => { queue.splice(i, 1); renderQueue(); });
    row.append(Object.assign(document.createElement('span'), { textContent: prompt }), del);
    return row;
  }));
}

/** The round limit is reached: the model may go on when the user agrees */
function paused(count: number) {
  const el = add('error', t('error.rounds', { count }));
  const go = Object.assign(document.createElement('button'), { className: 'continue', textContent: t('continue') });
  go.addEventListener('click', () => { if (!busy) { el.remove(); void ask(); } });
  el.append(' ', go);
}

// Panels are sandboxed without allow-forms, so a <form> never submits: plain handlers instead
function submit() {
  const prompt = text.value.trim();
  if (!prompt) { if (!busy) next(); return; }
  text.value = '';
  grow();
  if (busy) { queue.push(prompt); renderQueue(); }
  else void ask(prompt);
}

/** The field grows with its text up to a few lines, then scrolls */
function grow() {
  text.style.height = 'auto';
  // border-box with no border: scrollHeight (content + padding) is the full height; CSS caps it
  text.style.height = `${text.scrollHeight}px`;
}

send.addEventListener('click', () => {
  if (busy) { stopped = true; send.textContent = t('stopping'); }
  else submit();
});
text.addEventListener('input', grow);
text.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
});
$('settings').addEventListener('click', editSettings);
toggle.addEventListener('click', () => showList());
newChat.addEventListener('click', () => { if (!busy) void open(null); text.focus(); });
// A reply in progress belongs to the document it started in, so the switch waits for it
ctx.documents.on('change', next => { if (busy) switchPending = true; else void load(next); });
ctx.i18n.on('change', labels);
await load(await ctx.documents.active().catch(() => null));
grow();
// The conversation of the first version was one for all projects
void ctx.storage.delete('history');
