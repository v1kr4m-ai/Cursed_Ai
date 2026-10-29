import React from "react";
import { Cloud, Link2, X, FileText, Upload, ChevronDown, Search, Loader2, AlertTriangle } from "lucide-react";
import { EnhancePromptButton } from "../tools/EnhancePromptButton";
import { DrivePicker, DriveFile } from "./google";
import { ACCENT, Kind, PromptCandidate, PromptColumnInfo, PromptFileResult, api } from "./types";

const FILE_TYPES = ".txt,.md,.csv,.tsv,.rtf,.doc,.docx,.docm,.odt,.xlsx,.xlsm,.pptx,.pptm,.pdf,.png,.jpg,.jpeg,.webp,.bmp";

interface Props {
  kind: Kind;
  modelId?: string;
  prompt: string;
  onPrompt: (text: string) => void;
  needsPrompt: boolean;
  /** Changes after a result is saved, so the "already made" marks refresh. */
  usageKey?: number;
  /** Inside a collapsible panel: no card chrome or heading. */
  bare?: boolean;
  /** Every prompt found in the file (spreadsheet column / document headings), for running them all. */
  onCandidates?: (texts: string[]) => void;
  /** What the box asks for, when it is not a picture description (for example a song's style tags). */
  placeholder?: string;
  /** The name over the box ("Tags" for a song). */
  textLabel?: string;
}

/**
 * Prompt box + "pull the prompt out of a file": drop a .txt / .md / .docx / .xlsx / .pdf (or an image, read by OCR) and the
 * prompt is found for you. Spreadsheets list every prompt (the column is guessed and can be switched); documents with
 * several "Prompt" headings list each one. You can always edit the text by hand.
 */
export function PromptSource({ kind, modelId, prompt, onPrompt, needsPrompt, onCandidates, bare, usageKey = 0, placeholder, textLabel }: Props) {
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

  const apply = (r: PromptFileResult, fillPrompt = true) => {
    setUnmatched(!r.matched);
    setColumns(r.columns);
    const cands = r.columns.length ? r.columns[0].candidates : r.candidates;
    setCandidates(cands);
    onCandidates?.(cands.map(c => c.text));
    setColIdx(0);
    setPicked(cands.length ? 0 : -1);
    if (fillPrompt) onPrompt(r.extractedPrompt);
  };

  // Recently used documents: remembered on the server, one click to reopen; the newest one is restored when the page opens.
  interface RecentDoc { id: string; name: string; source: "file" | "drive" | "link"; at: number; count: number }
  const [recent, setRecent] = React.useState<RecentDoc[]>([]);
  const loadRecent = React.useCallback(() => api<{ docs: RecentDoc[] }>("/api/tool/recent-docs").then(d => setRecent(d.docs)).catch(() => {}), []);
  React.useEffect(() => {
    loadRecent();
    api<{ name: string; result: PromptFileResult } | null>("/api/tool/recent-docs/latest").then(d => { if (d?.result) { setFileName(d.name); apply(d.result, false); } }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const openRecent = async (d: RecentDoc) => {
    setBusy(true); setError(null);
    try { const full = await api<{ name: string; result: PromptFileResult }>(`/api/tool/recent-docs/${d.id}`); setFileName(full.name); apply(full.result); }
    catch (e: any) { setError(e.message); loadRecent(); }
    finally { setBusy(false); }
  };
  const forgetRecent = async (d: RecentDoc) => { await api(`/api/tool/recent-docs/${d.id}`, { method: "DELETE" }).catch(() => {}); loadRecent(); };

  const readFile = async (file: File) => {
    setBusy(true); setError(null); setFileName(file.name);
    try {
      apply(await api<PromptFileResult>(`/api/tool/prompt-file?name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }));
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); loadRecent(); if (fileRef.current) fileRef.current.value = ""; }
  };

  // Google: a file picked from Drive, or a pasted Sheets / Docs / Slides / Drive link.
  const [driveOpen, setDriveOpen] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [link, setLink] = React.useState("");
  const fromGoogle = async (label: string, call: () => Promise<PromptFileResult & { source?: string }>) => {
    setBusy(true); setError(null); setFileName(label);
    try { const r = await call(); if (r.source) setFileName(r.source); apply(r); } catch (e: any) { setError(e.message); }
    finally { setBusy(false); loadRecent(); }
  };
  const readDrive = (f: DriveFile) => { setDriveOpen(false); fromGoogle(f.name, () => api("/api/google/prompt-file", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, name: f.name, mimeType: f.mimeType }) })); };
  const readLink = () => { if (link.trim()) fromGoogle("Google link", () => api("/api/google/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: link.trim() }) })); };

  // Which prompts in the list already produced something (same kind), so they can be marked and optionally hidden.
  const [usage, setUsage] = React.useState<number[]>([]);
  const [hideUsed, setHideUsed] = React.useState(false);
  React.useEffect(() => {
    if (!candidates.length) { setUsage([]); return; }
    let live = true;
    fetch("/api/prompts/usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, prompts: candidates.map(c => c.text) }) })
      .then(r => r.json()).then(d => { if (live && Array.isArray(d.counts)) setUsage(d.counts); }).catch(() => {});
    return () => { live = false; };
  }, [candidates, kind, usageKey]);
  const usedCount = usage.filter(n => n > 0).length;

  const pick = (i: number) => { setPicked(i); onPrompt(candidates[i].text); setOpen(false); setFilter(""); };
  const switchColumn = (idx: number) => {
    setColIdx(idx);
    const cands = columns[idx].candidates;
    setCandidates(cands);
    onCandidates?.(cands.map(c => c.text));
    setPicked(cands.length ? 0 : -1);
    if (cands.length) onPrompt(cands[0].text);
  };

  const shown = candidates.map((c, i) => ({ c, i })).filter(({ i }) => !hideUsed || !usage[i]).filter(({ c }) => !filter || (c.label + " " + c.text).toLowerCase().includes(filter.toLowerCase()));
  const label = "text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-2 block";

  return (
    <div
      className={`${bare ? "rounded-xl" : "glass p-5 rounded-[1.75rem] border-white/5"} space-y-3 transition-all ${dragging ? `ring-2 ${a.border}` : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) readFile(f); }}
    >
      <input ref={fileRef} type="file" accept={FILE_TYPES} hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
      {!bare && (
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-white">Prompt</p>
            <p className="text-[11px] text-zinc-500">Type it, or drop a file and the prompt is pulled out of it.</p>
          </div>
          
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-bold px-3.5 py-2 rounded-xl transition-colors shrink-0">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Choose file
          </button>
        </div>
  
        )}
      {recent.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mr-0.5">Recent</span>
          {recent.slice(0, 5).map(d => (
            <span key={d.id} className="group inline-flex items-center max-w-[11rem] rounded-lg bg-white/[0.05] hover:bg-white/10 transition-colors">
              <button onClick={() => openRecent(d)} disabled={busy} title={`${d.name} - ${d.count} prompt${d.count === 1 ? "" : "s"}, ${new Date(d.at).toLocaleDateString()}`} className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 min-w-0 text-[11px] text-zinc-300 disabled:opacity-50">
                {d.source === "drive" ? <Cloud size={11} className="text-blue-300 shrink-0" /> : d.source === "link" ? <Link2 size={11} className="text-blue-300 shrink-0" /> : <FileText size={11} className="text-zinc-500 shrink-0" />}
                <span className="truncate">{d.name}</span>
              </button>
              <button onClick={() => forgetRecent(d)} title="Forget" className="pr-1.5 text-zinc-600 hover:text-white hidden group-hover:block"><X size={11} /></button>
            </span>
          ))}
        </div>
      )}

      {fileName && !error && (
        <p className="text-[11px] text-zinc-500 flex items-center gap-1.5"><FileText size={12} /> {fileName}{candidates.length > 0 ? ` - ${candidates.length} prompts found${usedCount ? `, ${usedCount} already made` : ""}` : ""}</p>
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
              <span className="truncate flex items-center gap-2">{picked >= 0 ? candidates[picked].label : "Pick a prompt..."}{picked >= 0 && usage[picked] > 0 && <span className="text-[9px] font-black uppercase tracking-widest text-emerald-300 bg-emerald-500/15 rounded-full px-2 py-0.5">made ×{usage[picked]}</span>}</span>
              <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div className="absolute z-40 left-0 right-0 mt-2 max-h-72 overflow-y-auto bg-zinc-950 border border-white/15 rounded-2xl shadow-2xl shadow-black/60">
                <div className="sticky top-0 bg-zinc-950 p-2 border-b border-white/10 flex items-center gap-2">
                  <Search size={13} className="text-zinc-500 ml-1" />
                  <input autoFocus value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search prompts..." className="flex-1 bg-transparent text-xs text-white focus:outline-none placeholder:text-zinc-600" />
                </div>
                {usedCount > 0 && <label className="flex items-center gap-2 px-4 py-2 border-b border-white/10 text-[11px] text-zinc-400 cursor-pointer select-none"><input type="checkbox" checked={hideUsed} onChange={e => setHideUsed(e.target.checked)} /> Hide the {usedCount} already made</label>}
                {shown.length === 0 && <p className="px-4 py-3 text-xs text-zinc-500">No prompts match.</p>}
                {shown.map(({ c, i }) => (
                  <button key={i} onClick={() => pick(i)} className={`w-full text-left px-4 py-2 hover:bg-white/5 ${i === picked ? "bg-white/[0.07]" : ""}`}>
                    <span className="flex items-center gap-2"><span className="block text-xs font-semibold text-zinc-100 truncate flex-1">{c.label}</span>{usage[i] > 0 && <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-emerald-300 bg-emerald-500/15 rounded-full px-2 py-0.5" title="Already made - pick it to see the results">made ×{usage[i]}</span>}</span>
                    <span className="block text-[11px] text-zinc-500 truncate">{c.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1"><label className={label + " !mb-0"}>{textLabel || "Prompt text"}</label><span className="inline-flex items-center gap-1.5">{bare && <button onClick={() => fileRef.current?.click()} disabled={busy} title="Pull the prompt out of a file (txt, md, docx, xlsx, pdf, image)" className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors disabled:opacity-40">{busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}</button>}{bare && <button onClick={() => setDriveOpen(true)} disabled={busy} title="Read prompts from Google Drive / Sheets / Docs" className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-blue-300 transition-colors disabled:opacity-40"><Cloud size={15} /></button>}{bare && <button onClick={() => setLinkOpen(o => !o)} title="Paste a Google Sheets / Docs / Drive link" className={`p-2.5 rounded-xl transition-colors ${linkOpen ? "bg-white/15 text-white" : "bg-white/5 hover:bg-white/10 text-zinc-300"}`}><Link2 size={15} /></button>}<EnhancePromptButton kind={kind} prompt={prompt} onPrompt={onPrompt} modelId={modelId} tab={kind} /></span></div>
        {linkOpen && (
          <div className="flex gap-2 mb-2">
            <input value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => e.key === "Enter" && readLink()} placeholder="https://docs.google.com/spreadsheets/d/..." className="flex-1 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-[12px] text-white focus:outline-none placeholder:text-zinc-700" />
            <button onClick={readLink} disabled={busy || !link.trim()} className="px-3 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-bold disabled:opacity-40">Read</button>
          </div>
        )}
        <DrivePicker open={driveOpen} mode="file" field="w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none placeholder:text-zinc-700" onClose={() => setDriveOpen(false)} onPickFile={readDrive} />
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          rows={4}
          placeholder={placeholder || "A robot holding a red skateboard, studio lighting..."}
          className={`w-full bg-white/5 border-none rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:ring-1 ${a.ring} placeholder:text-zinc-700 resize-y`}
        />
        {!needsPrompt && <p className="text-[11px] text-amber-400 mt-2">This workflow takes no text prompt - the box is ignored.</p>}
      </div>
    </div>
  );
}
