import React from "react";
import { Check, ChevronDown, Cloud, ExternalLink, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { notify, notifyError } from "../../lib/notify";

/**
 * Settings > Integrations > Online models: ChatGPT, Claude, Grok, Perplexity and others. Each provider has its own
 * key, address and model list. Picked in chat like any other model, they send that chat to the provider.
 */

interface Provider {
  id: string; label: string; kind: "openai" | "anthropic"; baseUrl: string; models: string[]; webUrl: string; keyUrl: string; note?: string;
  custom: boolean; enabled: boolean; keySet: boolean; keySource: "env" | "saved" | null; defaults: { baseUrl: string; models: string[] };
}

const inputCls = "w-full bg-white/5 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500 placeholder:text-zinc-700";
const btn = "flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold disabled:opacity-40 transition-colors";

async function call<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d as T;
}

const changed = () => window.dispatchEvent(new Event("cursed:models-changed"));

function Card({ p, onChange, onRemoved }: { p: Provider; onChange: (p: Provider) => void; onRemoved: (id: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [key, setKey] = React.useState("");
  const [url, setUrl] = React.useState(p.baseUrl);
  const [models, setModels] = React.useState(p.models.join(", "));
  const [busy, setBusy] = React.useState("");
  const [result, setResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  React.useEffect(() => { setUrl(p.baseUrl); setModels(p.models.join(", ")); }, [p.baseUrl, p.models]);

  const parse = (t: string) => t.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  const put = async (body: Record<string, unknown>, what: string) => {
    setBusy(what);
    try { const d = await call<{ provider: Provider }>(`/api/online/providers/${p.id}`, "PUT", body); onChange(d.provider); changed(); return d.provider; }
    catch (e: any) { notifyError(e.message); return null; }
    finally { setBusy(""); }
  };

  const saveKey = async () => { if (await put({ apiKey: key.trim(), enabled: true }, "key")) { setKey(""); notify({ message: `${p.label}: key saved` }); } };
  const test = async () => {
    setBusy("test"); setResult(null);
    try {
      const d = await call<{ ok: boolean; models: string[]; error?: string }>(`/api/online/providers/${p.id}/test`, "POST");
      setResult(d.ok ? { ok: true, text: d.models.length ? `Works. The provider lists ${d.models.length} models.` : "Works." } : { ok: false, text: d.error || "It did not work." });
      return d;
    } catch (e: any) { setResult({ ok: false, text: e.message }); return null; }
    finally { setBusy(""); }
  };
  const fetchModels = async () => {
    const d = await test();
    if (d?.ok && d.models.length) { setModels(d.models.join(", ")); await put({ models: d.models }, "models"); notify({ message: `${p.label}: ${d.models.length} models loaded` }); }
    else if (d?.ok) setResult({ ok: true, text: "Works, but this provider has no model list. Type the model names yourself, separated by commas." });
  };
  const remove = async () => {
    if (!confirm(p.custom ? `Remove ${p.label}?` : `Forget the key and changes for ${p.label}?`)) return;
    try { const d = await call<{ removed: boolean; provider: Provider | null }>(`/api/online/providers/${p.id}`, "DELETE"); if (d.removed) onRemoved(p.id); else if (d.provider) onChange(d.provider); changed(); }
    catch (e: any) { notifyError(e.message); }
  };

  return (
    <div className="py-3">
      <div className="flex items-center gap-3">
        <button onClick={() => setOpen(o => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronDown size={14} className={`shrink-0 text-zinc-500 transition-transform ${open ? "" : "-rotate-90"}`} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-zinc-100">{p.label}</p>
            <p className="truncate text-xs text-zinc-500">{p.keySet ? `${p.models.length} model${p.models.length === 1 ? "" : "s"}${p.keySource === "env" ? " - key from the environment" : ""}` : "No key yet"}</p>
          </div>
        </button>
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${p.keySet && p.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-zinc-500"}`}>{p.keySet && p.enabled ? "On" : "Off"}</span>
        <button onClick={() => put({ enabled: !p.enabled }, "enabled")} disabled={!p.keySet || !!busy} role="switch" aria-checked={p.enabled} title={p.keySet ? "Show or hide its models in chat" : "Add a key first"}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${p.enabled && p.keySet ? "bg-violet-600" : "bg-white/10"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${p.enabled && p.keySet ? "left-[1.375rem]" : "left-0.5"}`} />
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4 pl-7">
          {p.note && <p className="text-xs text-zinc-500">{p.note}</p>}

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-zinc-500">API key</label>
            <div className="flex gap-2">
              <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={p.keySet ? "Paste a new key to replace it" : "Paste your key"} autoComplete="off" spellCheck={false} className={`${inputCls} font-mono`} />
              <button onClick={saveKey} disabled={!key.trim() || !!busy} className={btn}>{busy === "key" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}Save</button>
              {p.keySource === "saved" && <button onClick={() => put({ apiKey: "" }, "key")} disabled={!!busy} className={btn} title="Remove the saved key"><X size={13} />Clear</button>}
            </div>
            <p className="mt-1 text-[11px] text-zinc-600">Kept on this PC in config.json and never sent back to the browser. {p.keyUrl && <a href={p.keyUrl} target="_blank" rel="noreferrer" className="text-violet-400 hover:underline">Get a key</a>}</p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Address (API base URL)</label>
            <div className="flex gap-2">
              <input value={url} onChange={e => setUrl(e.target.value)} onBlur={() => url.trim() !== p.baseUrl && put({ baseUrl: url }, "url")} spellCheck={false} className={`${inputCls} font-mono`} />
              {!p.custom && url !== p.defaults.baseUrl && <button onClick={() => { setUrl(p.defaults.baseUrl); put({ baseUrl: p.defaults.baseUrl }, "url"); }} className={btn}>Reset</button>}
            </div>
            <p className="mt-1 text-[11px] text-zinc-600">Change it to use a proxy, a company gateway or another region. It must answer the {p.kind === "anthropic" ? "Anthropic Messages" : "OpenAI chat"} format.</p>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-widest text-zinc-500">Models shown in chat</label>
            <textarea value={models} onChange={e => setModels(e.target.value)} onBlur={() => put({ models: parse(models) }, "models")} rows={2} spellCheck={false} placeholder="model-one, model-two" className={`${inputCls} resize-none font-mono text-xs`} />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={fetchModels} disabled={!p.keySet || !!busy} className={btn} title="Ask the provider which models it offers">{busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}Fetch the model list</button>
              {!p.custom && JSON.stringify(parse(models)) !== JSON.stringify(p.defaults.models) && <button onClick={() => { setModels(p.defaults.models.join(", ")); put({ models: p.defaults.models }, "models"); }} className={btn}>Reset list</button>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={test} disabled={!p.keySet || !!busy} className={btn}>{busy === "test" ? <Loader2 size={13} className="animate-spin" /> : <Cloud size={13} />}Test the connection</button>
            {p.webUrl && <a href={p.webUrl} target="_blank" rel="noreferrer" className={btn}><ExternalLink size={13} />Open the website</a>}
            <button onClick={remove} disabled={!!busy} className={`${btn} ml-auto text-rose-300`}><Trash2 size={13} />{p.custom ? "Remove" : "Forget key and changes"}</button>
          </div>
          {result && <p className={`text-xs leading-relaxed ${result.ok ? "text-emerald-300" : "text-rose-300"}`}>{result.text}</p>}
        </div>
      )}
    </div>
  );
}

function AddCustom({ onAdded }: { onAdded: (p: Provider) => void }) {
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ label: "", baseUrl: "", apiKey: "", models: "", kind: "openai" as "openai" | "anthropic" });
  const [busy, setBusy] = React.useState(false);
  const add = async () => {
    setBusy(true);
    try { const d = await call<{ provider: Provider }>("/api/online/providers", "POST", { ...f, models: f.models.split(/[,\n]/).map(s => s.trim()).filter(Boolean) }); onAdded(d.provider); changed(); setF({ label: "", baseUrl: "", apiKey: "", models: "", kind: "openai" }); setOpen(false); }
    catch (e: any) { notifyError(e.message); } finally { setBusy(false); }
  };
  if (!open) return <div className="py-3"><button onClick={() => setOpen(true)} className={btn}><Plus size={13} />Add another service</button></div>;
  return (
    <div className="space-y-3 py-4">
      <p className="text-sm font-bold text-zinc-100">Another service</p>
      <p className="text-xs text-zinc-500">Anything that answers like OpenAI's chat API works: a company gateway, LiteLLM, vLLM, LM Studio on another PC, Together, Fireworks and so on.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={f.label} onChange={e => setF({ ...f, label: e.target.value })} placeholder="Name (e.g. Together)" className={inputCls} />
        <input value={f.baseUrl} onChange={e => setF({ ...f, baseUrl: e.target.value })} placeholder="https://api.together.xyz/v1" spellCheck={false} className={`${inputCls} font-mono`} />
        <input type="password" value={f.apiKey} onChange={e => setF({ ...f, apiKey: e.target.value })} placeholder="API key (if it needs one)" autoComplete="off" className={`${inputCls} font-mono`} />
        <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value as "openai" | "anthropic" })} className={`${inputCls} [&_*]:bg-white [&_*]:text-black`}><option value="openai">Speaks the OpenAI chat format</option><option value="anthropic">Speaks the Anthropic Messages format</option></select>
      </div>
      <textarea value={f.models} onChange={e => setF({ ...f, models: e.target.value })} rows={2} placeholder="Model names, separated by commas" spellCheck={false} className={`${inputCls} resize-none font-mono text-xs`} />
      <div className="flex gap-2"><button onClick={add} disabled={busy || !f.label.trim() || !f.baseUrl.trim()} className={btn}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}Add</button><button onClick={() => setOpen(false)} className={btn}>Cancel</button></div>
    </div>
  );
}

export function OnlineModelsSettings() {
  const [list, setList] = React.useState<Provider[] | null>(null);
  const [error, setError] = React.useState("");
  React.useEffect(() => { call<{ providers: Provider[] }>("/api/online/providers").then(d => setList(d.providers)).catch(e => setError(e.message)); }, []);
  if (error) return <p className="py-4 text-xs text-rose-300">Could not load the providers: {error}</p>;
  if (!list) return <p className="flex items-center gap-2 py-4 text-xs text-zinc-500"><Loader2 size={13} className="animate-spin" />Loading...</p>;
  return (
    <div className="divide-y divide-white/5">
      {list.map(p => <Card key={p.id} p={p} onChange={n => setList(l => (l || []).map(x => (x.id === n.id ? n : x)))} onRemoved={id => setList(l => (l || []).filter(x => x.id !== id))} />)}
      <AddCustom onAdded={p => setList(l => [...(l || []), p])} />
    </div>
  );
}
