import React from "react";
import { GripHorizontal } from "lucide-react";
import { ComfyConsole } from "./ComfyConsole";
import { usePipped } from "./consolePip";

const POS_KEY = "cursed.comfyPip.box";
interface Box { x: number; y: number; w: number; h: number }
const MIN_W = 320, MIN_H = 180;

const fit = (b: Box): Box => {
  const w = Math.min(Math.max(b.w, MIN_W), window.innerWidth - 16), h = Math.min(Math.max(b.h, MIN_H), window.innerHeight - 16);
  return { w, h, x: Math.min(Math.max(b.x, 8), window.innerWidth - w - 8), y: Math.min(Math.max(b.y, 8), window.innerHeight - h - 8) };
};
const initial = (): Box => {
  try { const v = JSON.parse(localStorage.getItem(POS_KEY) || "null"); if (v && Number.isFinite(v.x) && Number.isFinite(v.w)) return fit(v); } catch { /* none saved */ }
  return fit({ w: 560, h: 300, x: window.innerWidth - 580, y: window.innerHeight - 320 });
};

/** ComfyUI's console as a floating window: drag it by the top bar, resize it from the corner, dock it back with the button in its header. */
export function ComfyConsolePip() {
  const on = usePipped();
  const [box, setBox] = React.useState<Box>(initial);
  const drag = React.useRef<{ kind: "move" | "size"; sx: number; sy: number; b: Box } | null>(null);
  const save = (b: Box) => { try { localStorage.setItem(POS_KEY, JSON.stringify(b)); } catch { /* storage blocked */ } };

  React.useEffect(() => {
    const onResize = () => setBox(b => fit(b));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  if (!on) return null;

  const start = (kind: "move" | "size") => (e: React.PointerEvent) => {
    drag.current = { kind, sx: e.clientX, sy: e.clientY, b: box };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    setBox(fit(d.kind === "move" ? { ...d.b, x: d.b.x + dx, y: d.b.y + dy } : { ...d.b, w: d.b.w + dx, h: d.b.h + dy }));
  };
  const end = () => { if (drag.current) { save(box); drag.current = null; } };

  return (
    <div style={{ left: box.x, top: box.y, width: box.w, height: box.h }} className="fixed z-[60] flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-zinc-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl">
      <div onPointerDown={start("move")} onPointerMove={move} onPointerUp={end} title="Drag to move" className="flex h-5 shrink-0 cursor-grab touch-none items-center justify-center bg-white/5 text-zinc-600 active:cursor-grabbing"><GripHorizontal size={14} /></div>
      <ComfyConsole floating />
      <div onPointerDown={start("size")} onPointerMove={move} onPointerUp={end} title="Drag to resize" className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none">
        <svg viewBox="0 0 16 16" className="h-4 w-4 text-zinc-600"><path d="M14 4L4 14M14 9L9 14" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
      </div>
    </div>
  );
}
