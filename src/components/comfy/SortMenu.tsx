import React from "react";
import { ArrowUpDown, Check, Search, X } from "lucide-react";
import { iconBtn } from "./shared";

export interface SortOption { key: string; label: string }

/**
 * Phone-style sort button: just an icon; tapping it opens a small menu with the sort choices (a check marks the current
 * one) and a search box on top. The icon shows a dot while a search text is active.
 */
export function SortMenu({ options, sort, onSort, search, onSearch, title = "Sort and search" }: { options: SortOption[]; sort: string; onSort: (k: string) => void; search: string; onSearch: (s: string) => void; title?: string }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} title={title} className={`${iconBtn} relative ${open ? "!bg-white/15 !text-white" : ""}`}>
        <ArrowUpDown size={14} />
        {search && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400" />}
      </button>
      {open && (
        <div className="absolute z-50 right-0 mt-2 w-60 rounded-2xl border border-white/15 bg-zinc-950/95 backdrop-blur shadow-2xl shadow-black/60 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/10">
            <Search size={13} className="text-zinc-500 shrink-0" />
            <input autoFocus value={search} onChange={e => onSearch(e.target.value)} placeholder="Search..." className="flex-1 bg-transparent text-xs text-white focus:outline-none placeholder:text-zinc-600" />
            {search && <button onClick={() => onSearch("")} className="text-zinc-500 hover:text-white"><X size={13} /></button>}
          </div>
          <p className="px-3 pt-2.5 pb-1 text-[10px] font-black uppercase tracking-widest text-zinc-600">Sort by</p>
          {options.map(o => (
            <button key={o.key} onClick={() => { onSort(o.key); setOpen(false); }} className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-zinc-200 hover:bg-white/5 transition-colors">
              {o.label}{sort === o.key && <Check size={14} className="text-emerald-400 shrink-0" />}
            </button>
          ))}
          <div className="h-1.5" />
        </div>
      )}
    </div>
  );
}
