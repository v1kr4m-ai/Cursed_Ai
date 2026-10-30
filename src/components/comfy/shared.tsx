import React from "react";
import { AlertTriangle, ChevronDown, Film, ImageIcon as ImageIconLucide, Loader2, Pause, RotateCw, X } from "lucide-react";
import { ProgressBar } from "../layout/ProgressBar";
import { ACCENT, Kind, fileUrl } from "./types";
import { ReorderGroup, useReorderItem, Reorderable, ReorderHide } from "../ui/Reorder";

/** Look shared by every mode of the Image / Video studio, so Cloud, Quick and Workflows feel like one tool. */
export const label = "text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-2 block";
export const iconBtn = "p-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors disabled:opacity-40";
export const fieldCls = (ring: string) => `w-full bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2 text-[13px] text-white focus:outline-none focus:ring-1 ${ring} placeholder:text-zinc-700`;

export const isVideoPath = (p: string) => /\.(mp4|webm|mov|mkv)(\?|$)/i.test(p);
export const isImagePath = (p: string) => /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(p) || p.startsWith("data:image");

/** Shows an image / video / audio file by its on-disk path, or any URL (gallery files, data URLs). */
export function MediaView({ src, className, kind }: { src: string; className?: string; kind?: Kind }) {
  const url = /^(data:|blob:|\/api\/|https?:)/.test(src) ? src : fileUrl(src);
  if (isVideoPath(src) || (kind === "video" && !isImagePath(src))) return <video src={url} controls loop muted className={className} />;
  if (isImagePath(src)) return <img src={url} alt="" className={className} />;
  return <audio src={url} controls className="w-full" />;
}

/** One collapsible block of the control panel: icon + title on the left, a short summary on the right. */
export function Section({ title, icon, accent, badge, defaultOpen = false, children }: { title: string; icon: React.ReactNode; accent: string; badge?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const { className: ri = "", style, ...bind } = useReorderItem(title);
  return (
    <section {...bind} style={style} className={"border-b border-white/5 " + ri}>
      <ReorderHide id={title} />
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left">
        <span className={accent}>{icon}</span>
        <span className="text-[11px] font-black uppercase tracking-[0.18em] text-zinc-300">{title}</span>
        {badge && <span className="ml-auto max-w-[55%] truncate text-[11px] text-zinc-500 font-medium">{badge}</span>}
        <ChevronDown size={14} className={`text-zinc-600 transition-transform shrink-0 ${badge ? "" : "ml-auto"} ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </section>
  );
}

/**
 * The studios' resizable layout: the settings panel's width and the canvas's height, dragged by the person and
 * remembered per studio in this browser. `null` height = fill the space (the default).
 */
export function useStudioLayout(key: string) {
  const read = (k: string, d: number | null) => { try { const v = localStorage.getItem(`studio-layout:${key}:${k}`); return v ? Number(v) : d; } catch { return d; } };
  const [panelW, setPanelW] = React.useState<number>(() => read("panel", 400)!);
  const [stageH, setStageH] = React.useState<number | null>(() => read("stage", null));
  const save = (k: string, v: number | null) => { try { v === null ? localStorage.removeItem(`studio-layout:${key}:${k}`) : localStorage.setItem(`studio-layout:${key}:${k}`, String(Math.round(v))); } catch { /* private window */ } };
  return {
    panelW, stageH,
    setPanelW: (w: number) => { const v = Math.min(900, Math.max(280, w)); setPanelW(v); save("panel", v); },
    setStageH: (h: number | null) => { const v = h === null ? null : Math.min(2400, Math.max(160, h)); setStageH(v); save("stage", v); },
    /** Grid style for the two panes (the splitter sits between them). */
    gridStyle: { "--studio-panel": `${panelW}px` } as React.CSSProperties,
    gridCls: "lg:grid-cols-[var(--studio-panel)_6px_1fr] lg:gap-x-2",
  };
}

/** A bar dragged to resize: "x" changes a width, "y" a height. Double-click puts it back to the default. */
export function DragBar({ axis, value, onChange, onReset, title }: { axis: "x" | "y"; value: number; onChange: (v: number) => void; onReset: () => void; title: string }) {
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const from = axis === "x" ? e.clientX : e.clientY, base = value;
    const move = (ev: PointerEvent) => onChange(base + (axis === "x" ? ev.clientX : ev.clientY) - from);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); document.body.style.cursor = ""; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
  };
  return (
    <div onPointerDown={start} onDoubleClick={onReset} title={title + " (double-click to reset)"}
      className={"group shrink-0 touch-none select-none flex items-center justify-center " + (axis === "x" ? "hidden lg:flex cursor-col-resize" : "h-3 -my-1.5 cursor-row-resize")}>
      <div className={"rounded-full bg-white/10 group-hover:bg-white/30 transition-colors " + (axis === "x" ? "h-16 w-1" : "h-1 w-16")} />
    </div>
  );
}

/** Two panes filling the page: controls (scrolling, with a pinned action bar) on the left, canvas on the right. */
export function StudioFrame({ toolbar, controls, actionBar, canvas, reorderKey = "studio" }: { toolbar: React.ReactNode; controls: React.ReactNode; actionBar: React.ReactNode; canvas: React.ReactNode; reorderKey?: string }) {
  const lay = useStudioLayout(reorderKey);
  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      {toolbar}
      <div className={"flex-1 min-h-0 grid gap-4 overflow-y-auto lg:overflow-hidden " + lay.gridCls} style={lay.gridStyle}>
        <ReorderGroup id={reorderKey}>
          <div className="glass rounded-3xl border-white/5 flex flex-col min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">{controls}</div>
            <div className="shrink-0 border-t border-white/5 p-4 space-y-2 bg-black/20">{actionBar}</div>
          </div>
        </ReorderGroup>
        <DragBar axis="x" value={lay.panelW} onChange={lay.setPanelW} onReset={() => lay.setPanelW(400)} title="Drag to resize the settings panel and the canvas" />
        <ReorderGroup id={reorderKey + "-canvas"}>
          <div className="flex flex-col gap-3 min-h-0 lg:overflow-y-auto pr-0.5">{canvas}</div>
        </ReorderGroup>
      </div>
    </div>
  );
}

/** The canvas's height: filling the space by default, or the height dragged with the bar under it. */
export function useStageHeight(key: string) {
  const { stageH, setStageH } = useStudioLayout(key);
  const ref = React.useRef<HTMLDivElement>(null);
  return {
    ref,
    cls: stageH ? "shrink-0" : "min-h-[300px] lg:min-h-0 lg:flex-1",
    style: stageH ? { height: stageH } : undefined,
    bar: <DragBar axis="y" value={stageH ?? ref.current?.offsetHeight ?? 400} onChange={setStageH} onReset={() => setStageH(null)} title="Drag to resize the canvas" />,
  };
}

/** The big preview area: live progress while a job runs, otherwise the picked / newest result. */
export function Stage({ kind, busy, preview, status, percent, note, src, error, layoutKey }: { kind: Kind; busy: boolean; preview?: string | null; status?: string; percent: number | null; note?: string; src: string | null; error?: string | null; layoutKey?: string }) {
  const a = ACCENT[kind];
  const h = useStageHeight(layoutKey || `stage-${kind}`);
  return (
    <>
    <div ref={h.ref} style={h.style} className={"relative " + h.cls + " rounded-3xl border border-white/5 bg-black/30 overflow-hidden flex items-center justify-center"}>
      <div className="absolute inset-0 opacity-[0.07] pointer-events-none" style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
      {busy ? (
        <div className="relative w-full h-full flex flex-col items-center justify-center p-6 gap-5">
          {preview ? <img src={preview} alt="Live preview" className="max-h-[70%] max-w-full rounded-xl border border-white/10 shadow-2xl shadow-black/60" /> : <Loader2 size={34} className={`animate-spin ${a.text}`} />}
          <div className="w-full max-w-md space-y-1.5">
            <ProgressBar value={percent} label={status || "Working"} color={a.bar} />
            {note && <p className="text-[11px] text-zinc-500 text-center">{note}</p>}
          </div>
        </div>
      ) : src ? (
        <MediaView src={src} kind={kind} className="relative max-w-full max-h-full object-contain" />
      ) : (
        <div className="relative text-center space-y-2 p-8">
          <div className={`mx-auto w-14 h-14 rounded-2xl ${a.soft} border flex items-center justify-center`}>{kind === "video" ? <Film size={24} className={a.text} /> : <ImageIconLucide size={24} className={a.text} />}</div>
          <p className="text-sm font-bold text-zinc-300">Your {kind} appears here</p>
          <p className="text-xs text-zinc-600 max-w-xs">Write a prompt and press Generate. Everything you queue is listed below the canvas.</p>
        </div>
      )}
      {error && !busy && <div className="absolute inset-x-4 bottom-4 text-[12px] text-red-300 bg-red-950/70 border border-red-500/30 rounded-xl px-4 py-2.5 flex items-start gap-2 backdrop-blur"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> <span>{error}</span></div>}
    </div>
    {h.bar}
    </>
  );
}

export interface QueueRow { id: string; label: string; status: string; detail?: string; pausable?: boolean; cancellable?: boolean }

/** The job queue: every waiting / running / paused job with pause, resume and cancel icons. Always shown (with an empty hint) so it is never missing. */
export function QueueList({ kind, rows, onPause, onResume, onCancel, onRemove }: { kind: Kind; rows: QueueRow[]; onPause: (id: string) => void; onResume: (id: string) => void; onCancel: (id: string) => void; onRemove: (id: string) => void }) {
  const a = ACCENT[kind];
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-3 space-y-1.5">
      <p className={label + " !mb-1"}>Queue · {rows.length}</p>
      {rows.length === 0 && <p className="text-[11px] text-zinc-600">Nothing queued. Jobs you start wait here, and can be paused or cancelled.</p>}
      {rows.map(r => (
        <div key={r.id} className="flex items-center justify-between gap-3 text-xs text-zinc-400">
          <span className="truncate"><span className={r.status === "running" ? a.text : r.status === "paused" ? "text-amber-400" : "text-zinc-500"}>{r.status}</span> · {r.label}{r.detail ? ` · ${r.detail}` : ""}</span>
          <span className="flex gap-1 shrink-0">
            {r.status === "paused" ? (
              <>
                <button onClick={() => onResume(r.id)} title="Resume (goes to the end of the queue)" className={`${iconBtn} !p-1.5 !text-emerald-400`}><RotateCw size={13} /></button>
                <button onClick={() => onRemove(r.id)} title="Remove" className={`${iconBtn} !p-1.5 hover:!text-red-400`}><X size={13} /></button>
              </>
            ) : (
              <>
                {r.pausable && <button onClick={() => onPause(r.id)} title="Pause (hold it back until you resume)" className={`${iconBtn} !p-1.5 !text-amber-400`}><Pause size={13} /></button>}
                {r.cancellable && <button onClick={() => onCancel(r.id)} title="Cancel" className={`${iconBtn} !p-1.5 hover:!text-red-400`}><X size={13} /></button>}
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
