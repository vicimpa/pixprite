/**
 * AI assistant panel: chat with an OpenAI-compatible model that can look at and edit the sprite
 * through function calls (see tools.ts). Endpoint, model and key live in the extension storage.
 * Requests go through `ctx.net.fetch`, so only hosts from the manifest's `network:` permissions work.
 */
import { connect } from "@pixprite/api";
import { makeTools, TOOL_SCHEMAS } from "./tools";

const ctx = await connect();
const { t } = ctx.i18n;

type Settings = { endpoint: string; model: string; key: string; };
const DEFAULTS: Settings = { endpoint: 'https://api.deepseek.com', model: 'deepseek-chat', key: '' };
/** Tool rounds per user message before we stop the model */
const MAX_ROUNDS = 8;

type Message =
  | { role: 'system' | 'user'; content: string; }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; }
  | { role: 'tool'; tool_call_id: string; content: string; };
type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string; }; };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const log = $('log'), text = $<HTMLTextAreaElement>('text'), send = $<HTMLButtonElement>('send');
const tools = makeTools(ctx);

let settings: Settings = { ...DEFAULTS, ...(await ctx.storage.get<Partial<Settings>>('settings').catch(() => undefined)) };
let history: Message[] = [];
let busy = false;

const system = (): Message => ({ role: 'system', content: t('system', { lang: ctx.i18n.lang }) });

function labels() {
  $('settings').textContent = t('settings');
  $('clear').textContent = t('clear');
  send.textContent = t('send');
  text.placeholder = t('placeholder');
  $('model').textContent = settings.key ? `${settings.model} · ${new URL(settings.endpoint).host}` : t('noKey');
}

function add(kind: string, content: string, image?: Blob) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  el.textContent = content;
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
  ]);
  if (!v) return;
  settings = { endpoint: String(v.endpoint || DEFAULTS.endpoint).replace(/\/+$/, ''), model: String(v.model || DEFAULTS.model), key: String(v.key ?? '').trim() };
  await ctx.storage.set('settings', settings);
  labels();
}

async function complete(messages: Message[]): Promise<Extract<Message, { role: 'assistant'; }>> {
  const res = await ctx.net.fetch(`${settings.endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.key}` },
    body: JSON.stringify({ model: settings.model, messages, tools: TOOL_SCHEMAS, tool_choice: 'auto' }),
  });
  const body = new TextDecoder().decode(res.body);
  if (res.status >= 400) throw new Error(t('error.http', { status: res.status, body: body.slice(0, 300) }));
  const msg = JSON.parse(body).choices?.[0]?.message;
  if (!msg) throw new Error(t('error.empty'));
  return { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls?.length ? msg.tool_calls : undefined };
}

async function ask(prompt: string) {
  if (!settings.key) { await editSettings(); if (!settings.key) return; }
  busy = true;
  send.disabled = true;
  history.push({ role: 'user', content: prompt });
  add('user', prompt);
  const thinking = add('tool', t('thinking'));
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await complete([system(), ...history]);
      history.push(reply);
      if (reply.content) add('assistant', reply.content);
      if (!reply.tool_calls) return;
      for (const call of reply.tool_calls) {
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
    }
    add('error', t('error.rounds', { count: MAX_ROUNDS }));
  } catch (e) {
    add('error', e instanceof Error ? e.message : String(e));
  } finally {
    thinking.remove();
    busy = false;
    send.disabled = false;
  }
}

$('form').addEventListener('submit', e => {
  e.preventDefault();
  const prompt = text.value.trim();
  if (!prompt || busy) return;
  text.value = '';
  ask(prompt);
});
text.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $<HTMLFormElement>('form').requestSubmit(); }
});
$('settings').addEventListener('click', editSettings);
$('clear').addEventListener('click', () => { history = []; log.replaceChildren(); });
ctx.i18n.on('change', labels);
labels();
