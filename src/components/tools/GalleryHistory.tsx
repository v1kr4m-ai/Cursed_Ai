import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { Trash2, FolderOpen, History } from "lucide-react";

interface Item {
  file: string;
  url: string;
  createdAt: number;
}

/**
 * History of generated files saved on disk (outputs/). Images open in an
 * enlarged lightbox on click (shared-element animation) and collapse back
 * when you click anywhere else; every item has delete + open-file-location.
 * Videos play inline.
 */
export function GalleryHistory({ kind, refreshKey }: { kind: "image" | "video"; refreshKey: number }) {
  const [items, setItems] = React.useState<Item[]>([]);
  const [dir, setDir] = React.useState("");
  const [open, setOpen] = React.useState<Item | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const resp = await fetch(`/api/gallery?kind=${kind}`);
      const text = await resp.text();
      let data: any = null;
      try { data = JSON.parse(text); } catch { /* not JSON */ }
      if (!resp.ok || !data) throw new Error("History unavailable - restart the Sunayna server (npm run dev) so it picks up the new version.");
      setItems(data.items || []);
      setDir(data.dir || "");
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, [kind]);

  React.useEffect(() => { load(); }, [load, refreshKey]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const remove = async (item: Item) => {
    if (!window.confirm("Delete this file from disk? This can't be undone.")) return;
    const resp = await fetch(`/api/gallery/${kind}/${encodeURIComponent(item.file)}`, { method: "DELETE" });
    if (!resp.ok) return setError("Delete failed");
    setItems(prev => prev.filter(i => i.file !== item.file));
    setOpen(cur => (cur?.file === item.file ? null : cur));
  };

  const reveal = async (item: Item) => {
    const resp = await fetch("/api/gallery/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, file: item.file }),
    });
    if (!resp.ok) setError("Couldn't open the folder");
  };

  const actions = (item: Item) => (
    <div className="flex gap-2">
      <button onClick={(e) => { e.stopPropagation(); reveal(item); }} title="Open file location"
        className="bg-black/60 hover:bg-black/80 backdrop-blur-md text-zinc-200 p-2 rounded-xl"><FolderOpen size={14} /></button>
      <button onClick={(e) => { e.stopPropagation(); remove(item); }} title="Delete"
        className="bg-black/60 hover:bg-red-600 backdrop-blur-md text-zinc-200 p-2 rounded-xl"><Trash2 size={14} /></button>
    </div>
  );

  return (
    <div>
      <h2 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] flex items-center gap-2 mb-4">
        <History size={12} /> History ({items.length})
        {dir && <span className="normal-case tracking-normal font-mono text-zinc-700 truncate">{dir}</span>}
      </h2>
      {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

      {items.length === 0 ? (
        <p className="text-zinc-600 text-xs text-center py-10">Nothing generated yet — results are saved and listed here.</p>
      ) : kind === "image" ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((item) => (
            <div key={item.file} className="relative group rounded-2xl overflow-hidden glass border-white/5">
              <motion.img
                layoutId={`img-${item.file}`}
                src={item.url}
                alt={item.file}
                onClick={() => setOpen(item)}
                className="w-full aspect-square object-cover cursor-zoom-in"
              />
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">{actions(item)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((item) => (
            <div key={item.file} className="relative group rounded-2xl overflow-hidden glass border-white/5">
              <video src={item.url} controls className="w-full max-h-[260px] bg-black" />
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">{actions(item)}</div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ backgroundColor: "rgba(0,0,0,0)" }}
            animate={{ backgroundColor: "rgba(0,0,0,0.85)" }}
            exit={{ backgroundColor: "rgba(0,0,0,0)" }}
            onClick={() => setOpen(null)}
            className="fixed inset-0 z-50 flex items-center justify-center p-8 cursor-zoom-out"
          >
            <motion.img
              layoutId={`img-${open.file}`}
              src={open.url}
              alt={open.file}
              onClick={() => setOpen(null)}
              className="max-h-full max-w-full rounded-2xl shadow-2xl object-contain"
            />
            <div className="absolute top-6 right-6">{actions(open)}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Small auto-dismissing popup, bottom-right. */
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  React.useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [message, onDone]);
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
          onClick={onDone}
          className="fixed bottom-6 right-6 z-[60] bg-emerald-600 text-white text-sm font-bold px-5 py-3 rounded-2xl shadow-2xl cursor-pointer"
        >{message}</motion.div>
      )}
    </AnimatePresence>
  );
}
