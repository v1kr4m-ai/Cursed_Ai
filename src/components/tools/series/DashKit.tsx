import React from "react";
import { motion } from "motion/react";

/** A circular progress ring with the value in the middle (takes its colour from the surrounding text). */
export function Ring({ pct, size = 84, stroke = 6, label, sub }: { pct: number; size?: number; stroke?: number; label?: string; sub?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.14} strokeWidth={stroke} />
        <motion.circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c}
          initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - Math.min(1, pct / 100)) }} transition={{ duration: 0.9, ease: "easeOut" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="font-light tracking-tight" style={{ fontSize: size * 0.26 }}>{label ?? `${Math.round(pct)}%`}</span>
        {sub && <span className="text-[9px] opacity-55 mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

const SIZES_KEY = "cursed.series.tiles";
type TileSize = { span?: number; h?: number };
const readSizes = (): Record<string, TileSize> => { try { return JSON.parse(localStorage.getItem(SIZES_KEY) || "{}"); } catch { return {}; } };

/** One card of a board. "dark" = charcoal, "frost" = frosted glass; a button when it has an onClick.
 *  With an id the card can be resized from its bottom-right corner (width snaps to the 12-column grid, height is free); double-click the corner to reset. */
export function Tile({ id, className = "", tone = "frost", onClick, title, heading, aside, children, delay = 0 }: {
  id?: string; className?: string; tone?: "dark" | "frost"; onClick?: () => void; title?: string; heading?: string; aside?: React.ReactNode; children: React.ReactNode; delay?: number;
}) {
  const [size, setSizeState] = React.useState<TileSize>(() => (id ? readSizes()[id] || {} : {}));
  const ref = React.useRef<HTMLElement | null>(null);
  const setSize = (next: TileSize) => {
    setSizeState(next);
    if (!id) return;
    try { const all = readSizes(); if (next.span || next.h) all[id] = next; else delete all[id]; localStorage.setItem(SIZES_KEY, JSON.stringify(all)); } catch { /* storage blocked */ }
  };
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const el = ref.current, grid = el?.parentElement;
    if (!el || !grid) return;
    const box = el.getBoundingClientRect(), gap = parseFloat(getComputedStyle(grid).columnGap) || 12;
    const cols = getComputedStyle(grid).gridTemplateColumns.split(" ").length || 12;
    const unit = (grid.clientWidth + gap) / cols;
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const spanCols = Math.max(1, Math.min(cols, Math.round((box.width + ev.clientX - x0 + gap) / unit)));
      setSize({ span: Math.max(2, Math.min(12, Math.round(spanCols * 12 / cols))), h: Math.max(96, Math.round(box.height + ev.clientY - y0)) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const body = (
    <>
      {(heading || aside) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-[13px] font-medium tracking-tight opacity-85">{heading}</p>
          {aside}
        </div>
      )}
      {children}
      {id && (
        <span role="separator" aria-label="Resize card" title="Drag to resize - double-click to reset" onPointerDown={startResize} onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); setSize({}); }}
          className="absolute bottom-1 right-1 z-10 h-4 w-4 cursor-nwse-resize opacity-0 hover:opacity-70 [div:hover>&]:opacity-30 [button:hover>&]:opacity-30"
          style={{ background: "linear-gradient(135deg, transparent 55%, currentColor 55% 62%, transparent 62% 76%, currentColor 76% 83%, transparent 83%)" }} />
      )}
    </>
  );
  const custom = size.span ? "xl:[grid-column:span_var(--span)/span_var(--span)]" : "";
  const common = `${className} ${custom} ${tone === "dark" ? "sd-dark" : "sd-frost"} @container relative rounded-[1.6rem] border p-5 text-left transition-colors ${size.h ? "overflow-auto" : "overflow-hidden"}`;
  const style = { ...(size.span ? { "--span": size.span } : {}), ...(size.h ? { height: size.h, minHeight: 0 } : {}) } as React.CSSProperties;
  if (!onClick) return <motion.div ref={ref as any} style={style} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }} className={common}>{body}</motion.div>;
  return (
    <motion.button ref={ref as any} style={style} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }}
      onClick={onClick} title={title} className={`${common} cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-current block w-full`}>
      {body}
    </motion.button>
  );
}

export const hours = (min: number) => (min >= 90 ? `${Math.round(min / 60)} h` : `${Math.max(1, Math.round(min))} min`);

/** Big thin page title, like a poster. */
export function PageTitle({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <h1 className={`relative text-center font-extralight tracking-tight select-none ${small ? "text-3xl sm:text-5xl mb-4" : "text-4xl sm:text-6xl mb-5"}`}>{children}</h1>;
}
