import React from "react";
import { AlertTriangle, Check, Cloud, Download, ExternalLink, Link2, Loader2, Search } from "lucide-react";

interface HubItem {
  source: "official" | "civitai"; id: string; title: string; description: string; category: string;
  thumb: string | null; tags: string[]; online?: boolean; downloads?: number; files?: { name: string; url: string; sizeKB: number }[];
}
interface Saved { name: string; ui: string | null; api: string | null; note: string }

const SOURCES = [
  { id: "official", label: "ComfyUI templates", note: "The official template library (Comfy-Org on GitHub)." },
  { id: "civitai", label: "Civitai", note: "Workflows people share on Civitai. Most come as a zip; every workflow in it is saved." },
  { id: "url", label: "Paste a link", note: "A .json or .zip link, a GitHub page of a workflow, or a Civitai model page." },
] as const;

/**
 * Find ComfyUI workflows on the internet and download them into ComfyUI's workflow folder, each with an
 * API-format copy (API_FORMAT) made next to it, so ComfyUI, this app and other tools can all use them.
 */
export function WorkflowHub() {
  const [source, setSource] = React.useState<"official" | "civitai" | "url">("official");
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<HubItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [done, setDone] = React.useState<Record<string, Saved[] | string>>({});
  const [link, setLink] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [civKey, setCivKey] = React.useState<boolean | null>(null);
  const [keyDraft, setKeyDraft] = React.useState("");
  React.useEffect(() => { fetch("/api/workflow-hub/civitai-key").then(r => r.json()).then(d => setCivKey(!!d.set)).catch(() => {}); }, []);
  const saveKey = async () => { const d = await (await fetch("/api/workflow-hub/civitai-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: keyDraft }) })).json(); setCivKey(!!d.set); setKeyDraft(""); };

  React.useEffect(() => {
    if (source === "url") return;
    setLoading(true); setError("");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/workflow-hub/search?source=${source}&q=${encodeURIComponent(q)}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setItems(d.items || []); setTotal(d.total || (d.items || []).length);
      } catch (e: any) { setItems([]); setError(e?.message || String(e)); } finally { setLoading(false); }
    }, q ? 450 : 0);
    return () => clearTimeout(t);
  }, [source, q]);

  const download = async (key: string, body: object) => {
    setBusy(b => ({ ...b, [key]: true }));
    try {
      const r = await fetch("/api/workflow-hub/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setDone(x => ({ ...x, [key]: d.saved }));
    } catch (e: any) { setDone(x => ({ ...x, [key]: e?.message || String(e) })); } finally { setBusy(b => ({ ...b, [key]: false })); }
  };

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))];
  const shown = category ? items.filter(i => i.category === category) : items;
  const result = (key: string) => {
    const r = done[key];
    if (!r) return null;
    if (typeof r === "string") return <p className="flex items-start gap-1.5 text-[11px] text-rose-300"><AlertTriangle size={12} className="mt-0.5 shrink-0" />{r}</p>;
    return (
      <div className="space-y-0.5 text-[11px]">
        {r.map(s => (
          <p key={s.name} className="text-emerald-300"><Check size={11} className="mr-1 inline" />Saved "{s.name}"{s.ui && s.api ? " (browser + API)" : s.api ? " (API only)" : " (browser only)"}{s.note && <span className="block text-amber-300/90">{s.note}</span>}</p>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {SOURCES.map(s => <button key={s.id} onClick={() => { setSource(s.id); setCategory(""); }} title={s.note} className={`rounded-xl px-3 py-1.5 text-[11px] font-bold ${source === s.id ? "bg-white text-black" : "bg-white/5 text-zinc-400 hover:bg-white/10"}`}>{s.label}</button>)}
        {source !== "url" && (
          <div className="relative ml-auto w-full sm:w-72">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={source === "official" ? "Search templates (flux, wan, upscale, audio...)" : "Search Civitai workflows"} className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-xs text-white placeholder:text-zinc-500 focus:outline-none" />
          </div>
        )}
      </div>
      {(source === "civitai" || source === "url") && civKey === false && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200">
          <span>Civitai only lets files be downloaded with a free API key: make one at <a href="https://civitai.com/user/account" target="_blank" rel="noreferrer" className="underline">civitai.com - Account settings - API keys</a>, then paste it here. It stays on this PC.</span>
          <input type="password" value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder="Civitai API key" autoComplete="off" className="w-56 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white focus:outline-none" />
          <button onClick={saveKey} disabled={!keyDraft.trim()} className="rounded-lg bg-amber-500/30 px-2.5 py-1 font-bold hover:bg-amber-500/40 disabled:opacity-40">Save</button>
        </div>
      )}
      {(source === "civitai" || source === "url") && civKey && <p className="text-[11px] text-zinc-500">Civitai key saved. <button onClick={async () => { await fetch("/api/workflow-hub/civitai-key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "" }) }); setCivKey(false); }} className="underline hover:text-zinc-300">Remove it</button></p>}
      <p className="text-[11px] text-zinc-500">{SOURCES.find(s => s.id === source)!.note} Downloads go into ComfyUI's workflow folder, with an API copy in API_FORMAT. A workflow may need models or custom nodes you do not have yet; the note under it says which nodes.</p>

      {source === "url" ? (
        <div className="space-y-2 rounded-2xl border border-white/5 bg-white/[0.03] p-4">
          <div className="flex gap-2">
            <div className="relative flex-1"><Link2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" /><input value={link} onChange={e => setLink(e.target.value)} placeholder="https://github.com/.../workflow.json  or  https://civitai.com/models/12345" className="w-full rounded-xl border border-white/10 bg-white/5 py-2 pl-8 pr-3 text-xs text-white placeholder:text-zinc-500 focus:outline-none" /></div>
            <button onClick={() => download("url:" + link, { url: link })} disabled={!link.trim() || busy["url:" + link]} className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-40">{busy["url:" + link] ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}Download</button>
          </div>
          {result("url:" + link)}
        </div>
      ) : (
        <>
          {categories.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setCategory("")} className={`rounded-lg px-2.5 py-1 text-[10px] font-bold ${!category ? "bg-violet-600 text-white" : "bg-white/5 text-zinc-400"}`}>All ({items.length})</button>
              {categories.map(c => <button key={c} onClick={() => setCategory(c)} className={`rounded-lg px-2.5 py-1 text-[10px] font-bold ${category === c ? "bg-violet-600 text-white" : "bg-white/5 text-zinc-400"}`}>{c}</button>)}
            </div>
          )}
          {loading && <p className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 size={13} className="animate-spin" />Looking...</p>}
          {error && <p className="text-xs text-rose-300">{error}</p>}
          {!loading && !error && !shown.length && <p className="text-xs text-zinc-500">Nothing found.</p>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.map(it => {
              const key = `${it.source}:${it.id}`;
              return (
                <div key={key} className="flex gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-3">
                  {it.thumb ? <img src={it.thumb} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-xl object-cover bg-black/30" onError={e => { (e.target as HTMLImageElement).style.visibility = "hidden"; }} /> : <div className="h-20 w-20 shrink-0 rounded-xl bg-white/5" />}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-bold text-zinc-100" title={it.title}>{it.title}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-widest text-zinc-500">
                      <span>{it.category}</span>
                      {it.online && <span className="flex items-center gap-1 text-sky-400" title="Uses paid online API nodes (needs a Comfy account with credits)"><Cloud size={10} />online</span>}
                      {it.downloads ? <span>{it.downloads.toLocaleString()} downloads</span> : null}
                    </p>
                    <p className="line-clamp-2 text-[11px] text-zinc-400" title={it.description}>{it.description}</p>
                    <div className="flex items-center gap-2 pt-1">
                      <button onClick={() => download(key, it.source === "official" ? { source: "official", id: it.id } : { source: "civitai", id: it.id, url: `https://civitai.com/models/${it.id}`, name: it.title })} disabled={busy[key]} className="flex items-center gap-1.5 rounded-lg bg-violet-600/80 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-violet-500 disabled:opacity-40">{busy[key] ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}Download</button>
                      <a href={it.source === "civitai" ? `https://civitai.com/models/${it.id}` : `https://github.com/Comfy-Org/workflow_templates/blob/main/templates/${it.id}.json`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200"><ExternalLink size={11} />Open</a>
                    </div>
                    {result(key)}
                  </div>
                </div>
              );
            })}
          </div>
          {source === "official" && total > shown.length && !category && <p className="text-[11px] text-zinc-500">Showing {shown.length} of {total}; search to narrow it down.</p>}
        </>
      )}
    </div>
  );
}
