import React, { useState } from "react";
import { 
  Download, 
  Trash2, 
  Search, 
  Database, 
  Cpu, 
  CheckCircle2, 
  Info,
  ExternalLink,
  ShieldCheck,
  Zap,
  Gauge
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AIModel } from "../../types";
import { MODEL_FLAGS } from "../../lib/modelTags";
import { FlagChip, FitBadge } from "./flags";
import { fitFor, useSystemInfo } from "../../lib/ramFit";
import { ModelHub } from "./ModelHub";

interface ModelManagerProps {
  models: AIModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onDownloadModel: (id: string) => void;
  onDeleteModel: (id: string) => void;
  onRefresh: () => void;
  onCancelDownload: (id: string) => void;
}

// Each model gets a colour: by where it runs (Ollama / LM Studio), otherwise from a palette by name.
const PALETTE = [
  { card: "from-violet-600/25 to-fuchsia-600/10", border: "border-violet-500/30", ring: "ring-violet-400/70", chip: "bg-violet-500/25 text-violet-200", icon: "text-violet-300", btn: "bg-violet-600 hover:bg-violet-500" },
  { card: "from-emerald-600/25 to-teal-600/10", border: "border-emerald-500/30", ring: "ring-emerald-400/70", chip: "bg-emerald-500/25 text-emerald-200", icon: "text-emerald-300", btn: "bg-emerald-600 hover:bg-emerald-500" },
  { card: "from-sky-600/25 to-indigo-600/10", border: "border-sky-500/30", ring: "ring-sky-400/70", chip: "bg-sky-500/25 text-sky-200", icon: "text-sky-300", btn: "bg-sky-600 hover:bg-sky-500" },
  { card: "from-amber-600/25 to-orange-600/10", border: "border-amber-500/30", ring: "ring-amber-400/70", chip: "bg-amber-500/25 text-amber-200", icon: "text-amber-300", btn: "bg-amber-600 hover:bg-amber-500" },
  { card: "from-rose-600/25 to-pink-600/10", border: "border-rose-500/30", ring: "ring-rose-400/70", chip: "bg-rose-500/25 text-rose-200", icon: "text-rose-300", btn: "bg-rose-600 hover:bg-rose-500" },
  { card: "from-cyan-600/25 to-blue-600/10", border: "border-cyan-500/30", ring: "ring-cyan-400/70", chip: "bg-cyan-500/25 text-cyan-200", icon: "text-cyan-300", btn: "bg-cyan-600 hover:bg-cyan-500" },
];
function accentFor(m: AIModel) {
  if (m.source === "ollama") return PALETTE[3];
  if (m.source === "lmstudio") return PALETTE[5];
  let h = 0;
  for (const ch of m.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % 3 === 0 ? 0 : h % 3 === 1 ? 1 : 2];
}
function sourceLabel(m: AIModel) {
  if (m.source === "ollama") return "Ollama";
  if (m.source === "lmstudio") return "LM Studio";
  return m.format || "GGUF";
}

export function ModelManager({ models, selectedModelId, onSelectModel, onDownloadModel, onDeleteModel, onRefresh, onCancelDownload }: ModelManagerProps) {
  // Tell the user when Ollama / LM Studio are off, instead of silently showing no models from them.
  const [hosts, setHosts] = useState<{ ollama: boolean; lmstudio: boolean } | null>(null);
  React.useEffect(() => {
    fetch("/api/external-models").then(r => r.json()).then(d => setHosts({ ollama: !!d.ollama?.running, lmstudio: !!d.lmstudio?.running })).catch(() => setHosts(null));
  }, [models.length]);
  const [search, setSearch] = useState("");
  const sys = useSystemInfo();
  const [view, setView] = useState<"installed" | "hf" | "ollama">("installed");
  const [flag, setFlag] = useState<string | null>(null);

  const filteredModels = models.filter(m => 
    m.name.toLowerCase().includes(search.toLowerCase()) || 
    m.description.toLowerCase().includes(search.toLowerCase())
  ).filter(m => !flag || m.tags?.includes(flag));

  return (
    <div className="flex-1 flex flex-col bg-transparent overflow-hidden h-full">
      <div className="max-w-6xl mx-auto w-full flex flex-col h-full bg-transparent">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10 mt-6">
          <div>
            <h1 className="text-4xl font-black text-white mb-2 tracking-tighter flex items-center gap-4">
              <Database className="text-violet-500" size={32} />
              Model Library
            </h1>
            <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em]">Local GGUF Vault • Adreno Optimized</p>
          </div>
          {view === "installed" && <div className="relative w-full md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
            <Input 
              placeholder="Search local directory..." 
              className="pl-12 h-12 bg-white/5 border-white/5 text-zinc-100 focus:border-white/10 rounded-2xl placeholder:text-zinc-700"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-5">
          {([["installed", "Installed"], ["hf", "Hugging Face"], ["ollama", "Ollama Library"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setView(id)}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors ${view === id ? "bg-violet-600 text-white" : "bg-white/5 text-zinc-400 hover:bg-white/10"}`}>{label}</button>
          ))}
          <span className="w-px h-6 bg-white/10 mx-2" />
          <button onClick={() => setFlag(null)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold ${flag === null ? "bg-white text-black" : "bg-white/5 text-zinc-400 hover:bg-white/10"}`}>All</button>
          {MODEL_FLAGS.map(fl => (
            <button key={fl} onClick={() => setFlag(flag === fl ? null : fl)} className={`rounded-lg transition-all ${flag === fl ? "ring-2 ring-white/60" : "opacity-80 hover:opacity-100"}`}><FlagChip flag={fl} /></button>
          ))}
        </div>

        {view === "installed" && hosts && (!hosts.ollama || !hosts.lmstudio) && (
          <div className="mb-4 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2.5">
            {!hosts.ollama && <>Ollama isn't running, so its models aren't listed - start the Ollama app. </>}
            {!hosts.lmstudio && <>LM Studio's local server isn't running (optional) - start its server to list its models.</>}
          </div>
        )}

        {view !== "installed" && (
          <div className="overflow-y-auto pb-20 pr-2">
            <ModelHub key={view} source={view} flag={flag} onInstalled={onRefresh} />
          </div>
        )}

        {view === "installed" && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 overflow-y-auto pb-20 pr-2 content-start">
          {filteredModels.map((model) => {
            const c = accentFor(model);
            const active = selectedModelId === model.id;
            const downloading = model.downloadProgress !== undefined && model.downloadProgress < 100;
            return (
              <div
                key={model.id}
                className={`relative flex flex-col gap-3 p-4 rounded-2xl border bg-gradient-to-br ${c.card} ${c.border} transition-all hover:-translate-y-0.5 hover:shadow-xl ${active ? "ring-2 " + c.ring : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg ${c.chip}`}>
                    {sourceLabel(model)}
                  </span>
                  {model.isDownloaded && <CheckCircle2 size={16} className={c.icon} />}
                </div>

                <div className="min-w-0">
                  <h3 className="text-base font-bold text-white leading-tight truncate" title={model.name}>{model.name}</h3>
                  <p className="text-[11px] text-zinc-400 mt-1 line-clamp-2 leading-snug">{model.description}</p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <FitBadge fit={fitFor(model.sizeBytes, sys)} />
                  {(model.tags || []).map(t => <FlagChip key={t} flag={t} />)}
                  {[model.parameters, model.size].filter(Boolean).map((t, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-md bg-black/25 text-zinc-300 text-[10px] font-mono">{t}</span>
                  ))}
                </div>

                {downloading && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[10px] text-zinc-400 uppercase font-bold tracking-widest">
                      <span className="animate-pulse">Downloading...</span>
                      <span className="flex items-center gap-2">{model.downloadProgress}%
                        <button onClick={() => onCancelDownload(model.id)} title="Cancel download" className="text-zinc-400 hover:text-red-400">✕</button>
                      </span>
                    </div>
                    <Progress value={model.downloadProgress} className="h-1 bg-black/30" />
                  </div>
                )}

                <div className="flex gap-2 mt-auto">
                  {!model.isDownloaded ? (
                    <Button
                      className={`flex-1 h-9 rounded-xl gap-2 text-xs font-bold text-white ${c.btn} disabled:opacity-40 disabled:bg-white/5 disabled:text-zinc-500`}
                      disabled={!model.downloadUrl}
                      title={!model.downloadUrl ? "Not wired up in this build yet" : undefined}
                      onClick={() => onDownloadModel(model.id)}
                    >
                      <Download size={14} />
                      {model.downloadUrl ? "Download" : "Not supported yet"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        className={`flex-1 h-9 rounded-xl text-xs font-bold ${active ? "text-white " + c.btn : "bg-black/25 text-zinc-200 hover:bg-black/40"}`}
                        onClick={() => onSelectModel(model.id)}
                      >
                        {active ? "Active" : "Use this model"}
                      </Button>
                      {model.source !== "ollama" && model.source !== "lmstudio" && (
                        <Button
                          variant="ghost" size="icon"
                          className="w-9 h-9 rounded-xl bg-black/25 hover:bg-red-500/20 hover:text-red-400 text-zinc-400"
                          title="Delete model file"
                          onClick={() => onDeleteModel(model.id)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>}
      </div>
    </div>
  );
}
