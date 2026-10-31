import React from "react";
import { FineTuneView } from "./FineTuneView";
import { MobileTrainView } from "./MobileTrainView";
import { Tabs } from "./ui";

type Target = "pc" | "mobile";
const KEY = "cursed.finetune.target";

/** The FineTune tab: a PC / Phone switch above the two pages. Both stay mounted, so nothing typed on one is lost when you switch. */
export function FineTuneSwitch() {
  const [target, setTarget] = React.useState<Target>(() => { try { return localStorage.getItem(KEY) === "mobile" ? "mobile" : "pc"; } catch { return "pc"; } });
  const choose = (t: Target) => { setTarget(t); try { localStorage.setItem(KEY, t); } catch { /* storage blocked */ } };
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-3 px-3">
        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Train for</span>
        <Tabs<Target> value={target} onChange={choose} tabs={[{ id: "pc", label: "PC (Ollama)" }, { id: "mobile", label: "Phone" }]} />
        <span className="truncate text-[11px] text-zinc-600">{target === "pc" ? "Models you chat with on this PC" : "Small models exported for an Android app"}</span>
      </div>
      <div className={target === "pc" ? "contents" : "hidden"}><FineTuneView /></div>
      <div className={target === "mobile" ? "contents" : "hidden"}><MobileTrainView /></div>
    </div>
  );
}
