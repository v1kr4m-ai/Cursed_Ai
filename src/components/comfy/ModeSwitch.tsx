import React from "react";
import { ACCENT, Kind } from "./types";

export type LocalMode = "quick" | "workflows";

/** Remembered per tab in the browser so the page reopens where the person left it. */
export function useLocalMode(kind: Kind): [LocalMode, (m: LocalMode) => void] {
  const key = `cursed.comfyMode.${kind}`;
  const [mode, setMode] = React.useState<LocalMode>(() => {
    try { return localStorage.getItem(key) === "workflows" ? "workflows" : "quick"; } catch { return "quick"; }
  });
  const set = (m: LocalMode) => { setMode(m); try { localStorage.setItem(key, m); } catch { /* private window */ } };
  return [mode, set];
}

export function ModeSwitch({ kind, mode, onChange }: { kind: Kind; mode: LocalMode; onChange: (m: LocalMode) => void }) {
  const a = ACCENT[kind];
  const btn = (m: LocalMode, text: string) => (
    <button onClick={() => onChange(m)} className={`px-3.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors ${mode === m ? a.chip : "text-zinc-500 hover:text-zinc-300"}`}>{text}</button>
  );
  return <div className="inline-flex gap-1 p-1 rounded-xl bg-white/5">{btn("quick", "Quick")}{btn("workflows", "Workflows")}</div>;
}
