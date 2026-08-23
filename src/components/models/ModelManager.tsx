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

interface ModelManagerProps {
  models: AIModel[];
  selectedModelId: string;
  onSelectModel: (id: string) => void;
  onDownloadModel: (id: string) => void;
  onDeleteModel: (id: string) => void;
}

export function ModelManager({ models, selectedModelId, onSelectModel, onDownloadModel, onDeleteModel }: ModelManagerProps) {
  const [search, setSearch] = useState("");

  const filteredModels = models.filter(m => 
    m.name.toLowerCase().includes(search.toLowerCase()) || 
    m.description.toLowerCase().includes(search.toLowerCase())
  );

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
          <div className="relative w-full md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
            <Input 
              placeholder="Search local directory..." 
              className="pl-12 h-12 bg-white/5 border-white/5 text-zinc-100 focus:border-white/10 rounded-2xl placeholder:text-zinc-700"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto pb-20 pr-2 scrollbar-hide">
          {filteredModels.map((model) => (
            <Card 
              key={model.id} 
              className={`glass flex flex-col h-[440px] transition-all hover:border-white/20 border-white/5 rounded-[2rem] overflow-hidden ${
                selectedModelId === model.id ? "ring-2 ring-violet-500/50 border-violet-500/30" : ""
              }`}
            >
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="model-tag">
                    {model.format} • {model.size}
                  </div>
                  {model.isDownloaded && (
                    <div className="vulkan-tag flex items-center gap-2">
                      <CheckCircle2 size={12} /> Local Cached
                    </div>
                  )}
                </div>
                <CardTitle className="text-2xl font-bold text-white tracking-tight leading-tight">{model.name}</CardTitle>
                <CardDescription className="text-zinc-500 text-xs font-medium leading-relaxed uppercase tracking-widest mt-2">
                  {model.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 space-y-6">
                <div className="grid grid-cols-2 gap-3">
                  <div className="glass p-3 rounded-2xl border-white/5">
                    <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                      <Cpu size={10} /> Architecture
                    </p>
                    <p className="text-zinc-300 font-mono text-xs">Llama 3 Core</p>
                  </div>
                  <div className="glass p-3 rounded-2xl border-white/5">
                    <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                      <Gauge size={10} /> Magnitude
                    </p>
                    <p className="text-zinc-300 font-mono text-xs">{model.parameters}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex justify-between text-[10px] text-zinc-600 font-bold uppercase tracking-[0.2em]">
                    <span>Inference Capability</span>
                    <span className="text-violet-400">High Resolution</span>
                  </div>
                  <div className="stat-bar">
                    <div className="stat-progress bg-gradient-to-r from-violet-600 to-emerald-400" style={{ width: '85%' }}></div>
                  </div>
                </div>

                {model.downloadProgress !== undefined && model.downloadProgress < 100 && (
                   <div className="space-y-3 pt-2">
                      <div className="flex justify-between text-[10px] text-zinc-500 uppercase font-bold tracking-widest">
                        <span className="animate-pulse">Loading weights...</span>
                        <span>{model.downloadProgress}%</span>
                      </div>
                      <Progress value={model.downloadProgress} className="h-1 bg-white/5" />
                   </div>
                )}
              </CardContent>
              <CardFooter className="p-6 pt-0 flex gap-3">
                {!model.isDownloaded ? (
                  <Button 
                    className="flex-1 bg-violet-600 hover:bg-violet-500 text-white gap-3 font-bold h-12 rounded-[1.25rem] shadow-xl shadow-violet-900/40"
                    onClick={() => onDownloadModel(model.id)}
                  >
                    <Download size={18} />
                    Download Weights
                  </Button>
                ) : (
                  <>
                    <Button 
                      variant="ghost"
                      className={`flex-1 gap-3 font-bold h-12 rounded-[1.25rem] transition-all ${
                        selectedModelId === model.id 
                          ? "bg-violet-600 text-white shadow-lg shadow-violet-900/40" 
                          : "bg-white/5 text-zinc-300 hover:bg-white/10 border border-white/10"
                      }`}
                      onClick={() => onSelectModel(model.id)}
                    >
                      {selectedModelId === model.id ? "Active Engine" : "Switch Engine"}
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="w-12 h-12 rounded-[1.25rem] bg-white/5 border border-white/5 hover:bg-red-500/10 hover:text-red-400 text-zinc-600"
                      onClick={() => onDeleteModel(model.id)}
                    >
                      <Trash2 size={18} />
                    </Button>
                  </>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
