import React from "react";
import { Check, Copy, CornerUpLeft, Film, Loader2, Pencil, Star, Trash2, X, Search } from "lucide-react";
import { GalleryHistory } from "../tools/GalleryHistory";
import { notify, notifyError } from "../../lib/notify";
import { SortMenu } from "./SortMenu";
import { ShareMenu } from "./ShareMenu";
import { iconBtn, fieldCls } from "./shared";
import { ACCENT, Kind, api, postJson } from "./types";

export interface PromptItem {
  id: number; kind: Kind; mode: string; workflow: string; prompt: string; negative: string; params: Record<string, any>;
  file: string; url: string; exists: boolean; favorite: boolean; notes: string; tags: string; createdAt: number;
}

const SORTS = [{ key: "new", label: "Newest first" }, { key: "old", label: "Oldest first" }, { key: "az", label: "Prompt A → Z" }, { key: "fav", label: "Favourites first" }];
const MODE_LABEL: Record<string, string> = { cloud: "Cloud", quick: "Quick", workflow: "Workflow" };
const isVideoUrl = (u: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(decodeURIComponent(u));

/**
 * History: the prompt library (every prompt that made an image or video, with its picture) and the raw files.
 * Search, sort, favourite, edit, copy, delete the entry, or press "Use" to put the prompt back into the studio.
 */
export function HistoryPanel({ kind, refreshKey, onUse }: { kind: Kind; refreshKey: number; onUse: (item: PromptItem) => void }) {
  const a = ACCENT[kind];
  const field = fieldCls(a.ring);
  const [tab, setTab] = React.useState<"prompts" | "files">("prompts");
  const [items, setItems] = React.useState<PromptItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [search, setSearch] = React.useState("");
  const [sort, setSort] = React.useState("new");
  const [onlyFav, setOnlyFav] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [editing, setEditing] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState({ prompt: "", negative: "", notes: "", tags: "" });
  const [zoom, setZoom] = React.useState<PromptItem | null>(null);
  const reqId = React.useRef(0);

  const query = (offset: number) => `/api/prompts?kind=${kind}&q=${encodeURIComponent(search)}&sort=${sort}&favorite=${onlyFav ? 1 : 0}&limit=40&offset=${offset}`;
  const load = React.useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const d = await api<{ items: PromptItem[]; total: number }>(query(0));
      if (id === reqId.current) { setItems(d.items); setTotal(d.total); }
    } catch (e: any) { notifyError(e.message, kind); }
    finally { if (id === reqId.current) setLoading(false); }
  }, [kind, search, sort, onlyFav]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { const t = setTimeout(load, search ? 220 : 0); return () => clearTimeout(t); }, [load, refreshKey]);

  const more = async () => {
    setLoading(true);
    try { const d = await api<{ items: PromptItem[]; total: number }>(query(items.length)); setItems(p => [...p, ...d.items]); setTotal(d.total); }
    finally { setLoading(false); }
  };
  const patch = async (id: number, body: Partial<PromptItem>) => {
    try { const u = await api<PromptItem>(`/api/prompts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setItems(p => p.map(x => x.id === id ? u : x)); return true; }
    catch (e: any) { notifyError(e.message, kind); return false; }
  };
  const remove = async (it: PromptItem) => {
    if (!window.confirm("Remove this prompt from the library? The picture or video file stays on disk.")) return;
    await api(`/api/prompts/${it.id}`, { method: "DELETE" }).catch(() => {});
    setItems(p => p.filter(x => x.id !== it.id)); setTotal(t => t - 1);
  };
  const startEdit = (it: PromptItem) => { setEditing(it.id); setDraft({ prompt: it.prompt, negative: it.negative, notes: it.notes, tags: it.tags }); };
  const saveEdit = async () => { if (editing !== null && draft.prompt.trim() && await patch(editing, draft as any)) setEditing(null); };
  const reveal = async (it: PromptItem) => { const name = it.file.split(String.fromCharCode(92)).join("/").split("/").pop() || ""; await postJson("/api/gallery/reveal", { kind, file: name }).catch(() => postJson("/api/tool/reveal", { path: it.file })).catch(() => {}); };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); notify({ message: "Prompt copied", tab: kind }); } catch { notifyError("Could not copy", kind); } };

  const tabBtn = (t: "prompts" | "files", text: string) => (
    <button onClick={() => setTab(t)} className={`px-3.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${tab === t ? a.chip : "text-zinc-500 hover:text-zinc-300"}`}>{text}</button>
  );
  const meta = (it: PromptItem) => [MODE_LABEL[it.mode] || it.mode, it.workflow, it.params?.size, it.params?.seconds ? `${it.params.seconds}s` : "", new Date(it.createdAt).toLocaleDateString()].filter(Boolean).join(" · ");

  return (
    <div className="rounded-3xl border border-white/5 bg-black/20 p-4 lg:flex-1 lg:min-h-0 lg:overflow-y-auto space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex gap-1 p-1 rounded-xl bg-white/5">{tabBtn("prompts", "Prompts")}{tabBtn("files", "Files")}</div>
        {tab === "prompts" && (
          <>
            <div className="flex-1 min-w-[160px] relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search prompts, notes, tags, workflows..." className={`${field} !pl-8`} />
            </div>
            <button onClick={() => setOnlyFav(f => !f)} title="Favourites only" className={`${iconBtn} ${onlyFav ? "!bg-amber-500/20 !text-amber-400" : ""}`}><Star size={14} className={onlyFav ? "fill-current" : ""} /></button>
            <SortMenu options={SORTS} sort={sort} onSort={setSort} search={search} onSearch={setSearch} title="Sort by" />
          </>
        )}
      </div>

      {tab === "files" ? <GalleryHistory kind={kind} refreshKey={refreshKey} /> : (
        <>
          <p className="text-[11px] text-zinc-500">{total} prompt{total === 1 ? "" : "s"}{search ? ` matching "${search}"` : ""}{onlyFav ? " · favourites" : ""}</p>
          {!loading && items.length === 0 && <p className="text-sm text-zinc-600 py-10 text-center">{search || onlyFav ? "Nothing matches." : "Prompts you generate with appear here, with their pictures, so you can search and reuse them."}</p>}
          <div className="grid gap-3 xl:grid-cols-2">
            {items.map(it => (
              <div key={it.id} className="flex gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-3">
                <button onClick={() => it.exists && setZoom(it)} className="w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-white/5 flex items-center justify-center text-zinc-600">
                  {it.exists ? (isVideoUrl(it.url) || it.kind === "video" ? <video src={it.url} muted className="w-full h-full object-cover" /> : <img src={it.url} alt="" loading="lazy" className="w-full h-full object-cover" />) : <Film size={20} />}
                </button>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {editing === it.id ? (
                    <div className="space-y-2">
                      <textarea autoFocus value={draft.prompt} onChange={e => setDraft(d => ({ ...d, prompt: e.target.value }))} rows={3} className={`${field} resize-y`} />
                      <input value={draft.negative} onChange={e => setDraft(d => ({ ...d, negative: e.target.value }))} placeholder="Negative prompt" className={field} />
                      <div className="grid grid-cols-2 gap-2">
                        <input value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Notes" className={field} />
                        <input value={draft.tags} onChange={e => setDraft(d => ({ ...d, tags: e.target.value }))} placeholder="Tags (comma separated)" className={field} />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveEdit} disabled={!draft.prompt.trim()} className={`flex items-center gap-1.5 ${a.solid} text-white text-[11px] font-bold px-3 py-1.5 rounded-lg disabled:opacity-40`}><Check size={12} /> Save</button>
                        <button onClick={() => setEditing(null)} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 text-[11px] font-bold px-3 py-1.5 rounded-lg"><X size={12} /> Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-[13px] text-zinc-200 leading-snug line-clamp-3 break-words">{it.prompt}</p>
                      {it.negative && <p className="text-[11px] text-zinc-500 line-clamp-1">Avoid: {it.negative}</p>}
                      {(it.notes || it.tags) && <p className="text-[11px] text-zinc-500 line-clamp-1">{it.tags && <span className={a.text}>{it.tags} </span>}{it.notes}</p>}
                      <p className="text-[10px] text-zinc-600 truncate">{meta(it)}</p>
                      <div className="flex items-center gap-1 pt-0.5">
                        <button onClick={() => patch(it.id, { favorite: !it.favorite })} title={it.favorite ? "Remove from favourites" : "Add to favourites"} className={`${iconBtn} !p-1.5 ${it.favorite ? "!text-amber-400" : ""}`}><Star size={13} className={it.favorite ? "fill-current" : ""} /></button>
                        <button onClick={() => onUse(it)} title="Use this prompt again" className={`${iconBtn} !p-1.5 flex items-center gap-1 text-[11px] font-semibold !px-2.5`}><CornerUpLeft size={13} /> Use</button>
                        <button onClick={() => startEdit(it)} title="Edit" className={`${iconBtn} !p-1.5`}><Pencil size={13} /></button>
                        <button onClick={() => copy(it.prompt)} title="Copy the prompt" className={`${iconBtn} !p-1.5`}><Copy size={13} /></button>
                        {it.exists && <ShareMenu kind={kind} url={it.url} caption={it.prompt} onReveal={() => reveal(it)} tab={kind} />}
                        <button onClick={() => remove(it)} title="Remove from the library" className={`${iconBtn} !p-1.5 hover:!text-red-400`}><Trash2 size={13} /></button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          {loading && <div className="flex justify-center py-4 text-zinc-500"><Loader2 size={18} className="animate-spin" /></div>}
          {!loading && items.length < total && <button onClick={more} className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold">Load more ({total - items.length} left)</button>}
        </>
      )}

      {zoom && (
        <div className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-6" onClick={() => setZoom(null)}>
          {zoom.kind === "video" || isVideoUrl(zoom.url) ? <video src={zoom.url} controls autoPlay loop className="max-w-full max-h-full rounded-xl" onClick={e => e.stopPropagation()} /> : <img src={zoom.url} alt="" className="max-w-full max-h-full rounded-xl" />}
        </div>
      )}
    </div>
  );
}
