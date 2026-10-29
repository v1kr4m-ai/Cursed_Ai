import React from "react";
import { Globe, HardDrive, History } from "lucide-react";
import { ComfyStatus } from "../tools/ComfyStatus";
import { GeminiKeyButton } from "../tools/GeminiKeyButton";
import { GoogleDriveButton } from "./google";
import { ModeSwitch, LocalMode } from "./ModeSwitch";
import { ACCENT, Kind } from "./types";

export type Source = "cloud" | "local";

/** Slim top bar shared by every mode: title, Cloud / Local, Quick / Workflows, History, and the key (cloud) or ComfyUI status (local). */
export function StudioToolbar({ kind, icon, title, source, onSource, mode, onMode, showHistory, onHistory }: {
  kind: Kind; icon: React.ReactNode; title: string; source: Source; onSource: (s: Source) => void;
  mode: LocalMode; onMode: (m: LocalMode) => void; showHistory: boolean; onHistory: () => void;
}) {
  const a = ACCENT[kind];
  const seg = (on: boolean) => `px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-colors ${on ? a.chip : "text-zinc-500 hover:text-zinc-300"}`;
  return (
    <div className="shrink-0 flex items-center gap-x-4 gap-y-2 flex-wrap">
      <h1 className="text-lg font-black text-white tracking-tighter flex items-center gap-2.5 mr-1">{icon}{title}</h1>
      {kind !== "audio" && <div className="inline-flex gap-1 p-1 rounded-xl bg-white/5">
        <button onClick={() => onSource("local")} className={seg(source === "local")}><HardDrive size={12} /> Local</button>
        <button onClick={() => onSource("cloud")} className={seg(source === "cloud")}><Globe size={12} /> Cloud</button>
      </div>}
      {source === "local" && kind !== "audio" && <ModeSwitch kind={kind} mode={mode} onChange={onMode} />}
      {source === "cloud" && kind !== "audio" && <GeminiKeyButton tab={kind} accent={kind === "image" ? "pink" : "orange"} />}
      <button onClick={onHistory} title="Everything generated so far" className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-colors ${showHistory ? a.chip : "bg-white/5 text-zinc-400 hover:bg-white/10"}`}><History size={12} /> History</button>
      <GoogleDriveButton />
      <div className="ml-auto">{source === "local" || kind === "audio" ? <ComfyStatus /> : <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Needs internet</span>}</div>
    </div>
  );
}
