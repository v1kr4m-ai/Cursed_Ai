import React from "react";
import { FolderOpen, Loader2, Wand2, ChevronDown } from "lucide-react";
import { FolderPickerDialog } from "../tools/FolderPickerDialog";
import { notifyError, notify } from "../../lib/notify";
import { ACCENT, Kind, nativeFolder, postJson } from "./types";

interface Row { name: string; status: string; detail: string }

/** Batch-converts UI-format workflow files to API format into another folder (originals are never touched). */
export function Converter({ kind, source, bare }: { kind: Kind; source: string; bare?: boolean }) {
  const a = ACCENT[kind];
  const [open, setOpen] = React.useState(false);
  const [dest, setDest] = React.useState("");
  const [picker, setPicker] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [counts, setCounts] = React.useState<Record<string, number>>({});

  const run = async () => {
    setBusy(true); setRows([]);
    try {
      const d = await postJson("/api/tool/convert-folder", { source, dest });
      setRows(d.results); setCounts(d.counts);
      notify({ message: `Converted ${d.counts.converted || 0} workflow(s)`, tab: kind });
    } catch (e: any) { notifyError(e.message, kind); }
    finally { setBusy(false); }
  };

  return (
    <div className={bare ? "space-y-3" : "glass p-5 rounded-[1.75rem] border-white/5 space-y-4"}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left">
        <span><span className="text-sm font-bold text-white block">Convert workflows to API format</span><span className="text-[11px] text-zinc-500">Batch-convert the folder's UI workflows into a second folder. Originals stay untouched.</span></span>
        <ChevronDown size={14} className={`text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3">
          <p className="text-[11px] text-zinc-600 truncate" title={source}>From: {source}</p>
          <div className="flex gap-2">
            <input value={dest} onChange={e => setDest(e.target.value)} placeholder="Destination folder (must differ from source)" className="flex-1 bg-white/5 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none placeholder:text-zinc-700" />
            <button onClick={async () => { const p = await nativeFolder(dest || source); if (p === undefined) setPicker(true); else if (p) setDest(p); }} className="px-3 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300" title="Browse"><FolderOpen size={14} /></button>
            <button onClick={run} disabled={busy || !dest.trim()} className={`flex items-center gap-2 ${a.solid} text-white text-xs font-bold px-4 rounded-xl disabled:opacity-40`}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Convert</button>
          </div>
          {rows.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-zinc-400">{Object.entries(counts).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(" · ")}</p>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {rows.map(r => <p key={r.name} className={`text-[11px] truncate ${r.status === "converted" ? "text-emerald-400" : r.status === "issues" || r.status === "invalid" ? "text-amber-400" : "text-zinc-500"}`} title={r.detail}>{r.name} - {r.detail}</p>)}
              </div>
            </div>
          )}
        </div>
      )}
      <FolderPickerDialog open={picker} onOpenChange={setPicker} title="Choose destination folder" initialPath={dest || source} onSelect={p => { setDest(p); setPicker(false); }} />
    </div>
  );
}
