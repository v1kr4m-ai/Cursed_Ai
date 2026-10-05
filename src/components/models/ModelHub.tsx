import React from "react";
import { Download, Search, Loader2, X, CheckCircle2, AlertTriangle, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { FlagChip, FitBadge, formatBytes } from "./flags";
import { notify, notifyError } from "../../lib/notify";
import { fitFor, paramsToBytes, useSystemInfo } from "../../lib/ramFit";

interface HubModel {
  source: "hf" | "ollama" | "comfy";
  id: string;
  name: string;
  publisher: string;
  description: string;
  sizes?: string[];
  tags: string[];
}
interface HubFile { file: string; size: number; quant: string; split: boolean; vision: boolean; kind?: string }
interface Job {
  id: string; source: string; label: string; status: "running" | "done" | "error" | "cancelled";
  progress: number; received: number; total: number; message: string; error?: string; dest?: string;
}

/**
 * Browse and download models from Hugging Face (GGUF files, saved into the
 * models folder) or the Ollama library (pulled by the Ollama app itself).
 */
export function ModelHub({ source, flag, onInstalled }: { source: "hf" | "ollama" | "comfy"; flag: string | null; onInstalled: () => void }) {
  // ComfyUI view: image or video checkpoints, saved into ComfyUI's own models folder.
  const [kind, setKind] = React.useState<"image" | "video">("image");
  const [folder, setFolder] = React.useState("checkpoints");
  const [comfy, setComfy] = React.useState<{ root: string | null; folders: string[] }>({ root: null, folders: [] });
  React.useEffect(() => {
    if (source === "comfy") fetch("/api/hub/comfy-dirs").then(r => r.json()).then(setComfy).catch(() => {});
  }, [source]);
  const sys = useSystemInfo();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<HubModel[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [picker, setPicker] = React.useState<HubModel | null>(null);
  const [files, setFiles] = React.useState<HubFile[] | null>(null);
  const [filesError, setFilesError] = React.useState<string | null>(null);

  // Search (debounced); an empty query lists the most popular models.
  React.useEffect(() => {
    setLoading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const resp = await fetch(`/api/hub/search?source=${source}&q=${encodeURIComponent(query)}&kind=${kind}`);
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error);
        setResults(data.results);
      } catch (e: any) {
        setResults([]);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, query ? 450 : 0);
    return () => clearTimeout(t);
  }, [source, query, kind]);

  // Poll downloads while any is running; tell the app when one finishes.
  const doneSeen = React.useRef(new Set<string>());
  const pollJobs = React.useCallback(async () => {
    try {
      const data = await (await fetch("/api/hub/downloads")).json();
      setJobs(data.downloads);
      for (const j of data.downloads as Job[]) {
        if (j.status === "done" && !doneSeen.current.has(j.id)) { doneSeen.current.add(j.id); onInstalled(); notify({ message: `Model downloaded: ${j.label}`, tab: "models" }); }
        if (j.status === "error" && !doneSeen.current.has(j.id)) { doneSeen.current.add(j.id); notifyError(`Download failed (${j.label}): ${j.error}`, "models"); }
      }
    } catch { /* server restarting */ }
  }, [onInstalled]);
  React.useEffect(() => { pollJobs(); }, [pollJobs]);
  const anyRunning = jobs.some(j => j.status === "running");
  React.useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(pollJobs, 1000);
    return () => clearInterval(t);
  }, [anyRunning, pollJobs]);

  const start = async (body: object) => {
    setError(null);
    const resp = await fetch("/api/hub/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!resp.ok) { const m = (await resp.json()).error || "Couldn't start the download"; setError(m); notifyError(m, "models"); return; }
    pollJobs();
  };
  const cancel = async (id: string) => { await fetch(`/api/hub/downloads/${id}/cancel`, { method: "POST" }); pollJobs(); };

  const openFiles = async (m: HubModel) => {
    setPicker(m); setFiles(null); setFilesError(null);
    try {
      const resp = await fetch(`/api/hub/hf-files?repo=${encodeURIComponent(m.id)}${source === "comfy" ? "&kind=comfy" : ""}`);
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setFiles(data.files);
    } catch (e: any) { setFilesError(e.message); }
  };

  const shown = flag && source !== "comfy" ? results.filter(m => m.tags.includes(flag)) : results;
  const isComfyJob = (j: Job) => j.label.startsWith("ComfyUI /");
  const visibleJobs = jobs.filter(j => source === "comfy" ? isComfyJob(j) : source === "hf" ? j.source === "hf" && !isComfyJob(j) : j.source === source).slice(0, 6);

  return (
    <div className="space-y-5">
      <div className="relative max-w-xl">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={source === "comfy" ? `Search Hugging Face ${kind} models for ComfyUI (e.g. sdxl, flux, ltx)...` : source === "hf" ? "Search Hugging Face GGUF models (e.g. qwen coder, llama 3)..." : "Search the Ollama library (e.g. qwen, deepseek-r1, llava)..."}
          className="pl-11 h-11 bg-white/5 border-white/10 text-zinc-100 rounded-2xl"
        />
        {loading && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-zinc-500" />}
      </div>

      <p className="text-[11px] text-zinc-500">
        {source === "comfy"
          ? (comfy.root ? `Downloads are saved straight into ComfyUI's own models folder (${comfy.root}), so nothing is stored twice. Files already in ComfyUI are never downloaded again.` : "ComfyUI's folder isn't set yet - open the Image or Video tab and use Set ComfyUI folder first.")
          : source === "hf"
          ? "Downloads go into your models folder (Settings → Storage) using LM Studio's publisher/repo layout, so LM Studio and this app both see them."
          : "Downloads are pulled by the Ollama app and stored in Ollama's own models folder. Ollama must be running."}
      </p>

      {source === "comfy" && (
        <div className="flex gap-2">
          {(["image", "video"] as const).map(k => (
            <button key={k} onClick={() => setKind(k)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${kind === k ? "bg-pink-600 text-white" : "bg-white/5 text-zinc-400 hover:bg-white/10"}`}>{k === "image" ? "Image models" : "Video models"}</button>
          ))}
        </div>
      )}

      {error && <div className="flex items-start gap-2 text-red-400 text-xs bg-red-500/10 rounded-xl px-4 py-3"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</div>}

      {visibleJobs.length > 0 && (
        <div className="space-y-2">
          {visibleJobs.map(j => (
            <div key={j.id} className="glass rounded-2xl border-white/5 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-bold text-zinc-200 truncate">{j.label}</span>
                <span className="flex items-center gap-2 shrink-0 text-zinc-400">
                  {j.status === "running" && <>{formatBytes(j.received)}{j.total ? ` / ${formatBytes(j.total)}` : ""} · {j.progress}%
                    <button onClick={() => cancel(j.id)} title="Cancel" className="text-zinc-500 hover:text-red-400"><X size={14} /></button></>}
                  {j.status === "done" && <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 size={14} /> {j.message}</span>}
                  {j.status === "error" && <span className="text-red-400">{j.error}</span>}
                  {j.status === "cancelled" && <span>Cancelled</span>}
                </span>
              </div>
              {j.status === "running" && <Progress value={j.progress} className="h-1 bg-white/5" />}
              {j.status === "running" && <p className="text-[10px] text-zinc-600 uppercase tracking-widest">{j.message}</p>}
            </div>
          ))}
        </div>
      )}

      {!loading && !error && shown.length === 0 && <p className="text-zinc-600 text-sm text-center py-10">No models found.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {shown.map(m => (
          <div key={`${m.source}:${m.id}`} className={`flex flex-col gap-3 p-4 rounded-2xl border bg-gradient-to-br ${source === "comfy" ? "from-pink-600/20 to-violet-600/10 border-pink-500/25" : source === "hf" ? "from-sky-600/20 to-violet-600/10 border-sky-500/25" : "from-orange-600/20 to-rose-600/10 border-orange-500/25"}`}>
            <div className="min-w-0">
              <p className="text-[10px] text-zinc-500 font-mono truncate">{m.publisher}</p>
              <h3 className="text-base font-bold text-white leading-tight truncate" title={m.id}>{m.name}</h3>
              <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2 leading-snug">{m.description}</p>
            </div>
            {m.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{m.tags.map(t => <FlagChip key={t} flag={t} />)}</div>}

            {m.source === "hf" || m.source === "comfy" ? (
              <Button className="mt-auto h-9 rounded-xl gap-2 text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white" onClick={() => openFiles(m)}>
                <Package size={14} /> Choose file & download
              </Button>
            ) : (
              <div className="mt-auto space-y-1.5">
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Download size <span className="normal-case tracking-normal text-zinc-600">(green fits your RAM, red is too big)</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {[...(m.sizes?.length ? m.sizes : ["latest"])].map(sz => (
                    <button
                      key={sz}
                      onClick={() => start({ source: "ollama", name: sz === "latest" ? m.name : `${m.name}:${sz}` })}
                      title={fitFor(paramsToBytes(sz), sys)?.detail ?? `ollama pull ${m.name}:${sz}`}
                      className={`px-2.5 py-1 rounded-lg hover:text-white text-[11px] font-bold flex items-center gap-1 transition-colors ${({ ok: "bg-emerald-500/20 hover:bg-emerald-500 text-emerald-200", tight: "bg-amber-500/20 hover:bg-amber-500 text-amber-200", no: "bg-red-500/15 hover:bg-red-500 text-red-300 opacity-70" } as const)[fitFor(paramsToBytes(sz), sys)?.level ?? "ok"] ?? "bg-orange-500/20 hover:bg-orange-500 text-orange-200"}`}
                    ><Download size={11} />{sz}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!picker} onOpenChange={(o) => !o && setPicker(null)}>
        <DialogContent className="bg-zinc-950 border-white/10 max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-white">{picker?.name}</DialogTitle>
            <DialogDescription>{source === "comfy" ? "Pick the file and the ComfyUI folder it belongs in (checkpoints for full models, loras, vae...)." : "Pick a quantization. Smaller files need less RAM but are less accurate; Q4_K_M is a good default."}</DialogDescription>
            {source === "comfy" && (
              <select value={folder} onChange={(e) => setFolder(e.target.value)} className="mt-2 h-9 rounded-lg bg-zinc-900 border border-white/10 text-zinc-100 text-xs px-2 font-mono">
                {(comfy.folders.length ? comfy.folders : ["checkpoints", "loras", "vae"]).map(f => <option key={f} value={f}>models/{f}</option>)}
              </select>
            )}
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
            {!files && !filesError && <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-zinc-500" /></div>}
            {filesError && <p className="text-red-400 text-xs">{filesError}</p>}
            {files?.length === 0 && <p className="text-zinc-500 text-sm py-4 text-center">No .gguf files in this repository.</p>}
            {files?.map(f => {
              const fit = fitFor(f.size, sys);
              const bestSize = Math.max(0, ...files.filter(x => !x.split && !x.vision && !/^(F16|BF16|F32)$/.test(x.quant) && fitFor(x.size, sys)?.level === "ok").map(x => x.size));
              const isBest = !!bestSize && f.size === bestSize;
              return (
              <div key={f.file} className="flex items-center justify-between gap-3 bg-white/5 rounded-xl px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-zinc-200 truncate" title={f.file}>{f.file}</p>
                  <p className="text-[10px] text-zinc-500 flex flex-wrap items-center gap-1.5">{[f.quant, formatBytes(f.size), f.kind && `${f.kind} part`, f.vision && "vision projector", f.split && "split file (not supported)"].filter(Boolean).join(" · ")}<FitBadge fit={f.vision || source === "comfy" ? null : fit} />{isBest && <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/25 text-sky-200">Best fit</span>}</p>
                </div>
                <Button
                  size="sm" disabled={f.split}
                  className="h-8 rounded-lg text-xs bg-sky-600 hover:bg-sky-500 text-white gap-1.5 shrink-0"
                  onClick={() => { start(source === "comfy" ? { source: "comfy", repo: picker!.id, file: f.file, folder, size: f.size } : { source: "hf", repo: picker!.id, file: f.file, size: f.size }); setPicker(null); }}
                ><Download size={13} /> Download</Button>
              </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
