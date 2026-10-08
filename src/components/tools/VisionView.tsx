import React from "react";
import { Eye, ImagePlus, Loader2, Square, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AIModel, MessageRole } from "../../types";
import { AIService } from "../../services/aiService";
import { pickFile } from "../../services/attachments";
import { notifyError } from "../../lib/notify";
import { ProgressBar } from "../layout/ProgressBar";

/**
 * Ask a question about an image. Works with any installed model that has the
 * Vision flag (Ollama / LM Studio report this themselves) - not one fixed model.
 */
export function VisionView({ models, selectedModelId, onOpenModels }: { models: AIModel[]; selectedModelId: string; onOpenModels: () => void }) {
  const visionModels = models.filter(m => m.isDownloaded && m.tags?.includes("Vision") && (m.source === "ollama" || m.source === "lmstudio"));
  const [modelId, setModelId] = React.useState("");
  const [image, setImage] = React.useState<string | null>(null);
  const [prompt, setPrompt] = React.useState("Describe this image in detail.");
  const [answer, setAnswer] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Default to the chat model if it can see, otherwise the first model that can.
  React.useEffect(() => {
    if (visionModels.some(m => m.id === modelId)) return;
    setModelId((visionModels.find(m => m.id === selectedModelId) || visionModels[0])?.id || "");
  }, [visionModels.map(m => m.id).join("|"), selectedModelId]);

  const choose = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    try {
      const p = await pickFile(file);
      if (!p.image) throw new Error("That isn't an image file.");
      setImage(p.image);
      setAnswer("");
    } catch (e: any) { setError(e.message); }
    if (fileRef.current) fileRef.current.value = "";
  };

  const analyze = async () => {
    if (!image || !modelId || busy) return;
    setBusy(true); setError(null); setAnswer("");
    const controller = new AbortController();
    abortRef.current = controller;
    let text = "";
    try {
      await AIService.generate(
        [{ id: "v", role: MessageRole.USER, content: prompt || "Describe this image.", images: [image], timestamp: Date.now() }],
        modelId,
        {
          onToken: (t) => { text += t; setAnswer(text); },
          onError: (e) => { const m = e?.message || String(e); setError(m); notifyError(m, "vision"); },
          onComplete: () => {},
        },
        { signal: controller.signal, memoryEnabled: false, maxTokens: 1024 },
      );
      if (!text && !controller.signal.aborted) setError((prev) => prev || "The model returned no text. Try another vision model.");
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message || String(e));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col glass rounded-3xl h-full p-6 overflow-y-auto">
      <h1 className="text-2xl font-black text-white tracking-tighter flex items-center gap-3 mb-1"><Eye className="text-violet-400" /> Vision</h1>
      <p className="text-zinc-500 text-xs uppercase tracking-[0.2em] mb-6">Ask questions about an image</p>

      {visionModels.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
          <p className="text-zinc-300 font-bold">No vision-capable model found</p>
          <p className="text-zinc-500 text-sm max-w-md">
            Vision works with any Ollama or LM Studio model flagged <b>Vision</b> (for example <span className="font-mono">llava</span>, <span className="font-mono">llama3.2-vision</span>, <span className="font-mono">qwen2.5vl</span>).
            Install one from the Models tab - or start Ollama / LM Studio if it isn't running.
          </p>
          <Button className="mt-2 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-xl" onClick={onOpenModels}>Browse models</Button>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => choose(e.target.files)} />
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full aspect-video rounded-2xl border-2 border-dashed border-white/15 hover:border-violet-500/50 bg-white/5 flex items-center justify-center overflow-hidden transition-colors"
            >
              {image
                ? <img src={image} className="w-full h-full object-contain" />
                : <span className="flex flex-col items-center gap-2 text-zinc-500 text-sm"><ImagePlus size={28} /> Click to choose an image</span>}
            </button>
            <label className="block text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Model</label>
            <select value={modelId} onChange={(e) => setModelId(e.target.value)} className="w-full h-11 rounded-xl bg-zinc-900 border border-white/10 text-zinc-100 text-sm px-3">
              {visionModels.map(m => <option key={m.id} value={m.id}>{m.name} ({m.source})</option>)}
            </select>
            <label className="block text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Question</label>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2}
              className="w-full rounded-xl bg-zinc-900 border border-white/10 text-zinc-100 text-sm p-3 resize-none" />
            <div className="flex gap-2">
              <Button disabled={!image || busy} onClick={analyze} className="flex-1 h-11 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold gap-2">
                {busy ? <><Loader2 className="animate-spin" size={16} /> Looking...</> : "Analyze image"}
              </Button>
              {busy && <Button variant="ghost" onClick={() => abortRef.current?.abort()} className="h-11 rounded-xl bg-red-500/10 text-red-400"><Square size={14} className="fill-current" /></Button>}
            </div>
          </div>

          <div className="rounded-2xl bg-black/20 border border-white/5 p-5 min-h-[200px]">
            {busy && <div className="mb-3"><ProgressBar value={null} label="The model is looking at the image..." color="bg-violet-500" /></div>}
            {error && <div className="flex items-start gap-2 text-red-400 text-xs bg-red-500/10 rounded-xl px-4 py-3 mb-3"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</div>}
            {answer
              ? <p className="text-zinc-200 text-sm leading-relaxed whitespace-pre-wrap">{answer}</p>
              : !error && <p className="text-zinc-600 text-sm">The model's answer will appear here.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
