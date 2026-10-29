import React from "react";
import { Loader2, Power, PowerOff, FolderOpen, MemoryStick } from "lucide-react";
import { freeComfyMemory, stopComfy } from "../../services/comfyPower";
import { notify } from "../../lib/notify";
import { FolderPickerDialog } from "./FolderPickerDialog";

/**
 * Real ComfyUI status + one-click start. Polls /api/comfyui/status; the
 * button asks the server to launch ComfyUI only if it isn't already up.
 */
export function ComfyStatus({ onReady, compact = false }: { onReady?: () => void; compact?: boolean }) {
  const [running, setRunning] = React.useState<boolean | null>(null);
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [folder, setFolder] = React.useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const wasRunning = React.useRef(false);

  const check = React.useCallback(async () => {
    try {
      const data = await (await fetch("/api/comfyui/status")).json();
      setRunning(data.running);
      setFolder(data.folder);
      if (data.running && !wasRunning.current) onReady?.();
      wasRunning.current = data.running;
    } catch {
      setRunning(false);
    }
  }, [onReady]);

  React.useEffect(() => {
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [check]);

  const saveFolder = async (p: string) => {
    setError(null);
    try {
      const resp = await fetch("/api/comfyui/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: p }) });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setFolder(data.folder);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const resp = await fetch("/api/comfyui/start", { method: "POST" });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to start ComfyUI");
      await check();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const [stopping, setStopping] = React.useState(false);
  const stop = async () => {
    if (!confirm("Stop ComfyUI? Anything it is rendering now is lost. Its GPU memory goes back to the offline language models.")) return;
    setStopping(true); setError(null);
    try { await stopComfy(); notify({ message: "ComfyUI stopped - its GPU memory is free" }); await check(); } catch (e: any) { setError(e.message); } finally { setStopping(false); }
  };
  const free = async () => {
    setError(null);
    try { await freeComfyMemory(); notify({ message: "ComfyUI let go of its models - GPU memory is free, ComfyUI keeps running" }); } catch (e: any) { setError(e.message); }
  };

  // In a light page (Series) the buttons take the page's own colour; elsewhere they are the dark app's glass.
  const tone = compact ? "bg-current/10 hover:bg-current/20 text-current" : "bg-white/5 hover:bg-white/10 text-zinc-300";
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${running ? "text-emerald-500" : compact ? "opacity-70" : "text-zinc-500"}`}>
        <span className={`w-2 h-2 rounded-full ${running ? "bg-emerald-500" : "bg-zinc-600"}`} />
        ComfyUI {running === null ? "..." : running ? "running" : "stopped"}
      </span>
      {!running && (
        <button
          onClick={start}
          disabled={starting}
          className={"flex items-center gap-2 disabled:opacity-60 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl " + tone}
        >
          {starting ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
          {starting ? "Starting (can take a minute)..." : "Start ComfyUI"}
        </button>
      )}
      {running && (
        <>
          <button onClick={free} title="Keep ComfyUI running but unload its models from the GPU, so an offline language model fits" className={"flex items-center gap-2 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl " + tone}><MemoryStick size={12} /> Free GPU memory</button>
          <button onClick={stop} disabled={stopping} title="Stop ComfyUI completely" className="flex items-center gap-2 bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-60 text-rose-200 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl">{stopping ? <Loader2 size={12} className="animate-spin" /> : <PowerOff size={12} />}{stopping ? "Stopping..." : "Stop ComfyUI"}</button>
        </>
      )}
      {!compact && <button
        onClick={() => setPickerOpen(true)}
        title={folder || "Choose your ComfyUI folder"}
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-zinc-400 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl"
      >
        <FolderOpen size={12} /> {folder ? "Change folder" : "Set ComfyUI folder"}
      </button>}
      <FolderPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} initialPath={folder || ""} title="Choose ComfyUI Folder" onSelect={saveFolder} />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
