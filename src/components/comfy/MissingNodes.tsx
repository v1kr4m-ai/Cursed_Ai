import React from "react";
import { Check, Download, Loader2, Puzzle, RefreshCw } from "lucide-react";

interface Pack { id: string; title: string; url: string; installed: boolean; description: string }

const post = async (url: string, body?: unknown) => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Failed (${r.status})`);
  return d;
};

/**
 * The custom nodes a workflow needs that ComfyUI does not have: find the packs that provide them (ComfyUI-Manager's
 * node map), install the ones ticked, then restart ComfyUI so they load. `onDone` reloads the workflow list.
 */
export function MissingNodes({ types, onDone }: { types: string[]; onDone: () => void }) {
  const [packs, setPacks] = React.useState<Record<string, Pack[]> | null>(null);
  const [pick, setPick] = React.useState<Record<string, boolean>>({});
  const [step, setStep] = React.useState<"idle" | "finding" | "chosen" | "installing" | "installed" | "restarting">("idle");
  const [error, setError] = React.useState("");
  const [note, setNote] = React.useState("");

  const find = async () => {
    setStep("finding"); setError("");
    try {
      const d = await post("/api/comfyui/nodes/find", { types });
      setPacks(d.packs);
      const first: Record<string, boolean> = {};
      for (const list of Object.values<Pack[]>(d.packs)) { const p = list[0]; if (p && !p.installed) first[p.id] = true; }
      setPick(first); setStep("chosen");
    } catch (e: any) { setError(e.message); setStep("idle"); }
  };
  const install = async () => {
    const ids = Object.keys(pick).filter(k => pick[k]);
    if (!ids.length) return;
    setStep("installing"); setError("");
    try {
      const d = await post("/api/comfyui/nodes/install", { ids });
      setNote(`Installing ${d.queued.join(", ")}...`);
      for (let i = 0; i < 300; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const s = await (await fetch("/api/comfyui/nodes/status")).json();
        if (!s.is_processing && s.in_progress_count === 0) break;
        setNote(`Installing... ${s.done_count}/${s.total_count} done`);
      }
      setNote("Installed. Restart ComfyUI so the new nodes load."); setStep("installed");
    } catch (e: any) { setError(e.message); setStep("chosen"); }
  };
  const restart = async () => {
    setStep("restarting"); setError(""); setNote("Restarting ComfyUI (about a minute)...");
    try { await post("/api/comfyui/restart"); setNote("ComfyUI restarted with the new nodes."); setStep("idle"); setPacks(null); onDone(); }
    catch (e: any) { setError(e.message); setStep("installed"); }
  };

  const unknown = packs ? types.filter(t => !(packs[t] || []).length) : [];
  const allPacks = packs ? [...new Map(Object.values(packs).flat().map(p => [p.id, p])).values()] : [];
  const btn = "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold disabled:opacity-40";
  return (
    <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] text-amber-200">
      <div className="flex flex-wrap items-center gap-2">
        <Puzzle size={13} className="shrink-0" />
        <span className="min-w-0 flex-1">Needs {types.length} custom node{types.length === 1 ? "" : "s"}: <span className="font-mono text-amber-100/80">{types.join(", ")}</span></span>
        {step === "idle" && <button onClick={find} className={`${btn} bg-amber-500/25 hover:bg-amber-500/40`}><Download size={12} />Find and install</button>}
        {step === "finding" && <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Looking them up...</span>}
      </div>
      {packs && step !== "idle" && (
        <div className="space-y-1">
          {allPacks.map(p => (
            <label key={p.id} className="flex items-start gap-2 rounded-lg px-1 py-0.5 hover:bg-white/5" title={p.description}>
              <input type="checkbox" className="mt-0.5" checked={!!pick[p.id] || p.installed} disabled={p.installed || step !== "chosen"} onChange={e => setPick(x => ({ ...x, [p.id]: e.target.checked }))} />
              <span className="min-w-0 flex-1"><span className="text-amber-100">{p.title}</span>{p.installed && <span className="ml-1 text-emerald-300">(installed)</span>}<a href={p.url} target="_blank" rel="noreferrer" className="ml-1.5 text-amber-200/60 underline">source</a>
                <span className="block text-amber-200/60">provides {Object.entries(packs).filter(([, l]) => l.some(x => x.id === p.id)).map(([t]) => t).join(", ")}</span></span>
            </label>
          ))}
          {unknown.length > 0 && <p className="text-amber-200/70">Not found in ComfyUI-Manager's list: {unknown.join(", ")}. Search for them by name on GitHub.</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {step === "chosen" && <button onClick={install} disabled={!Object.values(pick).some(Boolean)} className={`${btn} bg-amber-500/30 hover:bg-amber-500/45`}><Download size={12} />Install ticked</button>}
            {(step === "installed" || step === "restarting") && <button onClick={restart} disabled={step === "restarting"} className={`${btn} bg-emerald-600/70 text-white hover:bg-emerald-600`}>{step === "restarting" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}Restart ComfyUI</button>}
          </div>
        </div>
      )}
      {note && <p className="flex items-center gap-1.5 text-amber-100/80">{step === "installing" || step === "restarting" ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}{note}</p>}
      {error && <p className="text-rose-300">{error}</p>}
    </div>
  );
}
