import React from "react";
import { FileText, Upload, ChevronDown, Search, Loader2, AlertTriangle } from "lucide-react";
import { EnhancePromptButton } from "../tools/EnhancePromptButton";
import { ACCENT, Kind, PromptCandidate, PromptColumnInfo, PromptFileResult, api } from "./types";

const FILE_TYPES = ".txt,.md,.docx,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.bmp";

interface Props {
  kind: Kind;
  modelId?: string;
  prompt: string;
  onPrompt: (text: string) => void;
  needsPrompt: boolean;
  /** Every prompt found in the file (spreadsheet column / document headings), for running them all. */
  onCandidates?: (texts: string[]) => void;
}

/**
 * Prompt box + "pull the prompt out of a file": drop a .txt / .md / .docx / .xlsx / .pdf (or an image, read by OCR) and the
 * prompt is found for you. Spreadsheets list every prompt (the column is guessed and can be switched); documents with
 * several "Prompt" headings list each one. You can always edit the text by hand.
 */
export function PromptSource({ kind, modelId, prompt, onPrompt, needsPrompt, onCandidates }: Props) {
  const a = ACCENT[kind];
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [unmatched, setUnmatched] = React.useState(false);
  const [columns, setColumns] = React.useState<PromptColumnInfo[]>([]);
  const [candidates, setCandidates] = React.useState<PromptCandidate[]>([]);
  const [colIdx, setColIdx] = React.useState(0);
  const [picked, setPicked] = React.useState(-1);
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  const popRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!popRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const apply = (r: PromptFileResult) => {
    setUnmatched(!r.matched);
    setColumns(r.columns);
    const cands = r.columns.length ? r.columns[0].candidates : r.candidates;
    setCandidates(cands);
    onCandidates?.(cands.map(c => c.text));
    setColIdx(0);
    setPicked(cands.length ? 0 : -1);
    onPrompt(r.extractedPrompt);
  };

  const readFile = async (file: File) => {
    setBusy(true); setError(null); setFileName(file.name);
    try {
      apply(await api<PromptFileResult>(`/api/tool/prompt-file?name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }));
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const pick = (i: number) => { setPicked(i); onPrompt(candidates[i].text); setOpen(false); setFilter(""); };
  const switchColumn = (idx: number) => {
    setColIdx(idx);
    const cands = columns[idx].candidates;
    setCandidates(cands);
    onCandidates?.(cands.map(c => c.text));
    setPicked(cands.length ? 0 : -1);
    if (cands.length) onPrompt(cands[0].text);
  };

  const shown = candidates.map((c, i) => ({ c, i })).filter(({ c }) => !filter || (c.label + " " + c.text).toLowerCase().includes(filter.toLowerCase()));
  const label = "text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-2 block";

  return (
    <div
      className={`glass p-5 rounded-[1.75rem] border-white/5 space-y-4 transition-all ${dragging ? `ring-2 ${a.border}` : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) readFile(f); }}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white">Prompt</p>
          <p className="text-[11px] text-zinc-500">Type it, or drop a file and the prompt is pulled out of it.</p>
        </div>
        <input ref={fileRef} type="file" accept={FILE_TYPES} hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold px-3.5 py-2 rounded-xl transition-colors shrink-0">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Choose file
        </button>
      </div>

      {fileName && !error && (
        <p className="text-[11px] text-zinc-500 flex items-center gap-1.5"><FileText size={12} /> {fileName}{candidates.length > 0 ? ` - ${candidates.length} prompts found` : ""}</p>
      )}
      {unmatched && <p className="text-[11px] text-amber-400 flex items-center gap-1.5"><AlertTriangle size={12} /> No "Prompt" marker found - showing the whole text. Edit it below.</p>}
      {error && <p className="text-[11px] text-red-400 flex items-center gap-1.5"><AlertTriangle size={12} /> {error}</p>}

      {candidates.length > 1 && (
        <div className="flex flex-wrap gap-2 items-start">
          {columns.length > 1 && (
            <select value={colIdx} onChange={(e) => switchColumn(Number(e.target.value))} className={`bg-white/5 border-none rounded-xl px-3 py-2.5 text-xs text-zinc-200 focus:outline-none focus:ring-1 ${a.ring}`} title="Which column holds the prompts">
              {columns.map((col, i) => <option key={i} value={i} className="bg-zinc-900">{col.header}{col.sheet && columns.some(c => c.sheet !== col.sheet) ? ` (${col.sheet})` : ""}</option>)}
            </select>
          )}
          <div ref={popRef} className="relative flex-1 min-w-[220px]">
            <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 bg-white/5 hover:bg-white/10 rounded-xl px-3.5 py-2.5 text-xs text-zinc-200 text-left transition-colors">
              <span className="truncate">{picked >= 0 ? candidates[picked].label : "Pick a prompt..."}</span>
              <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div className="absolute z-40 left-0 right-0 mt-2 max-h-72 overflow-y-auto bg-zinc-950 border border-white/15 rounded-2xl shadow-2xl shadow-black/60">
                <div className="sticky top-0 bg-zinc-950 p-2 border-b border-white/10 flex items-center gap-2">
                  <Search size={13} className="text-zinc-500 ml-1" />
                  <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search prompts..." className="flex-1 bg-transparent text-xs text-white focus:outline-none placeholder:text-zinc-600" />
                </div>
                {shown.length === 0 && <p className="px-4 py-3 text-xs text-zinc-500">No prompts match.</p>}
                {shown.map(({ c, i }) => (
                  <button key={i} onClick={() => pick(i)} className={`w-full text-left px-4 py-2 hover:bg-white/5 ${i === picked ? "bg-white/[0.07]" : ""}`}>
                    <span className="block text-xs font-semibold text-zinc-100 truncate">{c.label}</span>
                    <span className="block text-[11px] text-zinc-500 truncate">{c.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2"><label className={label + " !mb-0"}>Prompt text</label><EnhancePromptButton kind={kind} prompt={prompt} onPrompt={onPrompt} modelId={modelId} tab={kind} /></div>
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          rows={4}
          placeholder="A robot holding a red skateboard, studio lighting..."
          className={`w-full bg-white/5 border-none rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 ${a.ring} placeholder:text-zinc-700 resize-y`}
        />
        {!needsPrompt && <p className="text-[11px] text-amber-400 mt-2">This workflow takes no text prompt - the box is ignored.</p>}
      </div>
    </div>
  );
}
