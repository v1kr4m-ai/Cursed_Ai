import React from "react";

const KEY = "cursed.uiSize";
export type UiSize = "small" | "default" | "large";

export function applyUiSize(size: UiSize) {
  document.documentElement.dataset.ui = size;
}
export function savedUiSize(): UiSize {
  try { const v = localStorage.getItem(KEY); return v === "small" || v === "large" ? v : "default"; } catch { return "default"; }
}

/** Settings: how big the whole interface is. Everything in the app scales together. */
export function AppearanceSettings() {
  const [size, setSize] = React.useState<UiSize>(savedUiSize);
  const choose = (s: UiSize) => {
    setSize(s); applyUiSize(s);
    try { localStorage.setItem(KEY, s); } catch { /* storage blocked */ }
  };
  return (
    <section className="space-y-6">
      <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5 pb-3">Appearance</h3>
      <div className="glass p-6 rounded-[2rem] border-white/5 flex items-center justify-between gap-6">
        <div className="space-y-1">
          <p className="text-zinc-100 font-bold tracking-tight">Interface size</p>
          <p className="text-xs text-zinc-500">Makes text, buttons and spacing smaller or larger everywhere. Applies instantly and is remembered.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          {([["small", "Small"], ["default", "Default"], ["large", "Large"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => choose(id)}
              className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${size === id ? "bg-violet-600 text-white" : "bg-white/5 text-zinc-500 hover:bg-white/10"}`}>{label}</button>
          ))}
        </div>
      </div>
    </section>
  );
}
