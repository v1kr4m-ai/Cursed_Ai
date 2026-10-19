import React from "react";
import { Film, History } from "lucide-react";
import { ACCENT, Kind, api } from "./types";
import { PromptItem } from "./HistoryPanel";

const MODE: Record<string, string> = { cloud: "Cloud", quick: "Quick", workflow: "Workflow" };

/**
 * "Made before with this prompt": whenever the prompt in the box matches one that already produced pictures or clips,
 * they are listed here; clicking one shows it on the stage above.
 */
export function PreviousResults({ kind, prompt, refreshKey, activeUrl, onShow }: { kind: Kind; prompt: string; refreshKey: number; activeUrl?: string | null; onShow: (it: PromptItem) => void }) {
  const a = ACCENT[kind];
  const [items, setItems] = React.useState<PromptItem[]>([]);
  const reqId = React.useRef(0);

  React.useEffect(() => {
    const text = prompt.trim();
    if (!text) { setItems([]); return; }
    const id = ++reqId.current;
    const t = setTimeout(() => {
      api<{ items: PromptItem[] }>(`/api/prompts?kind=${kind}&exact=${encodeURIComponent(text)}&limit=40&sort=new`)
        .then(d => { if (id === reqId.current) setItems(d.items.filter(i => i.exists)); })
        .catch(() => { if (id === reqId.current) setItems([]); });
    }, 300);
    return () => clearTimeout(t);
  }, [kind, prompt, refreshKey]);

  if (!items.length) return null;
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 flex items-center gap-1.5"><History size={12} className={a.text} /> Made before with this prompt · {items.length}</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {items.map(it => (
          <button key={it.id} onClick={() => onShow(it)} title={`${MODE[it.mode] || it.mode}${it.workflow ? " · " + it.workflow : ""} · ${new Date(it.createdAt).toLocaleString()}`}
            className={`shrink-0 w-24 text-left rounded-xl overflow-hidden border-2 transition-all ${activeUrl && (activeUrl === it.url || activeUrl === it.file) ? a.border : "border-transparent opacity-80 hover:opacity-100"}`}>
            <div className="w-24 h-24 bg-white/5 flex items-center justify-center text-zinc-500">
              {kind === "video" ? <video src={it.url} muted preload="metadata" className="w-full h-full object-cover" /> : <img src={it.url} alt="" loading="lazy" className="w-full h-full object-cover" />}
              {kind === "video" && <Film size={14} className="absolute" />}
            </div>
            <p className="text-[10px] text-zinc-500 mt-1 truncate px-0.5">{new Date(it.createdAt).toLocaleDateString()} · {MODE[it.mode] || it.mode}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
