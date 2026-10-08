import React from "react";
import { Clapperboard, Loader2, AlertTriangle, Globe, Clock, HardDrive, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ComfyStatus } from "./ComfyStatus";
import { VideoJob } from "../../types";
import { GalleryHistory } from "./GalleryHistory";
import { notify, notifyError } from "../../lib/notify";
import { ProgressBar } from "../layout/ProgressBar";
import { friendlyError } from "../../services/errors";

type Source = "cloud" | "local";

const SIZE_PRESETS = [
  { label: "768×512 (wide)", width: 768, height: 512 },
  { label: "512×768 (tall)", width: 512, height: 768 },
  { label: "640×640 (square)", width: 640, height: 640 },
];

export function VideoGeneratorView() {
  const [source, setSource] = React.useState<Source>("cloud");
  const [prompt, setPrompt] = React.useState("");
  const [jobs, setJobs] = React.useState<VideoJob[]>([]);
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [progress, setProgress] = React.useState<Record<string, { percent: number | null; label: string }>>({});
  const setToast = (m: string | null) => { if (m) notify({ message: m, tab: "video" }); };
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Local (ComfyUI/LTX-Video) only
  const [checkpoints, setCheckpoints] = React.useState<string[]>([]);
  const [checkpoint, setCheckpoint] = React.useState("");
  const [checkpointsError, setCheckpointsError] = React.useState<string | null>(null);
  const [sizeIdx, setSizeIdx] = React.useState(0);
  const [sourceImage, setSourceImage] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const loadCheckpoints = React.useCallback(() => {
    setCheckpointsError(null);
    fetch("/api/comfyui/checkpoints?kind=video")
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setCheckpoints(data.checkpoints || []);
        if (data.checkpoints?.length && !checkpoint) setCheckpoint(data.checkpoints[0]);
      })
      .catch(e => setCheckpointsError(e.message));
  }, []);

  React.useEffect(() => {
    if (source === "local") loadCheckpoints();
  }, [source]);

  const onSourceFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setSourceImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  // Poll any pending jobs every 8s (both Veo and SVD can take minutes).
  React.useEffect(() => {
    const pending = jobs.filter(j => j.status === "pending");
    if (pending.length === 0) return;
    const timer = setInterval(async () => {
      for (const job of pending) {
        try {
          const resp = await fetch(`/api/video/status/${job.id}`);
          const data = await resp.json();
          if (data.status === "error" && data.error) notifyError(`Video failed: ${data.error}`, "video");
          if (data.status === "done") { setRefreshKey(k => k + 1); setToast("Video generated and saved to history"); }
          setJobs(prev => prev.map(j => j.id === job.id
            ? { ...j, status: data.status, resultUrl: data.resultUrl, error: data.error }
            : j
          ));
        } catch (e) {
          console.error("Failed to poll video job", e);
        }
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [jobs]);

  React.useEffect(() => {
    const running = jobs.filter(j => j.status === "pending");
    if (running.length === 0) return;
    const t = setInterval(async () => {
      for (const j of running) {
        try { const p = await (await fetch(`/api/progress/${j.id}`)).json(); setProgress(prev => ({ ...prev, [j.id]: p })); } catch { /* ignore */ }
      }
    }, 1000);
    return () => clearInterval(t);
  }, [jobs]);

  const cancelJob = async (id: string) => {
    setJobs(prev => prev.map(j => j.id === id ? { ...j, status: "cancelled" } : j)); // instant feedback
    try { await fetch(`/api/video/cancel/${id}`, { method: "POST" }); } catch { /* server gone; nothing to stop */ }
    setToast("Video generation stopped");
  };

  const generate = async () => {
    if (isSubmitting) return;
    if (!prompt.trim()) return;
    if (source === "local" && !checkpoint) {
      setError("No checkpoint selected");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const endpoint = source === "cloud" ? "/api/video/generate" : "/api/comfyui/video/generate";
      const body = source === "cloud"
        ? { prompt }
        : { prompt, image: sourceImage, checkpoint, width: SIZE_PRESETS[sizeIdx].width, height: SIZE_PRESETS[sizeIdx].height };
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to start generation");
      const label = prompt;
      setJobs(prev => [{ id: data.id, prompt: label, status: "pending", createdAt: Date.now() }, ...prev]);
      setPrompt("");
    } catch (e: any) {
      const m = friendlyError(e);
      setError(m);
      notifyError(m, "video");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 bg-transparent p-6 h-full overflow-hidden">
      <div className="max-w-5xl mx-auto h-full flex flex-col">
        <header className="mb-8 mt-6 shrink-0">
          <h1 className="text-2xl font-black text-white mb-2 tracking-tighter flex items-center gap-4">
            <Clapperboard className="text-orange-500" size={32} />
            Video Studio
          </h1>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setSource("cloud")}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 ${source === "cloud" ? "bg-orange-600 text-white" : "bg-white/5 text-zinc-500 hover:bg-white/10"}`}
            >
              <Globe size={12} /> Cloud (Veo)
            </button>
            <button
              onClick={() => setSource("local")}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 ${source === "local" ? "bg-orange-600 text-white" : "bg-white/5 text-zinc-500 hover:bg-white/10"}`}
            >
              <HardDrive size={12} /> Local (ComfyUI/LTX-Video)
            </button>
          </div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mt-3">
            {source === "cloud"
              ? "Needs internet + GEMINI_API_KEY. Generation takes several minutes."
              : "Needs ComfyUI (with an LTX-Video checkpoint) at http://127.0.0.1:8188 — fully offline. Text-to-video, optionally starting from an image."}
          </p>
        </header>

        <div className="glass p-6 rounded-[2rem] border-white/5 mb-8 shrink-0 space-y-4">
          {source === "local" && <ComfyStatus onReady={loadCheckpoints} />}
          {source === "local" && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-2 block">LTX-Video Checkpoint</label>
                  {checkpointsError ? (
                    <p className="text-xs text-red-400 flex items-center gap-2"><AlertTriangle size={12} /> {checkpointsError}</p>
                  ) : (
                    <select
                      value={checkpoint}
                      onChange={(e) => setCheckpoint(e.target.value)}
                      className="w-full bg-white/5 border-none rounded-2xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                    >
                      {checkpoints.length === 0 && <option value="">No checkpoints found</option>}
                      {checkpoints.map(c => <option key={c} value={c} className="bg-zinc-900">{c}</option>)}
                    </select>
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-2 block">Size</label>
                  <select
                    value={sizeIdx}
                    onChange={(e) => setSizeIdx(Number(e.target.value))}
                    className="w-full bg-white/5 border-none rounded-2xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-1 focus:ring-orange-500"
                  >
                    {SIZE_PRESETS.map((s, i) => <option key={s.label} value={i} className="bg-zinc-900">{s.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-2 block">Starting Image (optional)</label>
                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(e) => onSourceFile(e.target.files?.[0])} />
                {sourceImage ? (
                  <div className="relative inline-block">
                    <img src={sourceImage} alt="source" className="h-24 w-24 object-cover rounded-xl border border-white/10" />
                    <button
                      onClick={() => setSourceImage(null)}
                      className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-zinc-400 text-xs font-bold uppercase tracking-widest px-4 py-3 rounded-2xl"
                  >
                    <Upload size={14} /> Upload starting image
                  </button>
                )}
              </div>
            </>
          )}

          {(
            <div className="flex gap-3">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && generate()}
                placeholder="A neon hologram of a cat driving at top speed..."
                className="flex-1 bg-white/5 border-none rounded-2xl px-6 py-3 text-white focus:outline-none focus:ring-1 focus:ring-orange-500 transition-all font-medium placeholder:text-zinc-700"
              />
            </div>
          )}

          <Button
            onClick={generate}
            disabled={isSubmitting || !prompt.trim()}
            className="bg-orange-600 hover:bg-orange-500 text-white rounded-2xl px-8 font-black uppercase text-[10px] tracking-widest h-auto w-full md:w-auto"
          >
            {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : "Generate"}
          </Button>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs font-medium">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto pb-10 space-y-6">
          {jobs.filter(j => j.status !== "done").map((job) => (
            <div key={job.id} className="glass rounded-[2rem] border-white/5 p-5 space-y-2">
              <div className="flex items-start justify-between gap-4">
                <p className="text-sm text-zinc-300 flex-1">{job.prompt}</p>
                <span className={`shrink-0 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full flex items-center gap-1.5 ${job.status === "error" ? "bg-red-500/10 text-red-400" : job.status === "cancelled" ? "bg-zinc-500/10 text-zinc-400" : "bg-yellow-500/10 text-yellow-400"}`}>
                  {job.status === "pending" && <Loader2 size={10} className="animate-spin" />}
                  {job.status === "pending" ? "Generating" : job.status === "cancelled" ? "Stopped" : "Failed"}
                </span>
                {job.status === "pending" && (
                  <button onClick={() => cancelJob(job.id)} className="shrink-0 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-colors">Stop</button>
                )}
              </div>
              {job.status === "error" && <p className="text-xs text-red-400 flex items-center gap-2"><AlertTriangle size={12} /> {job.error}</p>}
              {job.status === "pending" && <ProgressBar value={source === "local" ? (progress[job.id]?.percent ?? null) : null} label={source === "local" ? (progress[job.id]?.label || "Starting...") : "Generating with Veo - this can take a few minutes"} color="bg-orange-500" />}
            </div>
          ))}
          <GalleryHistory kind="video" refreshKey={refreshKey} />
        </div>
      </div>
    </div>
  );
}
