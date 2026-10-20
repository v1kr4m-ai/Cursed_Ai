import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { FileText, FileSpreadsheet, FileType2, ImageIcon, Loader2, Trash2, ClipboardPaste, UploadCloud, X } from "lucide-react";
import { api, type Project, type Source } from "./api";
import { DIGEST_THRESHOLD } from "./chunk";

/**
 * Story material written outside the app: a treatment in Word, an outline in a text file, a
 * scene list in Excel, a PDF script, or a photo of a page. Everything is reduced to plain text
 * server-side (images go through OCR), then handed to the planner along with the discussion.
 */

const ACCEPT = ".txt,.md,.csv,.tsv,.rtf,.doc,.docx,.odt,.xlsx,.xlsm,.pptx,.pdf,.png,.jpg,.jpeg,.webp,.bmp";

function iconFor(name: string) {
  const ext = name.toLowerCase().split(".").pop() || "";
  if (["xlsx", "xlsm", "csv", "tsv"].includes(ext)) return FileSpreadsheet;
  if (["png", "jpg", "jpeg", "webp", "bmp"].includes(ext)) return ImageIcon;
  if (["pdf", "doc", "docx", "odt", "rtf", "pptx"].includes(ext)) return FileType2;
  return FileText;
}

export function StorySources({ project, onChanged }: { project: Project; onChanged: (p: Project) => void }) {
  const [busy, setBusy] = React.useState(false);
  const [over, setOver] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pasting, setPasting] = React.useState(false);
  const [pasted, setPasted] = React.useState("");
  const picker = React.useRef<HTMLInputElement>(null);

  const sources: Source[] = project.sources || [];

  async function takeFiles(files: FileList | File[] | null) {
    const list = Array.from(files || []);
    if (!list.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of list) await api.uploadSource(project.id, file);
      onChanged(await api.get(project.id));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
      setOver(false);
    }
  }

  async function addPasted() {
    if (!pasted.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.addSourceText(project.id, pasted, "Pasted story");
      setPasted("");
      setPasting(false);
      onChanged(await api.get(project.id));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api.deleteSource(project.id, id);
    onChanged(await api.get(project.id));
  }

  return (
    <div className="space-y-2">
      <motion.div
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); takeFiles(e.dataTransfer.files); }}
        onPaste={e => { if (e.clipboardData.files.length) takeFiles(e.clipboardData.files); }}
        onClick={() => picker.current?.click()}
        animate={over ? { scale: 1.015, borderColor: "rgb(167 139 250)" } : { scale: 1, borderColor: "rgb(64 64 64)" }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="cursor-pointer rounded-lg border border-dashed bg-neutral-900/40 p-4 text-center hover:bg-neutral-900/70"
        role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") picker.current?.click(); }}
      >
        <motion.div animate={over ? { y: -2 } : { y: 0 }} className="flex flex-col items-center gap-1.5">
          {busy ? <Loader2 size={18} className="animate-spin text-violet-400" />
            : over ? <UploadCloud size={18} className="text-violet-400" />
            : <FileText size={18} className="text-neutral-500" />}
          <span className="text-[11px] text-neutral-400">
            {busy ? "Reading..." : over ? "Drop to attach" : "Attach a story you wrote elsewhere"}
          </span>
          <span className="text-[10px] text-neutral-600">txt, md, Word, PDF, Excel, PowerPoint, or a photo of a page</span>
        </motion.div>
      </motion.div>

      <button onClick={() => setPasting(p => !p)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-700 px-3 py-1.5 text-[11px] text-neutral-300 transition hover:bg-neutral-800/60">
        <ClipboardPaste size={12} /> {pasting ? "Cancel paste" : "Paste story text instead"}
      </button>

      <AnimatePresence initial={false}>
        {pasting && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="space-y-2 overflow-hidden">
            <textarea
              className="h-40 w-full resize-none rounded-lg border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
              placeholder="Paste the treatment, outline or script here..."
              value={pasted}
              onChange={e => setPasted(e.target.value)}
            />
            <button onClick={addPasted} disabled={!pasted.trim() || busy} className="w-full rounded-lg bg-violet-600/80 px-3 py-2 text-xs text-white hover:bg-violet-600 disabled:opacity-40">
              Add {pasted.trim() ? `${pasted.trim().split(/\s+/).length} words` : "story"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <input ref={picker} type="file" accept={ACCEPT} multiple hidden onChange={e => { takeFiles(e.target.files); e.target.value = ""; }} />

      <AnimatePresence initial={false}>
        {sources.map(s => {
          const Icon = iconFor(s.name);
          return (
            <motion.div key={s.id} layout
              initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
              className="group flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/50 px-2.5 py-2">
              <Icon size={14} className="shrink-0 text-violet-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-neutral-200">{s.name}</div>
                <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
                  <span>{s.text.length.toLocaleString()} chars</span>
                  {s.text.length > DIGEST_THRESHOLD && (
                    <span className={s.digest ? "text-emerald-400" : "text-amber-400"}>
                      {s.digest ? "summarised" : "will be summarised"}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => remove(s.id)} className="shrink-0 text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:text-rose-400" title="Remove">
                <Trash2 size={13} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-2 rounded border border-rose-900/60 bg-rose-950/40 px-2 py-1.5 text-[11px] text-rose-200">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X size={12} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
