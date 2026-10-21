import React from "react";

/**
 * Long-press any block in a ReorderGroup and the blocks wiggle; drag one over another to change the order.
 * The order is remembered per group. Blocks opt in with useReorderItem (or the Reorderable wrapper); the group must be a flex or grid container
 * (it orders with CSS "order", so nothing is re-mounted and open sections stay open).
 */
interface Api {
  group: string;
  edit: boolean;
  dragId: string | null;
  register: (id: string) => () => void;
  indexOf: (id: string) => number;
  hidden: string[];
  hide: (id: string) => void;
  show: (id: string) => void;
  enter: () => void;
  startDrag: (id: string, e: { clientX: number; clientY: number }, el: HTMLElement) => void;
}
const Ctx = React.createContext<Api | null>(null);

const read = (key: string): string[] => { try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

export function ReorderGroup({ id, className = "", children }: { id: string; className?: string; children: React.ReactNode }) {
  const key = "cursed.reorder." + id;
  const [saved, setSaved] = React.useState<string[]>(() => read(key));
  const [known, setKnown] = React.useState<string[]>([]);
  const hiddenKey = key + ".hidden";
  const [hidden, setHidden] = React.useState<string[]>(() => read(hiddenKey));
  const [menu, setMenu] = React.useState(false);
  const setHiddenSaved = (next: string[]) => { setHidden(next); try { localStorage.setItem(hiddenKey, JSON.stringify(next)); } catch { /* storage blocked */ } };
  const [edit, setEdit] = React.useState(false);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const drag = React.useRef<{ el: HTMLElement; gx: number; gy: number; x: number; y: number } | null>(null);
  const order = [...saved.filter(x => known.includes(x)), ...known.filter(x => !saved.includes(x))];
  const orderRef = React.useRef(order);
  orderRef.current = order;

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
  React.useLayoutEffect(place, [saved, dragId]);

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
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest("[data-ri]") as HTMLElement | null;
      const overId = over && over.dataset.rg === id ? over.dataset.ri : undefined;
      if (overId && overId !== tid) {
        const cur = orderRef.current, from = cur.indexOf(tid), to = cur.indexOf(overId);
        if (from >= 0 && to >= 0 && from !== to) { const next = [...cur]; next.splice(from, 1); next.splice(to, 0, tid); setSaved(next); }
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      const d = drag.current;
      drag.current = null;
      if (d) { d.el.style.translate = ""; d.el.style.pointerEvents = ""; }
      setDragId(null);
      try { localStorage.setItem(key, JSON.stringify(orderRef.current)); } catch { /* storage blocked */ }
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };

  const api: Api = {
    group: id, edit, dragId, startDrag, enter: () => setEdit(true),
    register: rid => { setKnown(k => (k.includes(rid) ? k : [...k, rid])); return () => setKnown(k => k.filter(x => x !== rid)); },
    indexOf: rid => order.indexOf(rid),
    hidden, hide: rid => setHiddenSaved([...hidden.filter(x => x !== rid), rid]), show: rid => setHiddenSaved(hidden.filter(x => x !== rid)),
  };
  return (
    <Ctx.Provider value={api}>
      <div className={className} style={{ display: "contents" }}>
        {edit && (
          <div className="fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-zinc-900/90 px-3 py-1.5 text-[11px] text-zinc-200 shadow-2xl backdrop-blur">
            <span className="opacity-70">Drag a block to reorder</span>
            <div className="relative">
              <button onClick={() => setMenu(m => !m)} className="rounded-full bg-white/10 px-2.5 py-0.5 hover:bg-white/20">Blocks ({known.length - hidden.filter(h => known.includes(h)).length}/{known.length})</button>
              {menu && (
                <div className="absolute bottom-full left-1/2 mb-2 w-52 -translate-x-1/2 rounded-2xl border border-white/15 bg-zinc-900 p-2 shadow-2xl">
                  {order.map(b => { const on = !hidden.includes(b); return <label key={b} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/10"><input type="checkbox" checked={on} onChange={() => (on ? api.hide(b) : api.show(b))} className="accent-sky-500" />{b}</label>; })}
                </div>
              )}
            </div>
            <button onClick={() => { try { localStorage.removeItem(key); } catch { /* storage blocked */ } setSaved([]); setHiddenSaved([]); }} className="rounded-full bg-white/10 px-2.5 py-0.5 hover:bg-white/20">Reset</button>
            <button onClick={() => { setMenu(false); setEdit(false); }} className="rounded-full bg-white px-3 py-0.5 font-semibold text-zinc-900">Done</button>
          </div>
        )}
        {children}
      </div>
    </Ctx.Provider>
  );
}

/** Spread the result onto the block's root element. Outside a ReorderGroup it does nothing. */
export function useReorderItem(id: string): Record<string, any> {
  const g = React.useContext(Ctx);
  const ref = React.useRef<HTMLElement | null>(null);
  const press = React.useRef<{ t: number; x: number; y: number } | null>(null);
  const suppress = React.useRef(false);
  React.useEffect(() => (g ? g.register(id) : undefined), [g?.group, id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g) return {};
  const cancel = () => { if (press.current) { clearTimeout(press.current.t); press.current = null; } };
  const dragging = g.dragId === id;
  return {
    ref, "data-ri": id, "data-rg": g.group,
    style: { order: g.indexOf(id), position: "relative", ...(dragging ? { zIndex: 40 } : {}), ...(g.hidden.includes(id) ? { display: "none" } : {}) },
    className: (g.edit ? (dragging ? "ri-drag" : "ri-wiggle") + " select-none touch-none" : ""),
    onPointerDown: (e: React.PointerEvent) => {
      suppress.current = false;
      const el = ref.current;
      if (!el) return;
      if (g.edit) { e.preventDefault(); g.startDrag(id, e, el); return; }
      const x = e.clientX, y = e.clientY;
      press.current = { x, y, t: window.setTimeout(() => { press.current = null; suppress.current = true; g.enter(); g.startDrag(id, { clientX: x, clientY: y }, el); }, 480) };
    },
    onPointerUp: cancel, onPointerLeave: cancel,
    onPointerMove: (e: React.PointerEvent) => { const p = press.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) cancel(); },
    onClickCapture: (e: React.MouseEvent) => { if ((e.target as HTMLElement).closest("[data-rh]")) return; if (g.edit || suppress.current) { e.preventDefault(); e.stopPropagation(); suppress.current = false; } },
  };
}

/** The minus on a block while reordering; put it inside the block. */
export function ReorderHide({ id }: { id: string }) {
  const g = React.useContext(Ctx);
  if (!g || !g.edit) return null;
  return <span role="button" data-rh title="Hide this block (bring it back from Blocks)" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); g.hide(id); }} className="absolute right-2 top-2 z-20 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/50 text-[11px] font-bold leading-none text-white hover:bg-rose-600">-</span>;
}

/** A plain block that can be reordered and hidden. */
export function Reorderable({ id, className = "", children }: { id: string; className?: string; children: React.ReactNode }) {
  const { className: extra = "", ...bind } = useReorderItem(id);
  return <div {...bind} className={className + " " + extra}><ReorderHide id={id} />{children}</div>;
}
