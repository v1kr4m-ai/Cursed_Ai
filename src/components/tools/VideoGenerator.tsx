import React from "react";
import { Clapperboard, Loader2, AlertTriangle, Globe, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoJob } from "../../types";

export function VideoGeneratorView() {
  const [prompt, setPrompt] = React.useState("");
  const [jobs, setJobs] = React.useState<VideoJob[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Poll any pending jobs every 8s (Veo generation typically takes 1-6 minutes).
  React.useEffect(() => {
    const pending = jobs.filter(j => j.status === "pending");
    if (pending.length === 0) return;
    const timer = setInterval(async () => {
      for (const job of pending) {
        try {
          const resp = await fetch(`/api/video/status/${job.id}`);
          const data = await resp.json();
          setJobs(prev => prev.map(j => j.id === job.id
            ? { ...j, status: data.status, resultUrl: data.resultUrl, error: data.error }
            : j
          ));
        } catch (e) {
          console.error("Failed to poll video job", e);
        }
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [jobs]);

  const generate = async () => {
    if (!prompt.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const resp = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to start generation");
      setJobs(prev => [{ id: data.id, prompt, status: "pending", createdAt: Date.now() }, ...prev]);
      setPrompt("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 bg-transparent p-6 h-full overflow-hidden">
      <div className="max-w-5xl mx-auto h-full flex flex-col">
        <header className="mb-8 mt-6 shrink-0">
          <h1 className="text-4xl font-black text-white mb-2 tracking-tighter flex items-center gap-4">
            <Clapperboard className="text-orange-500" size={32} />
            Video Studio
          </h1>
          <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em] flex items-center gap-2">
            <Globe size={12} className="text-yellow-500" /> Cloud (Gemini/Veo) — needs internet + GEMINI_API_KEY. Generation takes several minutes.
          </p>
        </header>

        <div className="glass p-6 rounded-[2rem] border-white/5 mb-8 shrink-0 space-y-4">
          <div className="flex gap-3">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && generate()}
              placeholder="A neon hologram of a cat driving at top speed..."
              className="flex-1 bg-white/5 border-none rounded-2xl px-6 py-3 text-white focus:outline-none focus:ring-1 focus:ring-orange-500 transition-all font-medium placeholder:text-zinc-700"
            />
            <Button
              onClick={generate}
              disabled={isSubmitting || !prompt.trim()}
              className="bg-orange-600 hover:bg-orange-500 text-white rounded-2xl px-8 font-black uppercase text-[10px] tracking-widest h-auto"
            >
              {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : "Generate"}
            </Button>
          </div>
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs font-medium">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto pb-10 space-y-4">
          {jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4 opacity-60">
              <Clapperboard size={48} className="text-zinc-800" />
              <p className="text-zinc-600 text-xs font-bold uppercase tracking-widest">No videos generated yet</p>
            </div>
          ) : (
            jobs.map((job) => (
              <div key={job.id} className="glass rounded-[2rem] border-white/5 p-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-sm text-zinc-300 flex-1">{job.prompt}</p>
                  <span className={`shrink-0 text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-full flex items-center gap-1.5 ${
                    job.status === "done" ? "bg-emerald-500/10 text-emerald-400" :
                    job.status === "error" ? "bg-red-500/10 text-red-400" :
                    "bg-yellow-500/10 text-yellow-400"
                  }`}>
                    {job.status === "pending" && <Loader2 size={10} className="animate-spin" />}
                    {job.status === "pending" && "Generating"}
                    {job.status === "done" && "Ready"}
                    {job.status === "error" && "Failed"}
                  </span>
                </div>
                {job.status === "done" && job.resultUrl && (
                  <video src={job.resultUrl} controls className="w-full rounded-2xl max-h-[400px]" />
                )}
                {job.status === "error" && (
                  <p className="text-xs text-red-400 flex items-center gap-2"><AlertTriangle size={12} /> {job.error}</p>
                )}
                {job.status === "pending" && (
                  <p className="text-[10px] text-zinc-600 flex items-center gap-2 uppercase tracking-widest font-bold">
                    <Clock size={12} /> Polling every 8s — this can take a few minutes
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
