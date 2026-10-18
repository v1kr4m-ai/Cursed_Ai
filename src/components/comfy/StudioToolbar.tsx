import React from "react";
import { Globe, HardDrive } from "lucide-react";
import { ComfyStatus } from "../tools/ComfyStatus";
import { ModeSwitch, LocalMode } from "./ModeSwitch";
import { ACCENT, Kind } from "./types";

/** Slim top bar of the offline studio: title, Cloud/Local, Quick/Workflows and the ComfyUI status in one row. */
export function StudioToolbar({ kind, icon, title, onCloud, mode, onMode }: { kind: Kind; icon: React.ReactNode; title: string; onCloud: () => void; mode: LocalMode; onMode: (m: LocalMode) => void }) {
  const a = ACCENT[kind];
  return (
    <div className="shrink-0 flex items-center gap-x-4 gap-y-2 flex-wrap">
      <h1 className="text-lg font-black text-white tracking-tighter flex items-center gap-2.5 mr-1">{icon}{title}</h1>
      <div className="inline-flex gap-1 p-1 rounded-xl bg-white/5">
        <button onClick={onCloud} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-300 flex items-center gap-1.5 transition-colors"><Globe size={12} /> Cloud</button>
        <button className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 ${a.chip}`}><HardDrive size={12} /> Local</button>
      </div>
      <ModeSwitch kind={kind} mode={mode} onChange={onMode} />
      <div className="ml-auto"><ComfyStatus /></div>
    </div>
  );
}
