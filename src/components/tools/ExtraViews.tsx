import React from "react";
import { 
  BrainCircuit, 
  Search, 
  Clock, 
  Settings, 
  Shield, 
  Cpu, 
  Network, 
  Volume2, 
  Lock,
  Globe,
  Database,
  History,
  Zap,
  Activity,
  Thermometer,
  Monitor,
  RotateCcw,
  BatteryLow,
  BatteryMedium,
  BatteryFull,
  Eye,
  Mic,
  MessageSquare,
  Image as ImageIcon
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { AppSettings } from "../../types";

import { AIService } from "../../services/aiService";

export function MemoryView() {
  const [memories, setMemories] = React.useState<{ text: string, timestamp: number }[]>([]);
  const [newMemory, setNewMemory] = React.useState("");
  const [isAdding, setIsAdding] = React.useState(false);

  const fetchMemories = async () => {
    const data = await AIService.getMemories();
    setMemories(data);
  };

  React.useEffect(() => {
    fetchMemories();
  }, []);

  const handleAddMemory = async () => {
    if (!newMemory.trim()) return;
    setIsAdding(true);
    await AIService.addMemory(newMemory);
    setNewMemory("");
    setIsAdding(false);
    fetchMemories();
  };

  return (
    <div className="flex-1 bg-transparent p-6 h-full overflow-hidden">
      <div className="max-w-4xl mx-auto h-full flex flex-col">
        <header className="mb-10 mt-6 shrink-0">
           <h1 className="text-4xl font-black text-white mb-2 tracking-tighter flex items-center gap-4">
              <BrainCircuit className="text-violet-500" size={32} />
              Vector Memory
            </h1>
            <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em]">Private Retrieval Pipeline • Local Store</p>
        </header>

        <div className="mb-8 shrink-0">
          <div className="glass p-6 rounded-[2rem] border-white/5 space-y-4 shadow-xl">
             <Label className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] ml-2">Add New Cognitive Entry</Label>
             <div className="flex gap-4">
               <input 
                 value={newMemory}
                 onChange={(e) => setNewMemory(e.target.value)}
                 placeholder="Context to anchor in semantic memory..."
                 className="flex-1 bg-white/5 border-none rounded-2xl px-6 py-3 text-white focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all font-medium placeholder:text-zinc-700"
                 onKeyDown={(e) => e.key === 'Enter' && handleAddMemory()}
               />
               <Button 
                 onClick={handleAddMemory} 
                 disabled={isAdding}
                 className="bg-violet-600 hover:bg-violet-500 text-white rounded-2xl px-8 font-black uppercase text-[10px] tracking-widest h-auto"
               >
                 {isAdding ? <Cpu className="animate-spin" size={14} /> : "Store"}
               </Button>
             </div>
          </div>
        </div>

        <div className="glass rounded-[2rem] overflow-hidden flex flex-col flex-1 shadow-2xl shadow-black/40 border-white/5">
           <div className="p-5 border-b border-white/5 flex items-center gap-4 bg-white/3">
             <Search size={18} className="text-zinc-500" />
             <input 
              placeholder="Search vector space..." 
              className="bg-transparent border-none focus:ring-0 text-sm text-zinc-100 w-full placeholder:text-zinc-700 font-medium"
             />
           </div>
           <ScrollArea className="flex-1">
             <div className="divide-y divide-white/5">
               {memories.length === 0 && (
                 <div className="p-20 text-center space-y-4">
                    <Database className="mx-auto text-zinc-800" size={48} />
                    <p className="text-zinc-600 text-xs font-bold uppercase tracking-widest">Semantic store is empty</p>
                 </div>
               )}
               {memories.map((m, i) => (
                 <div key={i} className="p-6 hover:bg-white/5 transition-colors group relative overflow-hidden">
                    <div className="flex justify-between items-start mb-3">
                      <div className="model-tag text-[9px]">Memory Chunk</div>
                      <span className="text-[10px] font-mono text-zinc-600 flex items-center gap-2 group-hover:text-zinc-400 transition-colors">
                        <Clock size={11} /> {new Date(m.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-[15px] text-zinc-300 mb-4 leading-relaxed font-medium">{m.text}</p>
                    <div className="flex items-center justify-between pt-2 border-t border-white/[0.03]">
                       <div className="flex gap-1.5 items-center">
                          <div className="stat-bar w-24">
                              <div className="stat-progress bg-violet-600" style={{ width: "100%" }}></div>
                          </div>
                          <span className="text-[10px] font-black text-violet-500 ml-2">Persistence: Permanent</span>
                       </div>
                    </div>
                 </div>
               ))}
             </div>
           </ScrollArea>
        </div>
      </div>
    </div>
  );
}

export function EngineView() {
  const [stats, setStats] = React.useState<any>(null);
  const [gpuLayers, setGpuLayers] = React.useState(32);
  const [isUpdatingMode, setIsUpdatingMode] = React.useState(false);

  const fetchStats = async () => {
    try {
      const resp = await fetch("/api/stats");
      const data = await resp.json();
      setStats(data);
    } catch (e) {
      console.error("Failed to fetch stats", e);
    }
  };

  const setMode = async (mode: string) => {
    setIsUpdatingMode(true);
    try {
      await fetch("/api/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode })
      });
      fetchStats();
    } finally {
      setIsUpdatingMode(false);
    }
  };

  React.useEffect(() => {
    fetchStats();
    const timer = setInterval(fetchStats, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex-1 bg-transparent p-6 h-full overflow-hidden">
      <div className="max-w-4xl mx-auto h-full flex flex-col">
        <header className="mb-10 mt-6 shrink-0">
            <h1 className="text-4xl font-black text-white mb-2 tracking-tighter flex items-center gap-4">
               <Cpu className="text-cyan-500" size={32} />
               Native Engine
            </h1>
            <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em]">Phase 9 — Mobile Optimization • Battery Aware</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8 shrink-0">
           <div className="glass p-6 rounded-[2rem] border-white/5 relative overflow-hidden">
                <div className="absolute top-4 right-4"><Activity className="text-cyan-500/50" size={16} /></div>
                <p className="text-zinc-600 text-[10px] uppercase tracking-widest font-bold mb-2">Engine State</p>
                <h4 className="text-2xl font-black text-white italic tracking-tighter uppercase">{stats?.native?.state || stats?.engine_state || stats?.model?.status || "READY"}</h4>
           </div>
           <div className="glass p-6 rounded-[2rem] border-white/5 relative overflow-hidden">
               <div className="absolute top-4 right-4"><Zap className="text-yellow-500/50" size={16} /></div>
               <p className="text-zinc-600 text-[10px] uppercase tracking-widest font-bold mb-2">Power Mode</p>
               <h4 className="text-2xl font-black text-white italic tracking-tighter uppercase">
                 {stats?.performance_mode || (stats?.model?.status === "busy" ? "PERFORMANCE" : "BALANCED")}
               </h4>
           </div>
           <div className="glass p-6 rounded-[2rem] border-white/5 relative overflow-hidden">
               <div className="absolute top-4 right-4"><Eye className="text-pink-500/50" size={16} /></div>
               <p className="text-zinc-600 text-[10px] uppercase tracking-widest font-bold mb-2">Vision Pipeline</p>
               <h4 className="text-2xl font-black text-white italic tracking-tighter uppercase">LOCAL-CLIP</h4>
           </div>
           <div className="glass p-6 rounded-[2rem] border-white/5 relative overflow-hidden">
               <div className="absolute top-4 right-4"><Mic className="text-emerald-500/50" size={16} /></div>
               <p className="text-zinc-600 text-[10px] uppercase tracking-widest font-bold mb-2">Speech Pipeline</p>
               <h4 className="text-2xl font-black text-white italic tracking-tighter uppercase">WHISPER</h4>
           </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-hidden">
           <div className="lg:col-span-2 flex flex-col gap-8 overflow-y-auto pr-4">
              <section className="space-y-6">
                 <h2 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] flex items-center gap-3">
                   <BatteryMedium size={14} className="text-cyan-500" />
                   Lifecycle & Multimodal Strategy
                 </h2>
                 
                 <div className="grid grid-cols-3 gap-4">
                    {[
                      { id: "BATTERY_SAVER", label: "Efficient", icon: BatteryLow, color: "text-emerald-500" },
                      { id: "BALANCED", label: "Balanced", icon: BatteryMedium, color: "text-cyan-500" },
                      { id: "PERFORMANCE", label: "Brute", icon: BatteryFull, color: "text-violet-500" }
                    ].map(mode => (
                      <button 
                        key={mode.id}
                        onClick={() => setMode(mode.id)}
                        disabled={isUpdatingMode}
                        className={`glass p-6 rounded-[2rem] border-white/5 flex flex-col items-center gap-3 transition-all hover:bg-white/5 ${stats?.performance_mode === mode.id ? 'ring-2 ring-cyan-500/50 bg-white/5' : ''}`}
                      >
                        <mode.icon className={`${mode.color}`} size={24} />
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{mode.label}</span>
                      </button>
                    ))}
                 </div>
              </section>

              <section className="space-y-6">
                 <div className="grid grid-cols-2 gap-6">
                   <div className="glass p-8 rounded-[2rem] border-white/5 space-y-4">
                      <div className="flex items-center gap-3 mb-2">
                        <ImageIcon className="text-pink-500" size={18} />
                        <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Image Reasoning</h3>
                      </div>
                      <p className="text-[10px] text-zinc-500 font-medium leading-relaxed">
                        Multimodal vision encoder enabled. Support for Moondream/LLaVA path projection.
                      </p>
                      <div className="flex items-center gap-2 pt-2">
                         <div className="w-1.5 h-1.5 rounded-full bg-pink-500"></div>
                         <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Projection active</span>
                      </div>
                   </div>

                   <div className="glass p-8 rounded-[2rem] border-white/5 space-y-4">
                      <div className="flex items-center gap-3 mb-2">
                        <Mic className="text-emerald-500" size={18} />
                        <h3 className="text-[10px] font-black text-white uppercase tracking-widest">Local Transcription</h3>
                      </div>
                      <p className="text-[10px] text-zinc-500 font-medium leading-relaxed">
                        Whisper tiny/base engine available for secure, offline speech-to-text.
                      </p>
                      <div className="flex items-center gap-2 pt-2">
                         <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                         <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Whisper ready</span>
                      </div>
                   </div>
                 </div>
              </section>

              <section className="space-y-6">
                 <h2 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] flex items-center gap-3">
                   <Activity size={14} className="text-cyan-500" />
                   Performance Telemetry
                 </h2>
                 
                 <div className="grid grid-cols-2 gap-4">
                    <div className="glass p-6 rounded-[2rem] border-white/5 space-y-2">
                       <p className="text-zinc-600 text-[8px] uppercase tracking-widest font-bold">Inference Speed</p>
                       <div className="flex items-baseline gap-2">
                         <span className="text-2xl font-black text-white italic tracking-tighter">
                           {stats?.native?.tps?.toFixed(1) || "---"}
                         </span>
                         <span className="text-[10px] font-bold text-zinc-500 uppercase">tokens/sec</span>
                       </div>
                    </div>
                    <div className="glass p-6 rounded-[2rem] border-white/5 space-y-2">
                       <p className="text-zinc-600 text-[8px] uppercase tracking-widest font-bold">Total Processed</p>
                       <div className="flex items-baseline gap-2">
                         <span className="text-2xl font-black text-white italic tracking-tighter">
                           {stats?.native?.total_tokens || "---"}
                         </span>
                         <span className="text-[10px] font-bold text-zinc-500 uppercase">tokens</span>
                       </div>
                    </div>
                 </div>

                 <div className="grid grid-cols-2 gap-4">
                    <div className="glass p-4 rounded-3xl border-white/5 flex items-center justify-between">
                       <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Compute Threads</span>
                       <span className="text-sm font-black text-cyan-400 font-mono">{stats?.native?.threads || "---"}</span>
                    </div>
                    <div className="glass p-4 rounded-3xl border-white/5 flex items-center justify-between">
                       <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Batch Size</span>
                       <span className="text-sm font-black text-emerald-400 font-mono">{stats?.native?.batch || "---"}</span>
                    </div>
                 </div>

                 <div className="space-y-8 glass p-8 rounded-[2rem] border-white/5 shadow-2xl">
                    <div className="space-y-3">
                       <div className="flex justify-between items-end">
                          <Label className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Inference Response Delay (Native)</Label>
                          <span className="text-xs font-mono text-cyan-500">12ms / token</span>
                       </div>
                       <div className="stat-bar h-1.5">
                          <div className="stat-progress bg-cyan-500" style={{ width: "15%" }}></div>
                       </div>
                    </div>

                    <div className="space-y-3">
                       <div className="flex justify-between items-end">
                          <Label className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">System Memory Usage (RAM)</Label>
                          <span className="text-xs font-mono text-white">{stats?.native?.ram || stats?.ram?.heapUsed || "---"} / 8GB</span>
                       </div>
                       <div className="stat-bar h-1.5">
                          <div className="stat-progress bg-white" style={{ width: stats?.native?.ram ? "55%" : (stats?.ram?.heapUsed ? "30%" : "52%") }}></div>
                       </div>
                    </div>

                    <div className="space-y-3">
                       <div className="flex justify-between items-end">
                          <Label className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Core Temperature</Label>
                          <span className="text-xs font-mono text-red-500">{stats?.native?.temp || "39°C"}</span>
                       </div>
                       <div className="stat-bar h-1.5">
                          <div className="stat-progress bg-red-600" style={{ width: "39%" }}></div>
                       </div>
                    </div>
                 </div>
              </section>
           </div>

           <div className="space-y-8 overflow-y-auto pr-2">
              <section className="space-y-6">
                 <h2 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5 pb-3">Active Context</h2>
                 <div className="glass p-6 rounded-3xl border-white/5 relative group overflow-hidden">
                    <div className="absolute -right-4 -top-4 opacity-10 group-hover:opacity-20 transition-opacity">
                      <Cpu size={80} />
                    </div>
                    <h3 className="text-lg font-black text-white italic mb-1 tracking-tighter uppercase">
                      {stats?.active_model ? stats.active_model.split('/').pop() : "NONE"}
                    </h3>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest leading-relaxed mb-4">GGUF Warm Cache</p>
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${stats?.active_model ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
                      <span className={`text-[10px] font-black uppercase tracking-widest ${stats?.active_model ? 'text-emerald-500' : 'text-red-500'}`}>
                        {stats?.active_model ? 'Cached in RAM' : 'Cold Storage'}
                      </span>
                    </div>
                 </div>
              </section>

              <section className="space-y-6">
                 <h2 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5 pb-3">Mobile Safety</h2>
                 <div className="space-y-4">
                    <div className="glass p-4 rounded-2xl border-white/5 flex items-center justify-between group cursor-pointer hover:bg-white/5 transition-colors">
                      <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Unload Engine</span>
                      <RotateCcw size={14} className="text-zinc-600 group-hover:text-red-500 transition-colors" />
                    </div>
                    <div className="glass p-4 rounded-2xl border-white/5 flex items-center justify-between group cursor-pointer hover:bg-white/5 transition-colors">
                      <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Wipe Shared Cache</span>
                      <Database size={14} className="text-zinc-600 group-hover:text-violet-500 transition-colors" />
                    </div>
                 </div>
              </section>
           </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsView({ settings, setSettings }: { settings: AppSettings, setSettings: (s: AppSettings) => void }) {
  const [stats, setStats] = React.useState<any>(null);

  React.useEffect(() => {
    const fetchStats = async () => {
      const data = await AIService.getStats();
      if (data) setStats(data);
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 bg-transparent p-6 h-full overflow-hidden">
      <div className="max-w-4xl mx-auto h-full flex flex-col">
        <header className="mb-10 mt-6">
           <h1 className="text-4xl font-black text-white mb-2 tracking-tighter flex items-center gap-4">
              <Settings className="text-violet-500" size={32} />
              Engine Config
            </h1>
            <p className="text-zinc-500 text-sm font-medium uppercase tracking-[0.2em]">System Optimization • Adreno 750 Core</p>
        </header>

        <ScrollArea className="flex-1 pr-2 scrollbar-hide">
          <div className="space-y-10 pb-20">
            {stats && (
               <section className="space-y-6">
                 <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5 pb-3">Resource Monitor</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="glass p-5 rounded-3xl border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                         <div className="p-2 rounded-xl bg-violet-600/20 text-violet-400">
                           <Database size={16} />
                         </div>
                         <span className="text-sm font-bold text-zinc-300">Native RAM</span>
                      </div>
                      <span className="text-sm font-mono text-violet-400">{stats.native?.ram || stats.ram?.heapUsed || "---"}</span>
                    </div>
                    <div className="glass p-5 rounded-3xl border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                         <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                           <Cpu size={16} />
                         </div>
                         <span className="text-sm font-bold text-zinc-300">Engine Status</span>
                      </div>
                      <Badge variant="outline" className={`text-[9px] uppercase font-bold tracking-widest ${(stats.native?.state || stats.engine_state || stats.model?.status) === 'busy' ? 'border-amber-500 text-amber-500' : 'border-emerald-500 text-emerald-500'}`}>
                         {stats.native?.state || stats.engine_state || stats.model?.status || "READY"}
                      </Badge>
                    </div>
                 </div>
               </section>
            )}

            <section className="space-y-6">
               <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5 pb-3">Standard Parameters</h3>
               <div className="grid grid-cols-1 gap-6">
                  <div className="glass p-8 rounded-[2.5rem] border-white/5 space-y-8">
                     <div className="space-y-4">
                        <div className="flex justify-between items-center">
                           <Label className="text-zinc-100 font-bold text-sm tracking-tight text-lg">Temperature</Label>
                           <span className="text-violet-400 font-mono text-xs bg-violet-400/10 px-2 py-1 rounded-md">{settings.temperature}</span>
                        </div>
                        <Slider 
                           value={[settings.temperature]} 
                           max={2} 
                           step={0.1} 
                           onValueChange={(val) => setSettings({ ...settings, temperature: Array.isArray(val) ? val[0] : val })}
                        />
                        <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Higher values = more creative/random</p>
                     </div>

                     <div className="space-y-4">
                        <div className="flex justify-between items-center">
                           <Label className="text-zinc-100 font-bold text-sm tracking-tight text-lg">Top P (Nucleus Sampling)</Label>
                           <span className="text-violet-400 font-mono text-xs bg-violet-400/10 px-2 py-1 rounded-md">{settings.topP}</span>
                        </div>
                        <Slider 
                           value={[settings.topP]} 
                           max={1} 
                           step={0.01} 
                           onValueChange={(val) => setSettings({ ...settings, topP: Array.isArray(val) ? val[0] : val })}
                        />
                        <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Controls vocabulary diversity</p>
                     </div>

                     <div className="space-y-4">
                        <div className="flex justify-between items-center">
                           <Label className="text-zinc-100 font-bold text-sm tracking-tight text-lg">Max Generation Tokens</Label>
                           <span className="text-violet-400 font-mono text-xs bg-violet-400/10 px-2 py-1 rounded-md">{settings.maxTokens}</span>
                        </div>
                        <Slider 
                           value={[settings.maxTokens]} 
                           max={4096} 
                           step={128} 
                           onValueChange={(val) => setSettings({ ...settings, maxTokens: Array.isArray(val) ? val[0] : val })}
                        />
                        <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Limit on response length</p>
                     </div>
                  </div>
               </div>
            </section>

            <section className="space-y-6">
               <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5 pb-3">Runtime Engine</h3>
               <div className="flex items-center justify-between rounded-3xl glass p-6 border-white/5 shadow-xl">
                 <div className="space-y-2">
                   <Label className="text-zinc-100 font-bold text-lg tracking-tight">Local Inference Bridge</Label>
                   <p className="text-sm text-zinc-500">Enable the localhost API to bypass Gemini cloud calls.</p>
                 </div>
                 <Switch 
                   checked={settings.apiEnabled} 
                   onCheckedChange={(val) => {
                     setSettings({ ...settings, apiEnabled: val });
                     AIService.setMode(val);
                   }} 
                   className="data-[state=checked]:bg-violet-600"
                 />
               </div>
            </section>

            <section className="space-y-6">
               <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5 pb-3">Hardware Acceleration</h3>
               <div className="flex items-center justify-between rounded-3xl glass p-6 border-white/5 shadow-xl">
                 <div className="space-y-2">
                   <Label className="text-zinc-100 font-bold text-lg tracking-tight">Vulkan LLM Backend</Label>
                   <p className="text-sm text-zinc-500">Redirect weights to GPU buffers. Significant performance gain on Snapdragon/Exynos.</p>
                 </div>
                 <Switch 
                   checked={settings.vulkanEnabled} 
                   onCheckedChange={(val) => setSettings({ ...settings, vulkanEnabled: val })} 
                   className="data-[state=checked]:bg-emerald-500"
                 />
               </div>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="glass p-6 rounded-[2rem] border-white/5">
                     <Label className="text-zinc-100 font-bold text-sm mb-6 block tracking-tight">Inference Threads</Label>
                     <Slider defaultValue={[4]} max={8} step={1} className="mb-6" />
                     <div className="flex justify-between items-center">
                        <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Efficiency Mode</span>
                        <span className="text-violet-400 font-mono text-xs">4 Cores Active</span>
                     </div>
                  </div>
                  <div className="glass p-6 rounded-[2rem] border-white/5">
                     <Label className="text-zinc-100 font-bold text-sm mb-6 block tracking-tight">KV Cache Size</Label>
                     <Slider defaultValue={[4096]} max={32768} step={1024} className="mb-6" />
                     <div className="flex justify-between items-center">
                        <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Memory Limit</span>
                        <span className="text-violet-400 font-mono text-xs">4096 Tokens</span>
                     </div>
                  </div>
               </div>
            </section>

            <section className="space-y-6">
               <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5 pb-3">Integrations</h3>
               <div className="flex items-center justify-between rounded-3xl glass p-6 border-white/5 shadow-xl transition-all hover:bg-white/[0.02]">
                 <div className="space-y-2">
                   <Label className="text-zinc-100 font-bold text-lg tracking-tight">Ollama-Compatible API</Label>
                   <p className="text-sm text-zinc-500">Expose local host for external connections via Wi-Fi.</p>
                 </div>
                 <Switch 
                   checked={settings.apiEnabled} 
                   onCheckedChange={(val) => setSettings({ ...settings, apiEnabled: val })} 
                   className="data-[state=checked]:bg-violet-600"
                 />
               </div>
               {settings.apiEnabled && (
                 <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-2xl flex items-center gap-4 group">
                    <Globe size={18} className="text-emerald-400 animate-pulse" />
                    <div>
                      <p className="text-[10px] text-emerald-500 font-black uppercase tracking-widest mb-1">Local Address</p>
                      <p className="text-emerald-300 font-mono text-sm tracking-tight italic">http://192.168.1.15:{settings.apiPort}/api/*</p>
                    </div>
                 </div>
               )}
            </section>

            <section className="space-y-6">
               <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5 pb-3">Laboratory Extras</h3>
               <div className="glass rounded-[2rem] border-white/5 overflow-hidden divide-y divide-white/5">
                  <div className="p-6 flex items-center justify-between hover:bg-white/[0.02] transition-all">
                     <div className="space-y-1">
                        <Label className="text-zinc-100 font-bold tracking-tight">Semantic Memory (RAG)</Label>
                        <p className="text-xs text-zinc-500">Inject vector-retrieved context into inference prompts.</p>
                     </div>
                     <Switch checked={settings.memoryEnabled} onCheckedChange={(val) => setSettings({ ...settings, memoryEnabled: val })} />
                  </div>
                  <div className="p-6 flex items-center justify-between hover:bg-white/[0.02] transition-all">
                     <div className="space-y-1">
                        <Label className="text-zinc-100 font-bold tracking-tight">Offline Voice Assistant</Label>
                        <p className="text-xs text-zinc-500">Enable Whisper/TTS local pipeline for hands-free mode.</p>
                     </div>
                     <Switch checked={settings.voiceEnabled} onCheckedChange={(val) => setSettings({ ...settings, voiceEnabled: val })} />
                  </div>
               </div>
            </section>

            <div className="pt-10 flex flex-col items-center gap-6">
               <div className="flex items-center gap-6 grayscale opacity-20">
                  <Cpu size={24} />
                  <Database size={24} />
                  <Shield size={24} />
               </div>
               <div className="flex items-center gap-3 bg-white/5 px-6 py-2 rounded-full border border-white/5">
                  <Shield size={12} className="text-emerald-400" />
                  <span className="text-[10px] text-zinc-500 uppercase tracking-[0.3em] font-black">Zero-Cloud Security Architecture</span>
               </div>
               <p className="text-[9px] text-zinc-700 font-mono">SUNAYNA CORE v0.9.2-STABLE • ANDROID RUNTIME</p>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
