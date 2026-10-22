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

const COLS = 24, ROW = 12, GAP = 12, FLOW_BELOW = 760;
const readJson = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || "") as T; } catch { return fallback; } };
const writeJson = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } };

/** A card's place on the board, in grid units: 24 columns, rows of 12 px. */
interface Box { x: number; y: number; w: number; h: number }
export interface TileDef extends Box { id: string; title?: string }
/** Cards dropped onto each other become a deck: one place on the board, one card showing, scroll to flip through. */
interface Stack { id: string; ids: string[]; active: number }
interface Saved { layout: Record<string, Box>; stacks: Stack[]; /** Cards switched off (they can be added back from the Cards menu). */ hidden?: string[] }

const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The anchor keeps its box; everything else floats up to the first free spot (so nothing overlaps and gaps close). */
function settle(layout: Record<string, Box>, anchor?: string): Record<string, Box> {
  const out: Record<string, Box> = {};
  if (anchor && layout[anchor]) out[anchor] = layout[anchor];
  for (const k of Object.keys(layout).filter(k => k !== anchor).sort((a, b) => layout[a].y - layout[b].y || layout[a].x - layout[b].x)) {
    const b = { ...layout[k], y: 0 };
    for (let guard = 0; guard < 200; guard++) {
      const c = Object.values(out).find(o => hit(b, o));
      if (!c) break;
      b.y = c.y + c.h;
    }
    out[k] = b;
  }
  return out;
}

interface Place { slot: string; box: Box; depth: number; count: number; hovered: boolean; order: number }
interface BoardApi {
  flow: boolean;
  edit: boolean;
  drag: { slot: string; dx: number; dy: number; over: string | null } | null;
  hidden: string[];
  hideable: boolean;
  hide: (id: string) => void;
  place: (id: string) => Place;
  enterEdit: () => void;
  startDrag: (id: string, e: { clientX: number; clientY: number }) => void;
  startResize: (id: string, e: { clientX: number; clientY: number }) => void;
  rotate: (slot: string, dir: number) => void;
  split: (slot: string) => void;
  hover: (slot: string | null) => void;
}
const BoardCtx = React.createContext<BoardApi | null>(null);

/**
 * A board where cards sit anywhere on a fine grid. Long-press a card (or press Rearrange) and every card wiggles; drag one to move it
 * (the others make room), drag its corner to resize, or drop it on the middle of another card to stack them into a deck.
 * Layout and decks are remembered. Narrow windows fall back to one column.
 */
export function TileBoard({ id, defs, hideable = true, children }: { id: string; defs: TileDef[]; hideable?: boolean; children: React.ReactNode }) {
  const key = "cursed.series.layout2." + id;
  const ids = defs.map(d => d.id);
  const build = (saved: Saved | null): Saved => {
    const hidden = (saved?.hidden || []).filter(i => ids.includes(i));
    const stacks = (saved?.stacks || []).map(st => ({ ...st, ids: st.ids.filter(i => ids.includes(i) && !hidden.includes(i)) })).filter(st => st.ids.length > 1).map(st => ({ ...st, active: clamp(st.active || 0, 0, st.ids.length - 1) }));
    const stacked = new Set(stacks.flatMap(st => st.ids));
    const layout: Record<string, Box> = {};
    for (const d of defs) if (!stacked.has(d.id) && !hidden.includes(d.id)) layout[d.id] = saved?.layout?.[d.id] || { x: d.x, y: d.y, w: d.w, h: d.h };
    for (const st of stacks) layout[st.id] = saved?.layout?.[st.id] || defs.find(d => d.id === st.ids[0])!;
    return { layout: settle(layout), stacks, hidden };
  };
  const [state, setState] = React.useState<Saved>(() => build(readJson<Saved | null>(key, null)));
  const ref = React.useRef(state);
  ref.current = state;
  const [edit, setEdit] = React.useState(false);
  const [drag, setDrag] = React.useState<BoardApi["drag"]>(null);
  const [hoverSlot, setHoverSlot] = React.useState<string | null>(null);
  const presetKey = "cursed.series.presets." + id;
  const [presets, setPresets] = React.useState<Record<string, Saved>>(() => readJson<Record<string, Saved>>(presetKey, {}));
  const [menu, setMenu] = React.useState<"" | "cards" | "layouts">("");
  const [nameDraft, setNameDraft] = React.useState("");
  const [width, setWidth] = React.useState(1200);
  const wrap = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    const ro = new ResizeObserver(measure);
    ro.observe(el); measure();
    window.addEventListener("resize", measure);
    const late = window.setTimeout(measure, 400); // the first reading can come before the page has its final width
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); clearTimeout(late); };
  }, []);
  // Cards that appear or go away later (a new series, a finished job) join or leave the board.
  const idsKey = ids.join("|");
  React.useEffect(() => {
    const cur = ref.current;
    const known = new Set([...Object.keys(cur.layout), ...cur.stacks.flatMap(st => st.ids)]);
    const gone = Object.keys(cur.layout).filter(k => !k.startsWith("stack:") && !ids.includes(k));
    const fresh = defs.filter(d => !known.has(d.id) && !(cur.hidden || []).includes(d.id));
    if (!gone.length && !fresh.length) return;
    const layout = { ...cur.layout };
    for (const k of gone) delete layout[k];
    for (const d of fresh) layout[d.id] = { x: d.x, y: d.y, w: d.w, h: d.h };
    put({ ...cur, layout: settle(layout) });
  }, [idsKey]);
  React.useEffect(() => {
    if (!edit) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setEdit(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [edit]);

  const flow = width < FLOW_BELOW;
  const put = (next: Saved, persist = true) => { ref.current = next; setState(next); if (persist) writeJson(key, next); };
  const slotOf = (tid: string) => ref.current.stacks.find(st => st.ids.includes(tid))?.id ?? tid;

  const merge = (cur: Saved, a: string, b: string): Saved => {
    const from = cur.stacks.find(st => st.id === a);
    const into = cur.stacks.find(st => st.id === b);
    const moving = from ? from.ids : [a];
    const box = cur.layout[b];
    const layout = { ...cur.layout };
    delete layout[a]; delete layout[b];
    const made: Stack = into ? { ...into, ids: [...moving, ...into.ids], active: 0 } : { id: "stack:" + Date.now().toString(36), ids: [...moving, b], active: 0 };
    layout[made.id] = box;
    return { layout: settle(layout, made.id), stacks: [...cur.stacks.filter(st => st.id !== a && st.id !== b), made], hidden: cur.hidden };
  };

  const startDrag = (tid: string, e: { clientX: number; clientY: number }) => {
    const el = wrap.current;
    if (!el || flow) return;
    const slot = slotOf(tid);
    const r0 = el.getBoundingClientRect(), cw = r0.width / COLS, b0 = ref.current.layout[slot];
    const gx = e.clientX - (r0.left + b0.x * cw), gy = e.clientY - (r0.top + b0.y * ROW);
    let over: string | null = null;
    const move = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
      const cur = ref.current, b = cur.layout[slot];
      over = null;
      for (const [k, o] of Object.entries(cur.layout)) {
        if (k === slot) continue;
        const L = o.x * cw, T = o.y * ROW, W = o.w * cw, H = o.h * ROW;
        if (px > L + W * 0.15 && px < L + W * 0.85 && py > T + H * 0.15 && py < T + H * 0.85) { over = k; break; }
      }
      if (over) { setDrag({ slot, dx: px - gx - b.x * cw, dy: py - gy - b.y * ROW, over }); return; }
      const x = clamp(Math.round((px - gx) / cw), 0, COLS - b.w), y = Math.max(0, Math.round((py - gy) / ROW));
      put({ ...cur, layout: settle({ ...cur.layout, [slot]: { ...b, x, y } }, slot) }, false);
      setDrag({ slot, dx: px - gx - x * cw, dy: py - gy - y * ROW, over: null });
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      put(over ? merge(ref.current, slot, over) : ref.current);
      setDrag(null);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
    setDrag({ slot, dx: 0, dy: 0, over: null });
  };

  const startResize = (tid: string, e: { clientX: number; clientY: number }) => {
    const el = wrap.current;
    if (!el || flow) return;
    const slot = slotOf(tid);
    const cw = el.getBoundingClientRect().width / COLS, b0 = ref.current.layout[slot];
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: PointerEvent) => {
      const cur = ref.current;
      const w = clamp(Math.round((b0.w * cw + ev.clientX - x0) / cw), 2, COLS - b0.x), h = Math.max(5, Math.round((b0.h * ROW + ev.clientY - y0) / ROW));
      put({ ...cur, layout: settle({ ...cur.layout, [slot]: { ...b0, w, h } }, slot) }, false);
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); put(ref.current); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };

  const rotate = (slot: string, dir: number) => {
    const cur = ref.current;
    put({ ...cur, stacks: cur.stacks.map(st => st.id === slot ? { ...st, active: (st.active + dir + st.ids.length) % st.ids.length } : st) });
  };
  const split = (slot: string) => {
    const cur = ref.current, st = cur.stacks.find(x => x.id === slot);
    if (!st) return;
    const box = cur.layout[slot];
    const layout = { ...cur.layout };
    delete layout[slot];
    st.ids.forEach((tid, i) => { layout[tid] = { ...box, y: box.y + i * box.h }; });
    put({ layout: settle(layout, st.ids[0]), stacks: cur.stacks.filter(x => x.id !== slot), hidden: cur.hidden });
  };
  const hidden = state.hidden || [];
  const hide = (tid: string) => {
    const cur = ref.current, st = cur.stacks.find(x => x.ids.includes(tid));
    const layout = { ...cur.layout };
    let stacks = cur.stacks;
    if (st) {
      const rest = st.ids.filter(i => i !== tid), box = layout[st.id];
      if (rest.length > 1) stacks = stacks.map(x => x.id === st.id ? { ...x, ids: rest, active: Math.min(x.active, rest.length - 1) } : x);
      else { delete layout[st.id]; stacks = stacks.filter(x => x.id !== st.id); layout[rest[0]] = box; }
    } else delete layout[tid];
    put({ layout: settle(layout), stacks, hidden: [...(cur.hidden || []), tid] });
  };
  const show = (tid: string) => {
    const cur = ref.current, d = defs.find(x => x.id === tid);
    if (!d) return;
    put({ ...cur, layout: settle({ ...cur.layout, [tid]: { x: d.x, y: d.y, w: d.w, h: d.h } }, tid), hidden: (cur.hidden || []).filter(i => i !== tid) });
  };
  const savePreset = () => {
    const name = nameDraft.trim();
    if (!name) return;
    const next = { ...presets, [name]: JSON.parse(JSON.stringify(ref.current)) as Saved };
    setPresets(next); writeJson(presetKey, next); setNameDraft("");
  };
  const dropPreset = (name: string) => { const next = { ...presets }; delete next[name]; setPresets(next); writeJson(presetKey, next); };
  const reset = () => { try { localStorage.removeItem(key); } catch { /* storage blocked */ } put(build(null), false); };

  const api: BoardApi = {
    flow, edit, drag, hidden, hideable, hide, enterEdit: () => setEdit(true), startDrag, startResize, rotate, split, hover: setHoverSlot,
    place: tid => {
      const st = state.stacks.find(x => x.ids.includes(tid));
      const slot = st ? st.id : tid;
      const n = st ? st.ids.length : 1;
      return { slot, box: state.layout[slot] || { x: 0, y: 0, w: 8, h: 12 }, depth: st ? (st.ids.indexOf(tid) - st.active + n) % n : 0, count: n, hovered: hoverSlot === slot, order: ids.indexOf(tid) };
    },
  };
  const bottom = Object.values(state.layout).reduce((m, b) => Math.max(m, b.y + b.h), 0);

  return (
    <BoardCtx.Provider value={api}>
      <AnimatePresence>
        {edit && (
          <motion.div key="bar" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="sticky top-0 z-[70] mb-3 flex justify-center">
            <div className="sd-dark flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] shadow-xl">
              <span className="hidden opacity-70 lg:inline">Drag a card anywhere - corner to resize - drop on another to stack</span>
              {hideable && (
                <div className="relative">
                  <button onClick={() => setMenu(m => (m === "cards" ? "" : "cards"))} className="rounded-full bg-white/10 px-2.5 py-1 hover:bg-white/20">Cards ({defs.length - hidden.length}/{defs.length})</button>
                  {menu === "cards" && (
                    <div className="absolute left-1/2 top-full z-[90] mt-2 w-56 -translate-x-1/2 rounded-2xl border bg-zinc-900 p-2 text-white shadow-2xl">
                      {defs.map(d => {
                        const on = !hidden.includes(d.id);
                        return <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/10"><input type="checkbox" checked={on} onChange={() => (on ? hide(d.id) : show(d.id))} className="accent-sky-500" />{d.title || d.id}</label>;
                      })}
                    </div>
                  )}
                </div>
              )}
              <div className="relative">
                <button onClick={() => setMenu(m => (m === "layouts" ? "" : "layouts"))} className="rounded-full bg-white/10 px-2.5 py-1 hover:bg-white/20">Layouts</button>
                {menu === "layouts" && (
                  <div className="absolute left-1/2 top-full z-[90] mt-2 w-64 -translate-x-1/2 rounded-2xl border bg-zinc-900 p-2 text-white shadow-2xl">
                    {Object.keys(presets).length === 0 && <p className="px-2 py-1.5 opacity-60">No saved layouts yet.</p>}
                    {Object.keys(presets).map(n => (
                      <div key={n} className="flex items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-white/10">
                        <button onClick={() => { put(build(presets[n])); setMenu(""); }} className="min-w-0 flex-1 truncate px-1.5 py-1 text-left" title="Use this layout">{n}</button>
                        <button onClick={() => dropPreset(n)} className="px-1.5 py-1 opacity-50 hover:opacity-100" title="Delete this saved layout">x</button>
                      </div>
                    ))}
                    <div className="mt-1 flex items-center gap-1 border-t border-white/10 pt-2">
                      <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && savePreset()} placeholder="Name this layout" className="min-w-0 flex-1 rounded-md border border-white/20 bg-transparent px-2 py-1 outline-none" />
                      <button onClick={savePreset} disabled={!nameDraft.trim()} className="rounded-md bg-white px-2 py-1 font-semibold text-zinc-900 disabled:opacity-40">Save</button>
                    </div>
                  </div>
                )}
              </div>
              <button onClick={reset} className="rounded-full bg-white/10 px-2.5 py-1 hover:bg-white/20">Reset</button>
              <button onClick={() => { setMenu(""); setEdit(false); }} className="rounded-full bg-white px-3 py-1 font-semibold text-zinc-900">Done</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div ref={wrap} className={flow ? "relative flex flex-col gap-3" : "relative"} style={flow ? undefined : { height: bottom * ROW + 24 }}
        onPointerDown={e => { if (edit && e.target === e.currentTarget) setEdit(false); }}>
        {children}
      </div>
      {!edit && (
        <button onClick={() => setEdit(true)} title="Long-press any card to do the same" className="mx-auto mt-4 block text-[11px] opacity-40 hover:opacity-80">Customize layout</button>
      )}
    </BoardCtx.Provider>
  );
}

/** One card of a board. "dark" = charcoal, "frost" = frosted glass; a button when it has an onClick.
 *  On a TileBoard (with an id) it can be moved, resized, long-pressed and stacked; className only applies when the board is a single column. */
export function Tile({ id, className = "", tone = "frost", onClick, title, heading, aside, children, delay = 0 }: {
  id?: string; className?: string; tone?: "dark" | "frost"; onClick?: () => void; title?: string; heading?: string; aside?: React.ReactNode; children: React.ReactNode; delay?: number;
}) {
  const board = React.useContext(BoardCtx);
  const ref = React.useRef<HTMLElement | null>(null);
  const press = React.useRef<{ t: number; x: number; y: number } | null>(null);
  const longPressed = React.useRef(false);
  const p = board && id ? board.place(id) : null;
  const abs = !!board && !board.flow && !!p;
  const depth = p?.depth ?? 0, count = p?.count ?? 1, slot = p?.slot ?? "";

  // Scrolling over a deck flips through it.
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !board || count < 2 || depth !== 0) return;
    let last = 0;
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      const now = Date.now();
      if (now - last < 380) return;
      last = now;
      board.rotate(slot, e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [board, count, depth, slot]);

  const editing = !!board?.edit && !!id && depth === 0;
  const dragging = !!board?.drag && board.drag.slot === slot && !!id;
  const target = !!board?.drag && board.drag.over === slot && !!id;
  const down = (e: React.PointerEvent) => {
    if (!board || !id || depth !== 0 || board.flow || (e.target as HTMLElement).closest("[data-resize],[data-split]")) return;
    longPressed.current = false;
    if (board.edit) { e.preventDefault(); board.startDrag(id, e); return; }
    const x = e.clientX, y = e.clientY;
    const timer = window.setTimeout(() => { longPressed.current = true; press.current = null; board.enterEdit(); board.startDrag(id, { clientX: x, clientY: y }); }, 480);
    press.current = { t: timer, x, y };
  };
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.t); press.current = null; } };
  const moved = (e: React.PointerEvent) => { const pr = press.current; if (pr && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > 8) cancelPress(); };

  const hovered = !!p?.hovered && count > 1;
  const body = (
    <>
      {(heading || aside) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-[13px] font-medium tracking-tight opacity-85">{heading}</p>
          {aside}
        </div>
      )}
      <div data-body className={depth > 0 ? "invisible" : ""}>{children}</div>
      {id && abs && depth === 0 && (
        <span role="separator" aria-label="Resize card" data-resize title="Drag to resize" onPointerDown={e => { e.preventDefault(); e.stopPropagation(); board!.startResize(id, e); }} onClick={e => e.stopPropagation()}
          className={"absolute bottom-1 right-1 z-10 h-5 w-5 cursor-nwse-resize touch-none transition-opacity " + (editing ? "opacity-70" : "opacity-0 hover:opacity-70")}
          style={{ background: "linear-gradient(135deg, transparent 55%, currentColor 55% 62%, transparent 62% 76%, currentColor 76% 83%, transparent 83%)" }} />
      )}
      {editing && board?.hideable && !!id && (
        <span role="button" data-split title="Remove this card (add it back from Cards)" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); board.hide(id); }}
          className="absolute left-2 top-2 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/40 text-[11px] font-bold leading-none text-white backdrop-blur hover:bg-rose-600">-</span>
      )}
      {count > 1 && depth === 0 && (
        <>
          <span className="pointer-events-none absolute right-3 bottom-2 z-10 flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[9px] font-semibold text-white backdrop-blur" title="Scroll to flip through the deck">
            {Array.from({ length: count }).map((_, i) => <span key={i} className={"h-1.5 w-1.5 rounded-full " + (i === 0 ? "bg-white" : "bg-white/40")} />)}
          </span>
          {editing && (
            <span role="button" data-split onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); board!.split(slot); }} className="absolute left-3 bottom-2 z-10 cursor-pointer rounded-full bg-black/35 px-2.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur hover:bg-black/55">Split deck</span>
          )}
        </>
      )}
    </>
  );

  const posStyle: React.CSSProperties = abs ? {
    position: "absolute", left: (p!.box.x / COLS) * 100 + "%", top: p!.box.y * ROW + GAP / 2, width: "calc(" + (p!.box.w / COLS) * 100 + "% - " + GAP + "px)", height: p!.box.h * ROW - GAP, marginLeft: GAP / 2,
    zIndex: dragging ? 60 : 5 + (hovered ? 20 : 0) - depth,
    transition: dragging ? "none" : "left .22s ease, top .22s ease, width .22s ease, height .22s ease",
    ...(dragging ? { translate: board!.drag!.dx + "px " + board!.drag!.dy + "px" } : {}),
    ...(depth > 0 ? { pointerEvents: "none" as const } : {}),
  } : board && p ? { order: p.order } : {};
  const common = className.replace(abs ? /\bmin-h-\[[^\]]+\]/g : /$^/, "") + " " + (tone === "dark" ? "sd-dark" : "sd-frost") + " @container rounded-[1.6rem] border p-5 text-left transition-colors " + (abs ? "overflow-auto" : "relative overflow-hidden") + (editing ? " select-none touch-none shadow-2xl" : "") + (target ? " ring-2 ring-sky-400" : "") + (board && !abs ? " w-full" : "");

  const back = depth > 0;
  const anim = {
    opacity: depth > 2 ? 0 : depth === 0 ? 1 : depth === 1 ? 0.95 : 0.8,
    y: back ? -(hovered ? (depth === 1 ? 36 : 62) : depth * 8) : 0,
    scale: dragging ? 1.04 : back ? 1 - depth * (hovered ? 0.02 : 0.03) : target ? 0.97 : editing ? 1.02 : 1,
    rotate: back && hovered ? (depth === 1 ? -1.6 : 1.4) : editing && !dragging ? ([-0.9, 0.9] as number[]) : 0,
  };
  const tr = { delay, duration: 0.4, y: { type: "spring" as const, stiffness: 300, damping: 24 }, scale: { type: "spring" as const, stiffness: 300, damping: 24 }, rotate: editing && !dragging && !back ? { repeat: Infinity, repeatType: "reverse" as const, duration: 0.14 + ((id || "").length % 5) * 0.012, ease: "easeInOut" as const } : { duration: 0.2 } };
  const shared = {
    ref: ref as any, style: posStyle, "data-tile": id, initial: { opacity: 0, y: 14 }, animate: anim, transition: tr,
    onPointerDown: down, onPointerUp: cancelPress, onPointerLeave: () => { cancelPress(); board?.hover(null); }, onPointerEnter: () => { if (count > 1) board?.hover(slot); }, onPointerMove: moved,
    onContextMenu: (e: React.MouseEvent) => { if (board?.edit || longPressed.current) e.preventDefault(); },
  };
  if (id && board?.hidden.includes(id)) return null;
  if (!onClick) return <motion.div {...shared} className={common}>{body}</motion.div>;
  return (
    <motion.button {...shared} whileHover={editing || back ? undefined : { y: -3 }} whileTap={editing || back ? undefined : { scale: 0.99 }}
      onClickCapture={e => { if (editing || longPressed.current || dragging) { e.preventDefault(); e.stopPropagation(); longPressed.current = false; } }}
      onClick={onClick} title={title} className={common + " cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-current block"}>
      {body}
    </motion.button>
  );
}

/**
 * A video that plays (muted, looping) while the pointer is over its card and rests on a frame otherwise.
 * The listeners sit on the card around the video, so labels or tints laid over the video do not stop it.
 */
export function HoverVideo({ src, className = "" }: { src: string; className?: string }) {
  const v = React.useRef<HTMLVideoElement>(null);
  React.useEffect(() => {
    const video = v.current;
    const card = video?.parentElement;
    if (!video || !card) return;
    const play = () => { video.currentTime = 0; video.play().catch(() => {}); };
    const rest = () => { video.pause(); video.currentTime = 0.4; };
    card.addEventListener("pointerenter", play);
    card.addEventListener("pointerleave", rest);
    return () => { card.removeEventListener("pointerenter", play); card.removeEventListener("pointerleave", rest); };
  }, [src]);
  return <video ref={v} src={src + "#t=0.4"} muted loop playsInline preload="metadata" className={className} />;
}

export const hours = (min: number) => (min >= 90 ? `${Math.round(min / 60)} h` : `${Math.max(1, Math.round(min))} min`);

/** Big thin page title, like a poster. */
export function PageTitle({ children, small }: { children: React.ReactNode; small?: boolean }) {
  return <h1 className={`relative text-center font-extralight tracking-tight select-none ${small ? "text-3xl sm:text-5xl mb-4" : "text-4xl sm:text-6xl mb-5"}`}>{children}</h1>;
}
