import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { ImagePlus, Loader2, UploadCloud, X } from "lucide-react";
import { api, type Project, type Ref } from "./api";

/**
 * Attach reference images by dropping them, pasting them, or picking a file: a character's face,
 * a costume, a location. Uploaded art is used as-is, so it lands as a finished reference and can
 * be wired into scenes straight away.
 */
export function RefDrop({ project, episodeId, onChanged, compact }: {
  project: Project;
  episodeId: string;
  onChanged: (p: Project) => void;
  compact?: boolean;
}) {
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [role, setRole] = React.useState<Ref["role"]>("character");
  const picker = React.useRef<HTMLInputElement>(null);

  async function take(files: FileList | File[] | null) {
    const images = Array.from(files || []).filter(f => f.type.startsWith("image/"));
    if (!images.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of images) {
        const label = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60);
        await api.uploadRef(project.id, episodeId, file, label, role);
      }
      onChanged(await api.get(project.id));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
      setOver(false);
    }
  }

  return (
    <div className="space-y-2">
      <motion.div
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); take(e.dataTransfer.files); }}
        onPaste={e => take(Array.from(e.clipboardData.files))}
        onClick={() => picker.current?.click()}
        animate={over ? { scale: 1.015, borderColor: "rgb(56 189 248)" } : { scale: 1, borderColor: "rgb(64 64 64)" }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className={`cursor-pointer rounded-lg border border-dashed bg-neutral-900/40 text-center ${compact ? "p-3" : "p-5"} hover:bg-neutral-900/70`}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") picker.current?.click(); }}
      >
        <motion.div animate={over ? { y: -2 } : { y: 0 }} className="flex flex-col items-center gap-1.5">
          {busy
            ? <Loader2 size={compact ? 16 : 20} className="animate-spin text-sky-400" />
            : over
              ? <UploadCloud size={compact ? 16 : 20} className="text-sky-400" />
              : <ImagePlus size={compact ? 16 : 20} className="text-neutral-500" />}
          <span className="text-[11px] text-neutral-400">
            {busy ? "Uploading..." : over ? "Drop to attach" : compact ? "Attach reference image" : "Drop, paste or click to attach a reference image"}
          </span>
          {!compact && !busy && <span className="text-[10px] text-neutral-600">face, costume, location - anything the scene should match</span>}
        </motion.div>
      </motion.div>

      <div className="flex items-center gap-1.5">
        {(["character", "style"] as const).map(r => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`rounded-full px-2.5 py-0.5 text-[11px] transition ${role === r ? "bg-sky-600/25 text-sky-200 border border-sky-700" : "border border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
          >
            {r === "character" ? "character / costume" : "style plate"}
          </button>
        ))}
      </div>

      <input
        ref={picker}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp"
        multiple
        hidden
        onChange={e => { take(e.target.files); e.target.value = ""; }}
      />

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-start gap-2 rounded border border-rose-900/60 bg-rose-950/40 px-2 py-1.5 text-[11px] text-rose-200"
          >
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X size={12} /></button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
