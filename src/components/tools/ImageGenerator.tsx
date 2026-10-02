import React from "react";
import { ImagePlus, Loader2, Download, AlertTriangle, Globe, HardDrive, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GeneratedImage } from "../../types";

type Source = "cloud" | "local";

const SIZE_PRESETS = [
  { label: "512×512", width: 512, height: 512 },
  { label: "768×768", width: 768, height: 768 },
  { label: "1024×1024", width: 1024, height: 1024 },
  { label: "1024×576 (wide)", width: 1024, height: 576 },
];

export function ImageGeneratorView() {
  const [source, setSource] = React.useState<Source>("cloud");
  const [prompt, setPrompt] = React.useState("");
  const [negativePrompt, setNegativePrompt] = React.useState("");
  const [images, setImages] = React.useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Local (ComfyUI) only
  const [checkpoints, setCheckpoints] = React.useState<string[]>([]);
  const [checkpoint, setCheckpoint] = React.useState("");
  const [checkpointsError, setCheckpointsError] = React.useState<string | null>(null);
  const [sizeIdx, setSizeIdx] = React.useState(2);
  const [referenceImage, setReferenceImage] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (source !== "local") return;
    setCheckpointsError(null);
    fetch("/api/comfyui/checkpoints?kind=image")
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setCheckpoints(data.checkpoints || []);
        if (data.checkpoints?.length && !checkpoint) setCheckpoint(data.checkpoints[0]);
      })
      .catch(e => setCheckpointsError(e.message));
  }, [source]);

  const onReferenceFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setReferenceImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  const generate = async () => {
    if (!prompt.trim() || isGenerating) return;
    if (source === "local" && !checkpoint) {
      setError("No checkpoint selected");
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const endpoint = source === "cloud" ? "/api/image/generate" : "/api/comfyui/image/generate";
      const body = source === "cloud"
        ? { prompt }
        : {
            prompt,
            negativePrompt,
            checkpoint,
            width: SIZE_PRESETS[sizeIdx].width,
            height: SIZE_PRESETS[sizeIdx].height,
            referenceImage,
          };
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Generation failed");
      setImages(prev => [{ id: Date.now().toString(), prompt, src: data.src, createdAt: Date.now() }, ...prev]);
      setPrompt("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex-1 bg-transparent p-6 h-full overflow-hidden">
      <div className="max-w-6xl mx-auto h-full flex flex-col">
        <header className="mb-8 mt-6 shrink-0">
          <h1 className="text-4xl font-black text-white mb-2 tracking-tighter flex items-center gap-4">
            <ImagePlus className="text-pink-500" size={32} />
            Image Studio
          </h1>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setSource("cloud")}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 ${source === "cloud" ? "bg-pink-600 text-white" : "bg-white/5 text-zinc-500 hover:bg-white/10"}`}
            >
              <Globe size={12} /> Cloud (Gemini)
            </button>
            <button
              onClick={() => setSource("local")}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 ${source === "local" ? "bg-pink-600 text-white" : "bg-white/5 text-zinc-500 hover:bg-white/10"}`}
            >
              <HardDrive size={12} /> Local (ComfyUI)
            </button>
          </div>
          <p className="text-zinc-500 text-xs font-medium uppercase tracking-widest mt-3">
            {source === "cloud"
              ? "Needs internet + GEMINI_API_KEY"
              : "Needs ComfyUI running at http://127.0.0.1:8188 — fully offline"}
          </p>
        </header>

        <div className="glass p-6 rounded-[2rem] border-white/5 mb-8 shrink-0 space-y-4">
          {source === "local" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-2 block">Checkpoint</label>
                {checkpointsError ? (
                  <p className="text-xs text-red-400 flex items-center gap-2"><AlertTriangle size={12} /> {checkpointsError}</p>
                ) : (
                  <select
                    value={checkpoint}
                    onChange={(e) => setCheckpoint(e.target.value)}
                    className="w-full bg-white/5 border-none rounded-2xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-1 focus:ring-pink-500"
                  >
                    {checkpoints.length === 0 && <option value="">No checkpoints found</option>}
                    {checkpoints.map(c => <option key={c} value={c} className="bg-zinc-900">{c}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-2 block">Image Size</label>
                <select
                  value={sizeIdx}
                  onChange={(e) => setSizeIdx(Number(e.target.value))}
                  className="w-full bg-white/5 border-none rounded-2xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-1 focus:ring-pink-500"
                >
                  {SIZE_PRESETS.map((s, i) => <option key={s.label} value={i} className="bg-zinc-900">{s.label}</option>)}
                </select>
              </div>
            </div>
          )}

          {source === "local" && (
            <div>
              <label className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-2 block">
                Reference Image (optional — switches to the img2img workflow)
              </label>
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(e) => onReferenceFile(e.target.files?.[0])} />
              {referenceImage ? (
                <div className="relative inline-block">
                  <img src={referenceImage} alt="reference" className="h-20 w-20 object-cover rounded-xl border border-white/10" />
                  <button
                    onClick={() => setReferenceImage(null)}
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
                  <Upload size={14} /> Upload reference
                </button>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && generate()}
              placeholder="A robot holding a red skateboard, studio lighting..."
              className="flex-1 bg-white/5 border-none rounded-2xl px-6 py-3 text-white focus:outline-none focus:ring-1 focus:ring-pink-500 transition-all font-medium placeholder:text-zinc-700"
            />
            <Button
              onClick={generate}
              disabled={isGenerating || !prompt.trim()}
              className="bg-pink-600 hover:bg-pink-500 text-white rounded-2xl px-8 font-black uppercase text-[10px] tracking-widest h-auto"
            >
              {isGenerating ? <Loader2 className="animate-spin" size={16} /> : "Generate"}
            </Button>
          </div>
          {source === "local" && (
            <input
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="Negative prompt (optional) — things to avoid..."
              className="w-full bg-white/5 border-none rounded-2xl px-6 py-2.5 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-pink-500 placeholder:text-zinc-700"
            />
          )}
          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs font-medium">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto pb-10">
          {images.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-4 opacity-60">
              <ImagePlus size={48} className="text-zinc-800" />
              <p className="text-zinc-600 text-xs font-bold uppercase tracking-widest">No images generated yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              {images.map((img) => (
                <div key={img.id} className="glass rounded-[2rem] border-white/5 overflow-hidden group relative">
                  <img src={img.src} alt={img.prompt} className="w-full aspect-square object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/0 to-black/0 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                    <p className="text-xs text-zinc-200 line-clamp-2 mb-3">{img.prompt}</p>
                    <a
                      href={img.src}
                      download={`sunayna-image-${img.id}.png`}
                      className="self-start bg-white/10 hover:bg-white/20 backdrop-blur-md text-white text-[10px] font-bold uppercase tracking-widest px-3 py-2 rounded-xl flex items-center gap-2"
                    >
                      <Download size={12} /> Save
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
