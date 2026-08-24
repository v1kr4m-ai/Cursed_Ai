import React from "react";
import { ImagePlus, Loader2, Download, AlertTriangle, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GeneratedImage } from "../../types";

export function ImageGeneratorView() {
  const [prompt, setPrompt] = React.useState("");
  const [images, setImages] = React.useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const generate = async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setError(null);
    try {
      const resp = await fetch("/api/image/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
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
          <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em] flex items-center gap-2">
            <Globe size={12} className="text-yellow-500" /> Cloud (Gemini/Imagen) — needs internet + GEMINI_API_KEY
          </p>
        </header>

        <div className="glass p-6 rounded-[2rem] border-white/5 mb-8 shrink-0 space-y-4">
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
