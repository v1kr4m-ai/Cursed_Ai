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
  Image as ImageIcon,
  Loader2,
  Folder,
  Pencil,
  Trash2,
  Upload,
  Download
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
import { AppSettings, Chat } from "../../types";

import { AIService } from "../../services/aiService";
import { notify, notifyError } from "../../lib/notify";
import { FolderPickerDialog } from "./FolderPickerDialog";
import { MicTest } from "./MicTest";
import { AppearanceSettings } from "./AppearanceSettings";
import { SettingsPage } from "./SettingsPage";
import { VoiceSpeechSettings } from "./VoiceSpeechSettings";

export function MemoryView() {
  const [memories, setMemories] = React.useState<{ text: string, timestamp: number }[]>([]);
  const [newMemory, setNewMemory] = React.useState("");
  const [isAdding, setIsAdding] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const importRef = React.useRef<HTMLInputElement>(null);
  const [importing, setImporting] = React.useState(false);
  const exportMemories = () => {
    const blob = new Blob([JSON.stringify(memories, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cursed-memory-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importMemories = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    try {
      const data = JSON.parse(await file.text());
      const entries = Array.isArray(data) ? data : data?.entries;
      if (!Array.isArray(entries)) throw new Error("That file is not a memory export (expected a JSON list).");
      const r = await AIService.importMemories(entries);
      notify({ message: `Imported ${r.added} note(s)${r.skipped ? `, skipped ${r.skipped} duplicate/empty` : ""}`, tab: "memory" });
      fetchMemories();
    } catch (e: any) { notifyError(e.message, "memory"); }
    finally { setImporting(false); if (importRef.current) importRef.current.value = ""; }
  };
  const [editing, setEditing] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState("");

  const removeMemory = async (m: { timestamp: number }) => {
    try { await AIService.deleteMemory(m.timestamp); fetchMemories(); } catch (e: any) { notifyError(e.message, "memory"); }
  };
  const saveEdit = async () => {
    if (editing === null || !draft.trim()) return;
    try { await AIService.editMemory(editing, draft.trim()); setEditing(null); fetchMemories(); } catch (e: any) { notifyError(e.message, "memory"); }
  };

  const filteredMemories = memories.filter(m => m.text.toLowerCase().includes(search.toLowerCase()));

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
           <h1 className="text-2xl font-black text-white mb-2 tracking-tighter flex items-center gap-4">
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
             <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(e) => importMemories(e.target.files?.[0])} />
             <Search size={18} className="text-zinc-500" />
             <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vector space..."
              className="bg-transparent border-none focus:ring-0 text-sm text-zinc-100 w-full placeholder:text-zinc-700 font-medium"
             />
             <button onClick={() => importRef.current?.click()} disabled={importing} title="Import notes from a JSON file" className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg disabled:opacity-40">{importing ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Import</button>
             <button onClick={exportMemories} disabled={memories.length === 0} title="Save all notes to a JSON file" className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-zinc-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg disabled:opacity-40"><Download size={12} /> Export</button>
           </div>
           <ScrollArea className="flex-1">
             <div className="divide-y divide-white/5">
               {filteredMemories.length === 0 && (
                 <div className="p-20 text-center space-y-4">
                    <Database className="mx-auto text-zinc-800" size={48} />
                    <p className="text-zinc-600 text-xs font-bold uppercase tracking-widest">
                      {memories.length === 0 ? "Semantic store is empty" : "No memories match your search"}
                    </p>
                 </div>
               )}
               {filteredMemories.map((m) => (
                 <div key={m.timestamp} className="p-6 hover:bg-white/5 transition-colors group relative overflow-hidden">
                    <div className="flex justify-between items-start mb-3">
                      <div className="model-tag text-[9px]">Memory Chunk</div>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono text-zinc-600 flex items-center gap-2 group-hover:text-zinc-400 transition-colors">
                          <Clock size={11} /> {new Date(m.timestamp).toLocaleDateString()}
                        </span>
                        <button onClick={() => { setEditing(m.timestamp); setDraft(m.text); }} title="Edit memory" className="p-1.5 rounded-lg text-zinc-500 hover:text-violet-400 hover:bg-white/5 transition-colors"><Pencil size={14} /></button>
                        <button onClick={() => removeMemory(m)} title="Delete memory" className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-white/5 transition-colors"><Trash2 size={14} /></button>
                      </div>
                    </div>
                    {editing === m.timestamp ? (
                      <div className="mb-4 space-y-2">
                        <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setEditing(null); if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveEdit(); }} rows={3} className="w-full bg-white/5 border-none rounded-2xl px-4 py-3 text-[15px] text-white focus:outline-none focus:ring-1 focus:ring-violet-500 resize-y" />
                        <div className="flex gap-2">
                          <button onClick={saveEdit} disabled={!draft.trim()} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40">Save</button>
                          <button onClick={() => setEditing(null)} className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[15px] text-zinc-300 mb-4 leading-relaxed font-medium">{m.text}</p>
                    )}
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

export { EngineView } from "./EngineView";

interface ModelSourceInfo { id: string; kind: string; label: string; path: string; enabled: boolean; detected: boolean; exists: boolean; count: number }

function ModelsDirectorySection() {
  const [modelsDir, setModelsDir] = React.useState<string | null>(null);
  const [sources, setSources] = React.useState<ModelSourceInfo[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // which folder picker is open: choosing a download folder, or adding a folder to read models from
  const [picker, setPicker] = React.useState<"download" | "add" | null>(null);

  const fetchConfig = React.useCallback(async () => {
    try {
      const data = await (await fetch("/api/config")).json();
      setModelsDir(data.modelsDir);
      setSources(data.sources || []);
    } catch (e) {
      console.error("Failed to fetch config", e);
    }
  }, []);
  React.useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const changed = () => { fetchConfig(); window.dispatchEvent(new Event("cursed:models-changed")); };

  const setDownloadDir = async (dir: string) => {
    setSaving(true); setError(null);
    try {
      const resp = await fetch("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelsDir: dir.trim() }) });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to save");
      changed();
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  };

  const sourceAction = async (body: object) => {
    setError(null);
    const resp = await fetch("/api/config/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await resp.json();
    if (!resp.ok) { setError(data.error || "Failed"); return; }
    setSources(data.sources);
    window.dispatchEvent(new Event("cursed:models-changed"));
  };

  const total = sources.filter(x => x.enabled).reduce((n, x) => n + x.count, 0);

  return (
    <section className="space-y-6">
      <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em] border-b border-white/5 pb-3">Storage</h3>

      <div className="glass p-6 rounded-[2rem] border-white/5 space-y-4">
        <div className="space-y-1">
          <Label className="text-zinc-100 font-bold tracking-tight">Model locations</Label>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Cursed_Ai runs models straight from the folders below - nothing is copied, so a model you already have in Ollama or LM Studio is never stored twice.
            These folders are only read; deleting a model is done in the app that owns it. {total} model file{total === 1 ? "" : "s"} found.
          </p>
        </div>
        <div className="space-y-2">
          {sources.map(src => (
            <div key={src.id} className="flex items-center gap-3 bg-white/5 rounded-xl px-4 py-3">
              <Switch checked={src.enabled} onCheckedChange={(v) => sourceAction({ action: "toggle", id: src.id, enabled: v })} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  {src.label}
                  {src.detected && <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400">auto-detected</span>}
                  {!src.exists && <span className="text-[9px] font-black uppercase tracking-widest text-red-400">folder missing</span>}
                </p>
                <p className="text-[10px] text-zinc-500 font-mono truncate" title={src.path}>{src.path}</p>
              </div>
              <span className="text-xs text-zinc-400 shrink-0">{src.enabled ? `${src.count} model${src.count === 1 ? "" : "s"}` : "off"}</span>
              {src.kind === "custom" && (
                <button onClick={() => sourceAction({ action: "remove", id: src.id })} title="Remove this folder from the list (files are not touched)" className="text-zinc-500 hover:text-red-400 text-xs">Remove</button>
              )}
            </div>
          ))}
        </div>
        <Button onClick={() => setPicker("add")} variant="ghost" className="bg-white/5 hover:bg-white/10 text-zinc-300 font-bold text-xs h-9">
          <Folder size={14} className="mr-2" /> Add another models folder
        </Button>
      </div>

      <div className="glass p-6 rounded-[2rem] border-white/5 space-y-4">
        <div className="space-y-1">
          <Label className="text-zinc-100 font-bold tracking-tight">Download folder</Label>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Where new models from Hugging Face are saved. Pick LM Studio's folder (or any folder above) to share downloads with that app. Cursed_Ai refuses to download a file you already have in any folder.
            Models pulled from the Ollama library are stored by Ollama itself, in its own folder.
          </p>
        </div>
        <div className="flex gap-3">
          <select
            value={sources.some(x => x.path === modelsDir) ? modelsDir! : ""}
            onChange={(e) => e.target.value && setDownloadDir(e.target.value)}
            className="flex-1 h-10 rounded-xl bg-zinc-900 border border-white/10 text-zinc-100 text-xs px-3 font-mono"
          >
            {!sources.some(x => x.path === modelsDir) && <option value="">{modelsDir}</option>}
            {sources.filter(x => x.kind !== "ollama" && x.exists).map(x => <option key={x.id} value={x.path}>{x.label} - {x.path}</option>)}
          </select>
          <Button onClick={() => setPicker("download")} variant="ghost" disabled={saving} className="bg-white/5 hover:bg-white/10 text-zinc-300 font-bold shrink-0">
            {saving ? <Loader2 className="animate-spin" size={16} /> : <><Folder size={16} className="mr-2" /> Browse</>}
          </Button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      <FolderPickerDialog
        open={picker !== null}
        onOpenChange={(o) => !o && setPicker(null)}
        initialPath={modelsDir || ""}
        title={picker === "add" ? "Add a models folder" : "Choose the download folder"}
        onSelect={(p) => { if (picker === "add") sourceAction({ action: "add", path: p }); else setDownloadDir(p); setPicker(null); }}
      />
    </section>
  );
}

export function SettingsView({ settings, setSettings, chats = [], onImportChats = () => 0, onClearChats = () => {}, onResetSettings = () => {} }: { settings: AppSettings, setSettings: (s: AppSettings) => void, chats?: Chat[], onImportChats?: (c: Chat[]) => number, onClearChats?: () => void, onResetSettings?: () => void }) {
  return <SettingsPage settings={settings} setSettings={setSettings} chats={chats} onImportChats={onImportChats} onClearChats={onClearChats} onResetSettings={onResetSettings} modelsSection={<ModelsDirectorySection />} />;
}
