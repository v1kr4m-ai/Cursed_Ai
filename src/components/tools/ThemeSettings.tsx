import React from "react";
import { Check } from "lucide-react";
import { AppSettings } from "../../types";
import { THEMES, THEME_MODULES, Theme, themeById } from "../../lib/themes";

/** A tiny mock of the app (sidebar, chat, cards, button) drawn with the real classes, so it shows exactly how a theme looks. */
export function ThemePreview({ theme, compact }: { theme: Theme; compact?: boolean }) {
  return (
    <div data-theme={theme.id} className={`flex gap-1.5 rounded-xl p-1.5 overflow-hidden ${compact ? "h-[4.5rem] w-32" : "h-36"}`}
      style={{ backgroundImage: "var(--t-atmo), var(--t-page)", backgroundColor: "var(--t-bg)", color: "var(--t-text)" }}>
      <div className="glass rounded-lg w-6 shrink-0 flex flex-col items-center gap-1 py-1.5">
        <span className="w-3 h-3 rounded bg-violet-500" />
        {[0, 1, 2].map(i => <span key={i} className="w-3 h-3 rounded bg-white/10" />)}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="ai-bubble rounded-lg px-2 py-1 text-[8px] leading-tight text-zinc-100 w-4/5">How can I help today?</div>
        <div className="user-bubble rounded-lg px-2 py-1 text-[8px] leading-tight self-end w-3/5">Make me a poster</div>
        {!compact && (
          <div className="flex gap-1 mt-auto">
            <div className="glass rounded-lg flex-1 p-1.5"><div className="h-1 rounded-full bg-white/10 overflow-hidden"><div className="h-full w-2/3 bg-violet-500" /></div><p className="text-[7px] text-zinc-400 mt-1">Rendering</p></div>
            <div className="glass rounded-lg flex-1 p-1.5"><p className="text-[10px] font-semibold text-zinc-100 leading-none">12</p><p className="text-[7px] text-zinc-400 mt-1">Scenes</p></div>
            <span className="self-end rounded-md bg-violet-600 text-white text-[7px] font-bold px-2 py-1">Go</span>
          </div>
        )}
      </div>
    </div>
  );
}

const seg = (on: boolean) => `px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${on ? "bg-violet-600 text-white" : "bg-white/5 text-zinc-500 hover:bg-white/10"}`;

/** Settings → Appearance → Theme: one theme for the whole app, or a different one per module. */
export function ThemeSettings({ settings, set }: { settings: AppSettings; set: (patch: Partial<AppSettings>) => void }) {
  const modules = settings.themeMode === "modules";
  const own = settings.moduleThemes || {};
  const setModule = (id: string, theme: string | null) => {
    const next = { ...own };
    if (theme) next[id] = theme; else delete next[id];
    set({ moduleThemes: next });
  };
  return (
    <section className="mb-8">
      <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] border-b border-white/5 pb-3">Theme</h3>
      <div className="glass rounded-[1.75rem] px-6 py-4 mt-4 flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-zinc-100 font-bold tracking-tight text-sm">Apply theme</p>
          <p className="text-xs text-zinc-500 leading-snug mt-0.5">{modules ? "The global theme is the default; give any module its own below." : "One theme for the whole app."}</p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button className={seg(!modules)} onClick={() => set({ themeMode: "global" })}>Global</button>
          <button className={seg(modules)} onClick={() => set({ themeMode: "modules" })}>Per module</button>
        </div>
      </div>

      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] mt-6 mb-3">{modules ? "Global (default) theme" : "Choose a theme"}</p>
      <div className="grid gap-3 grid-cols-2 xl:grid-cols-3">
        {THEMES.map(t => {
          const on = themeById(settings.theme).id === t.id;
          return (
            <button key={t.id} onClick={() => set({ theme: t.id })} className={`text-left rounded-2xl p-2 border transition-colors ${on ? "border-violet-500 bg-violet-500/10" : "border-white/10 hover:border-white/25 bg-white/[0.03]"}`}>
              <ThemePreview theme={t} />
              <div className="flex items-center gap-2 mt-2 px-1">
                <span className="text-sm font-bold tracking-tight text-zinc-100">{t.name}</span>
                <span className="text-[9px] uppercase tracking-widest text-zinc-500">{t.mode}</span>
                {on && <Check size={14} className="ml-auto text-violet-400" />}
              </div>
              <p className="text-[11px] text-zinc-500 leading-snug px-1 pb-1">{t.blurb}</p>
            </button>
          );
        })}
      </div>

      {modules && (
        <>
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] mt-8 mb-3">Theme per module</p>
          <div className="glass rounded-[1.75rem] px-6 py-2 divide-y divide-white/5">
            {THEME_MODULES.map(m => {
              const chosen = own[m.id];
              const shown = themeById(chosen || settings.theme);
              return (
                <div key={m.id} className="py-4 flex items-center gap-4">
                  <ThemePreview theme={shown} compact />
                  <div className="min-w-0 flex-1">
                    <p className="text-zinc-100 font-bold tracking-tight text-sm">{m.label}</p>
                    <p className="text-xs text-zinc-500 mb-2">{chosen ? shown.name : `Global - ${shown.name}`}</p>
                    <div className="flex flex-wrap gap-1.5">
                      <button onClick={() => setModule(m.id, null)} className={`${seg(!chosen)} !tracking-normal`}>Global</button>
                      {THEMES.map(t => (
                        <button key={t.id} onClick={() => setModule(m.id, t.id)} title={t.name} aria-label={`${m.label}: ${t.name}`}
                          className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${chosen === t.id ? "border-violet-400 scale-110" : "border-white/20"}`}
                          style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 0 45%, ${t.swatch[1]} 45% 75%, ${t.swatch[2]} 75%)` }} />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
