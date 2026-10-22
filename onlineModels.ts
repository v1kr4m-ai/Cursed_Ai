/**
 * Online chat models from other companies, configured in Settings: ChatGPT (OpenAI), Claude (Anthropic),
 * Grok (xAI), Perplexity, OpenRouter, Mistral, Groq, DeepSeek, and any other service that speaks the OpenAI
 * chat format. Every provider has its own key, address and model list, all editable.
 *
 * Models are used in chat as `online:<provider>:<model>`; answers stream back in the same SSE shape the local
 * models use. Keys live in config.json (never sent back to the browser) or in the provider's usual environment
 * variable. Nothing here runs unless the person picks one of these models.
 */
import type express from "express";
import type { Response } from "express";

export type Kind = "openai" | "anthropic";

export interface Preset {
  id: string;
  label: string;
  kind: Kind;
  baseUrl: string;
  models: string[];
  webUrl: string;
  keyUrl: string;
  env: string;
  note?: string;
}

/** Defaults only: the address and model list of each can be changed in Settings, and "Fetch" reads the live list. */
export const PRESETS: Preset[] = [
  { id: "openai", label: "ChatGPT (OpenAI)", kind: "openai", baseUrl: "https://api.openai.com/v1", models: ["gpt-4o", "gpt-4o-mini", "o4-mini"], webUrl: "https://chatgpt.com", keyUrl: "https://platform.openai.com/api-keys", env: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Claude (Anthropic)", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", models: ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"], webUrl: "https://claude.ai", keyUrl: "https://console.anthropic.com/settings/keys", env: "ANTHROPIC_API_KEY" },
  { id: "xai", label: "Grok (xAI)", kind: "openai", baseUrl: "https://api.x.ai/v1", models: ["grok-4", "grok-3-mini"], webUrl: "https://grok.com", keyUrl: "https://console.x.ai", env: "XAI_API_KEY" },
  { id: "perplexity", label: "Perplexity", kind: "openai", baseUrl: "https://api.perplexity.ai", models: ["sonar", "sonar-pro", "sonar-reasoning"], webUrl: "https://www.perplexity.ai", keyUrl: "https://www.perplexity.ai/settings/api", env: "PERPLEXITY_API_KEY", note: "Answers with live web search; sources are listed under the answer." },
  { id: "openrouter", label: "OpenRouter (many models)", kind: "openai", baseUrl: "https://openrouter.ai/api/v1", models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "meta-llama/llama-3.3-70b-instruct"], webUrl: "https://openrouter.ai", keyUrl: "https://openrouter.ai/keys", env: "OPENROUTER_API_KEY" },
  { id: "mistral", label: "Mistral", kind: "openai", baseUrl: "https://api.mistral.ai/v1", models: ["mistral-large-latest", "mistral-small-latest"], webUrl: "https://chat.mistral.ai", keyUrl: "https://console.mistral.ai/api-keys", env: "MISTRAL_API_KEY" },
  { id: "groq", label: "Groq (fast open models)", kind: "openai", baseUrl: "https://api.groq.com/openai/v1", models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"], webUrl: "https://groq.com", keyUrl: "https://console.groq.com/keys", env: "GROQ_API_KEY" },
  { id: "deepseek", label: "DeepSeek", kind: "openai", baseUrl: "https://api.deepseek.com/v1", models: ["deepseek-chat", "deepseek-reasoner"], webUrl: "https://chat.deepseek.com", keyUrl: "https://platform.deepseek.com/api_keys", env: "DEEPSEEK_API_KEY" },
];

/** What is saved for a provider; anything missing falls back to the preset. */
export interface ProviderConfig {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  models?: string[];
  /** Custom providers only. */
  custom?: boolean;
  label?: string;
  kind?: Kind;
  webUrl?: string;
}

export type OnlineStore = Record<string, ProviderConfig>;

export interface Resolved {
  id: string;
  label: string;
  kind: Kind;
  baseUrl: string;
  models: string[];
  webUrl: string;
  keyUrl: string;
  note?: string;
  custom: boolean;
  enabled: boolean;
  key: string | undefined;
  keySource: "env" | "saved" | null;
  defaults: { baseUrl: string; models: string[] };
}

const clean = (u: string) => u.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "").replace(/\/messages$/, "");

export function resolveAll(store: OnlineStore): Resolved[] {
  const out: Resolved[] = PRESETS.map(p => {
    const c = store[p.id] || {};
    const env = process.env[p.env];
    return {
      id: p.id, label: p.label, kind: p.kind, baseUrl: clean(c.baseUrl || p.baseUrl), models: c.models?.length ? c.models : p.models,
      webUrl: p.webUrl, keyUrl: p.keyUrl, note: p.note, custom: false, enabled: c.enabled ?? !!(c.apiKey || env),
      key: c.apiKey || env || undefined, keySource: c.apiKey ? "saved" : env ? "env" : null,
      defaults: { baseUrl: p.baseUrl, models: p.models },
    };
  });
  for (const [id, c] of Object.entries(store)) {
    if (!c.custom) continue;
    out.push({
      id, label: c.label || id, kind: c.kind || "openai", baseUrl: clean(c.baseUrl || ""), models: c.models || [], webUrl: c.webUrl || "", keyUrl: "",
      custom: true, enabled: c.enabled ?? true, key: c.apiKey || undefined, keySource: c.apiKey ? "saved" : null,
      defaults: { baseUrl: c.baseUrl || "", models: c.models || [] },
    });
  }
  return out;
}

export const resolveOne = (store: OnlineStore, id: string) => resolveAll(store).find(p => p.id === id);

const pub = (p: Resolved) => ({ id: p.id, label: p.label, kind: p.kind, baseUrl: p.baseUrl, models: p.models, webUrl: p.webUrl, keyUrl: p.keyUrl, note: p.note, custom: p.custom, enabled: p.enabled, keySet: !!p.key, keySource: p.keySource, defaults: p.defaults });

/** Converts "data:image/png;base64,..." into its media type and payload. */
const parseDataUrl = (u: string) => { const m = /^data:([^;,]+);base64,(.*)$/s.exec(u); return m ? { type: m[1], data: m[2] } : { type: "image/png", data: u }; };

function openaiMessages(messages: any[]) {
  return messages.map(m => {
    const imgs: string[] = Array.isArray(m.images) ? m.images : [];
    if (!imgs.length) return { role: m.role, content: m.content };
    return { role: m.role, content: [{ type: "text", text: m.content }, ...imgs.map(u => ({ type: "image_url", image_url: { url: u.startsWith("data:") ? u : `data:image/png;base64,${u}` } }))] };
  });
}

function anthropicParts(messages: any[]) {
  const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const turns = messages.filter(m => m.role !== "system").map(m => {
    const imgs: string[] = Array.isArray(m.images) ? m.images : [];
    const role = m.role === "assistant" ? "assistant" : "user";
    if (!imgs.length) return { role, content: m.content };
    return { role, content: [...imgs.map(u => { const d = parseDataUrl(u); return { type: "image", source: { type: "base64", media_type: d.type, data: d.data } }; }), { type: "text", text: m.content }] };
  });
  return { system, turns };
}

const headersFor = (p: Resolved) => p.kind === "anthropic"
  ? { "Content-Type": "application/json", "x-api-key": p.key || "", "anthropic-version": "2023-06-01" }
  : { "Content-Type": "application/json", Authorization: `Bearer ${p.key || ""}` };

async function failure(p: Resolved, r: globalThis.Response): Promise<Error> {
  const body = (await r.text().catch(() => "")).slice(0, 300);
  const hint = r.status === 401 || r.status === 403 ? " Check the API key in Settings > Integrations > Online models." : r.status === 404 ? " Check the address and the model name." : r.status === 429 ? " Rate limit or no credit left on that account." : "";
  return new Error(`${p.label} said no (${r.status}).${hint} ${body}`.trim());
}

/** Streams an answer from one provider into the SSE shape /api/chat uses (`data: {"token": "..."}`). */
export async function streamOnline(p: Resolved, model: string, messages: any[], options: { temperature?: number; maxTokens?: number } | undefined, res: Response, signal: AbortSignal) {
  if (!p.key) throw new Error(`No API key for ${p.label}. Add one in Settings > Integrations > Online models.`);
  if (!p.baseUrl) throw new Error(`${p.label} has no address set.`);
  const send = (token: string) => res.write(`data: ${JSON.stringify({ token })}\n\n`);
  const temperature = options?.temperature ?? 0.8;
  const maxTokens = options?.maxTokens ?? 4096;

  let r: globalThis.Response;
  try {
    if (p.kind === "anthropic") {
      const { system, turns } = anthropicParts(messages);
      r = await fetch(`${p.baseUrl}/messages`, { method: "POST", signal, headers: headersFor(p), body: JSON.stringify({ model, max_tokens: maxTokens, temperature: Math.min(1, temperature), stream: true, ...(system ? { system } : {}), messages: turns }) });
    } else {
      r = await fetch(`${p.baseUrl}/chat/completions`, { method: "POST", signal, headers: headersFor(p), body: JSON.stringify({ model, messages: openaiMessages(messages), temperature, max_tokens: maxTokens, stream: true }) });
    }
  } catch (e: any) {
    if (signal.aborted) return;
    throw new Error(`Could not reach ${p.label} (${e.message}). Check your internet connection and the address in Settings.`);
  }
  if (!r.ok || !r.body) throw await failure(p, r);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let citations: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        if (p.kind === "anthropic") {
          if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) send(j.delta.text);
          else if (j.type === "error") throw new Error(j.error?.message || "The provider reported an error.");
        } else {
          const token = j.choices?.[0]?.delta?.content;
          if (typeof token === "string" && token) send(token);
          if (Array.isArray(j.citations) && j.citations.length) citations = j.citations;
          if (j.error) throw new Error(j.error.message || "The provider reported an error.");
        }
      } catch (e: any) { if (e?.message && !/JSON|Unexpected/i.test(e.message)) throw e; /* a partial frame - the next chunk completes it */ }
    }
  }
  if (citations.length) send(`\n\nSources:\n${citations.map((u, i) => `${i + 1}. ${u}`).join("\n")}`);
}

/** Asks the provider for its model list; when it has none, a one-token question proves the key and address work. */
async function probe(p: Resolved): Promise<{ ok: boolean; models: string[]; error?: string }> {
  if (!p.key) return { ok: false, models: [], error: "No API key saved." };
  if (!p.baseUrl) return { ok: false, models: [], error: "No address set." };
  try {
    const r = await fetch(`${p.baseUrl}/models${p.kind === "anthropic" ? "?limit=100" : ""}`, { headers: headersFor(p), signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const j: any = await r.json();
      const list: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
      const models = list.map(m => String(m.id || m.name || "")).filter(Boolean).sort();
      if (models.length) return { ok: true, models };
    } else if (r.status === 401 || r.status === 403) {
      return { ok: false, models: [], error: `The provider rejected the key (${r.status}).` };
    }
  } catch (e: any) { return { ok: false, models: [], error: `Could not reach ${p.baseUrl} (${e.message}).` }; }
  const model = p.models[0];
  if (!model) return { ok: false, models: [], error: "The provider has no model list; add a model name and test again." };
  try {
    const r = p.kind === "anthropic"
      ? await fetch(`${p.baseUrl}/messages`, { method: "POST", headers: headersFor(p), signal: AbortSignal.timeout(20000), body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }) })
      : await fetch(`${p.baseUrl}/chat/completions`, { method: "POST", headers: headersFor(p), signal: AbortSignal.timeout(20000), body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }) });
    if (r.ok) return { ok: true, models: [] };
    return { ok: false, models: [], error: (await failure(p, r)).message };
  } catch (e: any) { return { ok: false, models: [], error: `Could not reach ${p.baseUrl} (${e.message}).` }; }
}

export function registerOnlineModels(app: express.Express, opts: { get: () => OnlineStore; set: (s: OnlineStore) => void }) {
  const save = (mutate: (s: OnlineStore) => void) => { const s = { ...opts.get() }; mutate(s); opts.set(s); };

  app.get("/api/online/providers", (_req, res) => res.json({ providers: resolveAll(opts.get()).map(pub) }));

  app.put("/api/online/providers/:id", (req, res) => {
    const p = resolveOne(opts.get(), req.params.id);
    if (!p) return res.status(404).json({ error: "No such provider." });
    const b = req.body || {};
    save(s => {
      const c: ProviderConfig = { ...(s[p.id] || {}) };
      if (typeof b.enabled === "boolean") c.enabled = b.enabled;
      if (typeof b.apiKey === "string") { const k = b.apiKey.trim(); if (k) c.apiKey = k; else delete c.apiKey; }
      if (typeof b.baseUrl === "string") { const u = clean(b.baseUrl); if (u && u !== p.defaults.baseUrl) c.baseUrl = u; else if (!c.custom) delete c.baseUrl; else c.baseUrl = u; }
      if (Array.isArray(b.models)) { const m = [...new Set(b.models.map((x: any) => String(x).trim()).filter(Boolean))] as string[]; if (c.custom || JSON.stringify(m) !== JSON.stringify(p.defaults.models)) c.models = m; else delete c.models; }
      if (c.custom) { if (typeof b.label === "string" && b.label.trim()) c.label = b.label.trim(); if (b.kind === "openai" || b.kind === "anthropic") c.kind = b.kind; if (typeof b.webUrl === "string") c.webUrl = b.webUrl.trim(); }
      s[p.id] = c;
    });
    res.json({ provider: pub(resolveOne(opts.get(), p.id)!) });
  });

  /** A provider of your own: anything that answers like OpenAI's chat API (a local server, a company gateway). */
  app.post("/api/online/providers", (req, res) => {
    const b = req.body || {};
    const label = String(b.label || "").trim();
    const baseUrl = clean(String(b.baseUrl || ""));
    if (!label || !/^https?:\/\//i.test(baseUrl)) return res.status(400).json({ error: "Give it a name and an address that starts with http:// or https://." });
    const id = "custom-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
    if (resolveOne(opts.get(), id)) return res.status(400).json({ error: "A provider with that name already exists." });
    save(s => { s[id] = { custom: true, enabled: true, label, baseUrl, kind: b.kind === "anthropic" ? "anthropic" : "openai", models: Array.isArray(b.models) ? b.models.map((m: any) => String(m).trim()).filter(Boolean) : [], apiKey: String(b.apiKey || "").trim() || undefined, webUrl: String(b.webUrl || "").trim() }; });
    res.json({ provider: pub(resolveOne(opts.get(), id)!) });
  });

  /** Custom providers are removed; a built-in one only forgets its key and changes. */
  app.delete("/api/online/providers/:id", (req, res) => {
    const p = resolveOne(opts.get(), req.params.id);
    if (!p) return res.status(404).json({ error: "No such provider." });
    save(s => { delete s[p.id]; });
    const again = resolveOne(opts.get(), p.id);
    res.json({ removed: !again, provider: again ? pub(again) : null });
  });

  app.post("/api/online/providers/:id/test", async (req, res) => {
    const p = resolveOne(opts.get(), req.params.id);
    if (!p) return res.status(404).json({ error: "No such provider." });
    res.json(await probe(p));
  });
}
