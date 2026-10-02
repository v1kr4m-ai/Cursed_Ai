import React from "react";
import { Loader2, Power, FolderOpen } from "lucide-react";
import { FolderPickerDialog } from "./FolderPickerDialog";

/**
 * Real ComfyUI status + one-click start. Polls /api/comfyui/status; the
 * button asks the server to launch ComfyUI only if it isn't already up.
 */
export function ComfyStatus({ onReady }: { onReady?: () => void }) {
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

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className={`flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${running ? "text-emerald-400" : "text-zinc-500"}`}>
        <span className={`w-2 h-2 rounded-full ${running ? "bg-emerald-500" : "bg-zinc-600"}`} />
        ComfyUI {running === null ? "..." : running ? "running" : "stopped"}
      </span>
      {!running && (
        <button
          onClick={start}
          disabled={starting}
          className="flex items-center gap-2 bg-white/5 hover:bg-white/10 disabled:opacity-60 text-zinc-300 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl"
        >
          {starting ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
          {starting ? "Starting (can take a minute)..." : "Start ComfyUI"}
        </button>
      )}
      <button
        onClick={() => setPickerOpen(true)}
        title={folder || "Choose your ComfyUI folder"}
        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-zinc-400 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl"
      >
        <FolderOpen size={12} /> {folder ? "Change folder" : "Set ComfyUI folder"}
      </button>
      <FolderPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} initialPath={folder || ""} title="Choose ComfyUI Folder" onSelect={saveFolder} />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
