import React from "react";
import { AnimatePresence, motion } from "motion/react";

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
type TileSize = { f?: number; h?: number };
const readJson = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; } };
const writeJson = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } };

interface BoardApi {
  edit: boolean;
  dragId: string | null;
  indexOf: (id: string) => number;
  enterEdit: () => void;
  startDrag: (id: string, e: { clientX: number; clientY: number }, el: HTMLElement) => void;
}
const BoardCtx = React.createContext<BoardApi | null>(null);

/**
 * A wrapping board of cards. Long-press a card (or press Rearrange) and every card wiggles and pops out; drag one onto another to
 * reorder. The order and each card's size are remembered. Press Done, Esc or an empty spot to settle the cards again.
 */
export function TileBoard({ id, ids, className = "", children }: { id: string; ids: string[]; className?: string; children: React.ReactNode }) {
  const key = "cursed.series.order." + id;
  const [order, setOrder] = React.useState<string[]>(() => {
    const saved = readJson<string[]>(key, []);
    return [...saved.filter(x => ids.includes(x)), ...ids.filter(x => !saved.includes(x))];
  });
  const [edit, setEdit] = React.useState(false);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [version, setVersion] = React.useState(0);
  const drag = React.useRef<{ el: HTMLElement; gx: number; gy: number; x: number; y: number } | null>(null);
  const orderRef = React.useRef(order);
  orderRef.current = order;
  // Tiles that appear later (a new card) join the end of the saved order.
  React.useEffect(() => { setOrder(o => { const next = [...o.filter(x => ids.includes(x)), ...ids.filter(x => !o.includes(x))]; return next.join() === o.join() ? o : next; }); }, [ids.join()]);

  React.useEffect(() => {
    if (!edit) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setEdit(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [edit]);

  const place = () => {
    const d = drag.current;
    if (!d) return;
    d.el.style.translate = "none";
    const r = d.el.getBoundingClientRect();
    d.el.style.translate = (d.x - d.gx - r.left) + "px " + (d.y - d.gy - r.top) + "px";
  };
  React.useLayoutEffect(place, [order, dragId]);

  const startDrag = (tid: string, e: { clientX: number; clientY: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    drag.current = { el, gx: e.clientX - r.left, gy: e.clientY - r.top, x: e.clientX, y: e.clientY };
    setDragId(tid);
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      d.x = ev.clientX; d.y = ev.clientY;
      place();
      d.el.style.pointerEvents = "none";
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest("[data-tile]") as HTMLElement | null;
      const overId = over?.dataset.tile;
      if (overId && overId !== tid) {
        const cur = orderRef.current;
        const from = cur.indexOf(tid), to = cur.indexOf(overId);
        if (from >= 0 && to >= 0 && from !== to) { const next = [...cur]; next.splice(from, 1); next.splice(to, 0, tid); setOrder(next); }
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = drag.current;
      drag.current = null;
      if (d) { d.el.style.translate = ""; d.el.style.pointerEvents = ""; }
      setDragId(null);
      writeJson(key, orderRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const api: BoardApi = { edit, dragId, indexOf: tid => { const i = order.indexOf(tid); return i < 0 ? ids.indexOf(tid) : i; }, enterEdit: () => setEdit(true), startDrag };
  const reset = () => {
    try { localStorage.removeItem(key); localStorage.removeItem(SIZES_KEY); } catch { /* storage blocked */ }
    setOrder(ids); setVersion(v => v + 1);
  };

  return (
    <BoardCtx.Provider value={api}>
      <AnimatePresence>
        {edit && (
          <motion.div key="bar" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="sticky top-0 z-40 mb-3 flex justify-center">
            <div className="sd-dark flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] shadow-xl">
              <span className="opacity-70">Drag cards to rearrange - drag a corner to resize</span>
              <button onClick={reset} className="rounded-full bg-white/10 px-2.5 py-1 hover:bg-white/20">Reset layout</button>
              <button onClick={() => setEdit(false)} className="rounded-full bg-white px-3 py-1 font-semibold text-zinc-900">Done</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className={"relative flex flex-wrap gap-3 " + className} onPointerDown={e => { if (edit && e.target === e.currentTarget) setEdit(false); }}>
        <React.Fragment key={version}>{children}</React.Fragment>
      </div>
      {!edit && (
        <button onClick={() => setEdit(true)} title="Long-press any card to do the same" className="mx-auto mt-4 block text-[11px] opacity-40 hover:opacity-80">Rearrange cards</button>
      )}
    </BoardCtx.Provider>
  );
}

/** One card of a board. "dark" = charcoal, "frost" = frosted glass; a button when it has an onClick.
 *  With an id it can be resized freely from its bottom-right corner (double-click the corner to reset) and, on a TileBoard, long-pressed to rearrange.
 *  span = default width in twelfths of the row on wide screens; mdFull = full row on medium screens. */
export function Tile({ id, span = 4, mdFull, className = "", tone = "frost", onClick, title, heading, aside, children, delay = 0 }: {
  id?: string; span?: number; mdFull?: boolean; className?: string; tone?: "dark" | "frost"; onClick?: () => void; title?: string; heading?: string; aside?: React.ReactNode; children: React.ReactNode; delay?: number;
}) {
  const board = React.useContext(BoardCtx);
  const [size, setSizeState] = React.useState<TileSize>(() => (id ? readJson<Record<string, TileSize>>(SIZES_KEY, {})[id] || {} : {}));
  const ref = React.useRef<HTMLElement | null>(null);
  const press = React.useRef<{ t: number; x: number; y: number } | null>(null);
  const longPressed = React.useRef(false);
  const setSize = (next: TileSize) => {
    setSizeState(next);
    if (!id) return;
    const all = readJson<Record<string, TileSize>>(SIZES_KEY, {});
    if (next.f || next.h) all[id] = next; else delete all[id];
    writeJson(SIZES_KEY, all);
  };
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const el = ref.current, row = el?.parentElement;
    if (!el || !row) return;
    const box = el.getBoundingClientRect(), gap = parseFloat(getComputedStyle(row).columnGap) || 12;
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const f = (box.width + ev.clientX - x0 + gap) / (row.clientWidth + gap);
      setSize({ f: Math.round(Math.max(0.12, Math.min(1, f > 0.97 ? 1 : f)) * 1000) / 1000, h: Math.max(80, Math.round(box.height + ev.clientY - y0)) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const editing = !!board?.edit && !!id;
  const dragging = !!id && board?.dragId === id;
  const down = (e: React.PointerEvent) => {
    if (!board || !id || (e.target as HTMLElement).closest("[data-resize]")) return;
    longPressed.current = false;
    if (board.edit) { e.preventDefault(); board.startDrag(id, e, e.currentTarget as HTMLElement); return; }
    const x = e.clientX, y = e.clientY, el = e.currentTarget as HTMLElement;
    const timer = window.setTimeout(() => { longPressed.current = true; press.current = null; board.enterEdit(); board.startDrag(id, { clientX: x, clientY: y }, el); }, 480);
    press.current = { t: timer, x, y };
  };
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.t); press.current = null; } };
  const moved = (e: React.PointerEvent) => { const p = press.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) cancelPress(); };

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
        <span role="separator" aria-label="Resize card" data-resize title="Drag to resize - double-click to reset" onPointerDown={startResize} onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); setSize({}); }}
          className={"absolute bottom-1 right-1 z-10 h-5 w-5 cursor-nwse-resize touch-none transition-opacity " + (editing ? "opacity-70" : "opacity-0 hover:opacity-70")}
          style={{ background: "linear-gradient(135deg, transparent 55%, currentColor 55% 62%, transparent 62% 76%, currentColor 76% 83%, transparent 83%)" }} />
      )}
    </>
  );
  const fx = size.f ?? span / 12, fm = size.f ?? (mdFull ? 1 : 0.5);
  const common = className + " " + (tone === "dark" ? "sd-dark" : "sd-frost") + " @container relative rounded-[1.6rem] border p-5 text-left transition-colors " + (board ? "w-full md:w-[calc(var(--f)*(100%+0.75rem)-0.75rem)] md:[--f:var(--fm)] xl:[--f:var(--fx)] " : "") + (size.h ? "overflow-auto" : "overflow-hidden") + (editing ? " select-none touch-none shadow-2xl" : "") + (dragging ? " z-50" : "");
  const style = {
    "--fx": fx, "--fm": fm,
    order: id && board ? board.indexOf(id) : undefined,
    ...(size.h ? { height: size.h, minHeight: 0 } : {}),
  } as React.CSSProperties;
  const anim = editing && !dragging
    ? { opacity: 1, y: 0, scale: 1.02, rotate: [-0.9, 0.9] }
    : dragging ? { opacity: 1, y: 0, scale: 1.06, rotate: 0 } : { opacity: 1, y: 0, scale: 1, rotate: 0 };
  const tr = { delay, duration: 0.4, rotate: editing && !dragging ? { repeat: Infinity, repeatType: "reverse" as const, duration: 0.14 + ((id || "").length % 5) * 0.012, ease: "easeInOut" as const, delay: 0 } : { duration: 0.2 } };
  const shared = {
    ref: ref as any, style, "data-tile": id, initial: { opacity: 0, y: 14 }, animate: anim, transition: tr,
    layout: (dragging ? false : "position") as false | "position",
    onPointerDown: down, onPointerUp: cancelPress, onPointerLeave: cancelPress, onPointerMove: moved, onContextMenu: (e: React.MouseEvent) => { if (board?.edit || longPressed.current) e.preventDefault(); },
  };
  if (!onClick) return <motion.div {...shared} className={common}>{body}</motion.div>;
  return (
    <motion.button {...shared} whileHover={editing ? undefined : { y: -3 }} whileTap={editing ? undefined : { scale: 0.99 }}
      onClickCapture={e => { if (editing || longPressed.current) { e.preventDefault(); e.stopPropagation(); longPressed.current = false; } }}
      onClick={onClick} title={title} className={common + " cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-current block"}>
      {body}
    </motion.button>
  );
}

/** A video that plays (muted, looping) while the pointer is over it and rests on a frame otherwise. */
export function HoverVideo({ src, className = "" }: { src: string; className?: string }) {
  const v = React.useRef<HTMLVideoElement>(null);
  return (
    <video ref={v} src={src + "#t=0.4"} muted loop playsInline preload="metadata" className={className}
      onMouseEnter={() => { const e = v.current; if (e) { e.currentTime = 0; e.play().catch(() => {}); } }}
      onMouseLeave={() => { const e = v.current; if (e) { e.pause(); e.currentTime = 0.4; } }} />
  );
}

export const hours = (min: number) => (min >= 90 ? `${Math.round(min / 60)} h` : `${Math.max(1, Math.round(min))} min`);

/** Big thin page title, like a poster. */
export function PageTitle({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <h1 className={`relative text-center font-extralight tracking-tight select-none ${small ? "text-3xl sm:text-5xl mb-4" : "text-4xl sm:text-6xl mb-5"}`}>{children}</h1>;
}
