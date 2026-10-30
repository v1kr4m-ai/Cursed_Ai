import React from "react";
import { FolderOpen, Loader2, Power } from "lucide-react";
import { nativeFolder } from "../comfy/types";
import { notify, notifyError } from "../../lib/notify";
import { pickFolder } from "./pickFolder";

/** LM Studio status with a Start button (like ComfyUI's) and a way to point at its install folder. */
export function LmStudioControl() {
  const [st, setSt] = React.useState<{ running: boolean; starting: boolean; path: string | null } | null>(null);
  const [busy, setBusy] = React.useState(false);

  const check = React.useCallback(() => fetch("/api/lmstudio/status").then(r => r.json()).then(setSt).catch(() => {}), []);
  React.useEffect(() => { check(); const t = setInterval(check, 5000); return () => clearInterval(t); }, [check]);

  const start = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/lmstudio/start", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not start LM Studio");
      notify({ message: "LM Studio is running", tab: "settings" });
      window.dispatchEvent(new Event("cursed:models-changed"));
    } catch (e: any) { notifyError(e.message, "settings"); }
    finally { setBusy(false); check(); }
  };
  const choose = async () => {
    const p = await pickFolder(st?.path || undefined, "LM Studio folder");
    if (!p) return;
    try {
      const r = await fetch("/api/lmstudio/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      check();
    } catch (e: any) { notifyError(e.message, "settings"); }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <span className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${st?.running ? "text-emerald-400" : "text-zinc-500"}`}>
        <span className={`w-2 h-2 rounded-full ${st?.running ? "bg-emerald-500" : "bg-zinc-600"}`} />
        {st === null ? "..." : st.running ? "running" : "stopped"}
      </span>
      {st && !st.running && (
        <button onClick={start} disabled={busy} title={st.path || "LM Studio was not found - choose its folder"} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-[10px] font-black uppercase tracking-widest disabled:opacity-60">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}{busy ? "Starting..." : "Start LM Studio"}
        </button>
      )}
      <button onClick={choose} title={st?.path || "Choose the LM Studio folder"} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-400 text-[10px] font-black uppercase tracking-widest"><FolderOpen size={12} /> Folder</button>
    </div>
  );
}
