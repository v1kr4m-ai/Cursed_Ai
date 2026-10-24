/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PAUSE_DEFAULT_MS } from "./services/voicePause";
import React, { useState, useEffect, useCallback, useRef } from "react";
import { readSavedSettings, saveSettings, savedSetting } from "./lib/settingsStore";
import { requestStudio } from "./lib/studioBridge";
import { Eye } from "lucide-react";
import { Sidebar, MobileHeader } from "./components/layout/Sidebar";
import { ChatWindow } from "./components/chat/ChatWindow";
import { ModelManager } from "./components/models/ModelManager";
import { inferFlags } from "./lib/modelTags";
import { parseSize } from "./lib/ramFit";
import { notifyError, notify } from "./lib/notify";
import { SystemBar } from "./components/layout/SystemBar";
import { ToastHost } from "./components/layout/ToastHost";
import { VisionView } from "./components/tools/VisionView";
import { VoiceAssistant } from "./components/voice/VoiceAssistant";
import { MemoryView, SettingsView, EngineView } from "./components/tools/ExtraViews";
import { ConsoleView } from "./components/tools/ConsoleView";
import { ImageGeneratorView } from "./components/tools/ImageGenerator";
import { VideoGeneratorView } from "./components/tools/VideoGenerator";
import { SeriesStudioView } from "./components/tools/series/SeriesStudio";
import { SeriesNotifier } from "./components/tools/series/SeriesNotifier";
import { ComfyConsolePip } from "./components/tools/ComfyConsolePip";
import { OllamaClaudeView } from "./components/oclaude/OllamaClaudeView";
import { TrainLoraView } from "./components/train/TrainLoraView";
import { FineTuneView } from "./components/train/FineTuneView";
import { SpeechTrainView } from "./components/train/SpeechTrainView";
import { ThemeQuick } from "./components/tools/ThemeSettings";
import { effectiveTheme, themeById } from "./lib/themes";
import { Chat, AIModel, AppSettings, MessageRole } from "./types";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { AIService } from "./services/aiService";

const INITIAL_MODELS: AIModel[] = [
  {
    id: "phi-3-mini",
    name: "Phi-3 Mini",
    description: "Microsoft's efficient small language model. Perfect for general assistant tasks on mobile.",
    size: "2.3 GB",
    format: "GGUF",
    isDownloaded: false,
    parameters: "3.8B",
    type: "General",
    downloadUrl: "https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-q4.gguf",
  },
  {
    id: "tinyllama",
    name: "TinyLlama",
    description: "Ultra-fast inference on low RAM devices. Optimized for speed and basic reasoning.",
    size: "600 MB",
    format: "GGUF",
    isDownloaded: false,
    parameters: "1.1B",
    type: "Fast",
    downloadUrl: "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf",
  },
  {
    id: "mistral-7b",
    name: "Mistral 7B",
    description: "Advanced reasoning and deep understanding. Requires 8GB+ RAM for smooth performance.",
    size: "4.1 GB",
    format: "GGUF",
    isDownloaded: false,
    parameters: "7B",
    type: "Reasoning",
    downloadUrl: "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf",
  },
  {
    id: "moondream",
    name: "Moondream 2",
    description: "Vision-capable model. Image understanding isn't wired up in this build yet � downloading it won't enable vision chat.",
    size: "1.6 GB",
    format: "GGUF",
    isDownloaded: false,
    parameters: "1.6B",
    type: "Vision",
    // No downloadUrl on purpose: there's no local vision-inference path yet,
    // so we don't offer a download that would silently do nothing useful.
  }
];

/** Every setting at its default (also what Settings -> Reset puts back). */
function defaultSettings(): AppSettings {
  return {
    vulkanEnabled: true,
    theme: "classic",
    apiPort: 3000,
    apiEnabled: false,
    memoryEnabled: true,
    voiceEnabled: true,
    voicePauseMs: PAUSE_DEFAULT_MS,
    voiceEngine: ((): "auto" | "browser" | "whisper" => { try { const v = localStorage.getItem("cursed.voiceEngine"); return v === "browser" || v === "whisper" ? v : "auto"; } catch { return "auto"; } })(),
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1024,
    threads: 4,
    kvCacheSize: 4096,
    topK: 40,
    minP: 0.05,
    repeatPenalty: 1.1,
    seedMode: "random",
    seed: 42,
    defaultSystemPrompt: "",
    enterToSend: true,
    autoSpeak: false,
    confirmDelete: true,
    popups: true,
    desktopNotify: false,
    reduceMotion: false,
    startTab: "chat",
    sidebarCollapsed: false,
    uiFont: "default",
    showStatusBar: true,
    shortcuts: true,
    historyLimit: 0,
    memoryTopK: 3,
    popupSeconds: 5,
    soundOnDone: false,
    defaultSource: "local",
    defaultInstances: 1,
    imageSizeIdx: 2,
    videoSeconds: 4,
    assistantStudio: true,
    themeMode: "global",
    moduleThemes: {},
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<string>(() => readSavedSettings().startTab || "chat");
  // Other pages ask to open a tab with a window event (for example Series sending a person to Train LoRA).
  useEffect(() => {
    const go = (e: Event) => { const tab = (e as CustomEvent).detail?.tab; if (typeof tab === "string") setActiveTab(tab); };
    window.addEventListener("cursed:goto", go);
    return () => window.removeEventListener("cursed:goto", go);
  }, []);
  const [chats, setChats] = useState<Chat[]>(() => {
    try { return JSON.parse((localStorage.getItem("cursed.chats") ?? localStorage.getItem("sunayna.chats") ?? "[]")).filter((c: Chat) => c.messages?.length); } catch { return []; }
  });
  // Every launch starts on a fresh chat (the welcome screen); past chats are opened from History.
  const [activeChatId, setActiveChatId] = useState<string | undefined>(undefined);
  // Chat history survives reloads (browser storage).
  useEffect(() => {
    try { localStorage.setItem("cursed.chats", JSON.stringify(chats)); } catch { /* storage full/blocked */ }
  }, [chats]);
  // Chats also live on the server (chats.json): merge them in once at start, then keep the file up to date.
  const [chatsSynced, setChatsSynced] = useState(false);
  useEffect(() => {
    fetch("/api/chats").then(r => r.json()).then((server: Chat[]) => {
      setChats(local => {
        const byId = new Map<string, Chat>();
        for (const c of [...(Array.isArray(server) ? server : []), ...local]) {
          if (!c?.id || !c.messages?.length) continue;
          const have = byId.get(c.id);
          if (!have || (c.updatedAt || 0) > (have.updatedAt || 0)) byId.set(c.id, c);
        }
        return [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      });
      setChatsSynced(true);
    }).catch(() => { /* server not reachable: keep working from this browser's copy */ });
  }, []);
  useEffect(() => {
    if (!chatsSynced) return;
    const t = setTimeout(() => { fetch("/api/chats", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chats }) }).catch(() => {}); }, 1500);
    return () => clearTimeout(t);
  }, [chats, chatsSynced]);
  // Unread tracking: a chat that gets new assistant text while it is not on screen is marked unread; opening it clears the mark.
  const chatSig = useRef(new Map<string, string>());
  useEffect(() => {
    const viewing = (id: string) => activeTab === "chat" && activeChatId === id && !document.hidden;
    let changed = false;
    const next = chats.map(c => {
      const last = c.messages[c.messages.length - 1];
      const sig = last ? `${c.messages.length}:${last.role}:${last.content.length}` : "";
      const before = chatSig.current.get(c.id);
      chatSig.current.set(c.id, sig);
      if (viewing(c.id)) { if (c.unread) { changed = true; return { ...c, unread: false }; } return c; }
      if (before !== undefined && before !== sig && last?.role === "assistant" && !c.unread) { changed = true; return { ...c, unread: true }; }
      return c;
    });
    if (changed) setChats(next);
  }, [chats, activeTab, activeChatId]);
  useEffect(() => {
    const onVis = () => { if (!document.hidden) setChats(prev => prev.some(c => c.unread && c.id === activeChatId && activeTab === "chat") ? prev.map(c => c.id === activeChatId ? { ...c, unread: false } : c) : prev); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [activeChatId, activeTab]);
  const [serverUp, setServerUp] = useState(true);
  // Heartbeat: shows a banner the moment the local server stops answering.
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const r = await fetch("/api/health", { signal: AbortSignal.timeout(3000) });
        if (alive) setServerUp(r.ok);
      } catch { if (alive) setServerUp(false); }
    };
    const t = setInterval(ping, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  // Tell the server when this window closes (it stops itself in desktop-app mode if nobody else is connected).
  useEffect(() => {
    const bye = () => { try { navigator.sendBeacon("/api/app/closing"); } catch { /* ignore */ } };
    window.addEventListener("pagehide", bye);
    return () => window.removeEventListener("pagehide", bye);
  }, []);
  // Keyboard shortcuts: Ctrl+K new chat, Ctrl+/ jump to the message box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !savedSetting("shortcuts", true)) return;
      if (e.key.toLowerCase() === "k") { e.preventDefault(); setActiveChatId(undefined); setActiveTab("chat"); setTimeout(() => document.querySelector("textarea")?.focus(), 80); }
      else if (e.key === "/") { e.preventDefault(); setActiveTab("chat"); setTimeout(() => document.querySelector("textarea")?.focus(), 80); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const wasUp = useRef(true);
  useEffect(() => {
    if (wasUp.current && !serverUp) notifyError("Lost connection to the Cursed_Ai server - start it again with Cursed_Ai.bat.");
    if (!wasUp.current && serverUp) notify("Server connection restored");
    wasUp.current = serverUp;
  }, [serverUp]);
  const downloadControllers = useRef(new Map<string, AbortController>());
  const [models, setModels] = useState<AIModel[]>(INITIAL_MODELS);
  const [selectedModelId, setSelectedModelId] = useState("phi-3-mini");
  
  const refreshModels = useCallback(async () => {
    {
      const data = await AIService.getModels();
      const ext = await fetch("/api/external-models").then(r => r.json()).catch(() => null);
      const gem = await fetch("/api/gemini-key").then(r => r.json()).catch(() => null);
      const onl = await fetch("/api/online/providers").then(r => r.json()).catch(() => null);

      setModels(prev => {
        const available: string[] = data?.available || [];
        const norm = (n: string) => n.toLowerCase().replace(" ", "-");
        // Catalog entries: downloaded if a matching file is on disk.
        const known = prev.filter(m => !m.source || m.source === "gguf").map(m => ({
          ...m,
          isDownloaded: available.filter((f: string) => !f.startsWith("@")).some((f: string) =>
            f.toLowerCase() === m.id.toLowerCase() ||
            f.toLowerCase() === `${m.id}.gguf`.toLowerCase() ||
            f.toLowerCase().includes(norm(m.name))
          ),
        }));
        // Every other model file found in the user's model folders (download folder, LM Studio, Ollama, custom).
        // Entries from Ollama's folder are skipped while Ollama itself is running - it already lists them below,
        // and listing both would show the same model twice.
        const ollamaUp = !!ext?.ollama?.running;
        const extraFiles: AIModel[] = available
          .filter((f: string) => !(ollamaUp && data?.details?.[f]?.origin === "ollama"))
          .filter((f: string) => !/embed/i.test(data?.details?.[f]?.name || f))
          .map((f: string) => ({ f, id: f.startsWith("@") ? f : f.replace(/\.gguf$/i, "") }))
          .filter(({ id }: { id: string }) => !known.some(m => m.isDownloaded && (id.toLowerCase() === m.id.toLowerCase() || (!id.startsWith("@") && id.toLowerCase().includes(norm(m.name))))))
          .map(({ f, id }: { f: string; id: string }): AIModel => {
            const d = data?.details?.[f];
            const bytes: number | undefined = data?.sizes?.[f];
            return {
              id, name: d?.name || id.split("/").pop() || id,
              description: d ? `From ${d.label}: ${d.file}` : "GGUF file from your models folder.",
              size: bytes ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : "", sizeBytes: bytes, format: "GGUF",
              isDownloaded: true, parameters: "", type: "General", source: "gguf",
              origin: d?.origin, location: d?.file,
            };
          });
        const fromServer = (provider: "ollama" | "lmstudio", label: string): AIModel[] =>
          (ext?.[provider]?.models || []).map((name: string): AIModel => ({
            id: `${provider}:${name}`, name, description: `Served by ${label} on this machine.`, size: "",
            format: "GGUF", isDownloaded: true, parameters: label, type: "General", source: provider,
            tags: inferFlags(name, [], ext?.[provider]?.caps?.[name] || []),
            sizeBytes: ext?.[provider]?.sizes?.[name] || undefined,
            ...(ext?.[provider]?.sizes?.[name] ? { size: `${(ext[provider].sizes[name] / 1024 ** 3).toFixed(1)} GB` } : {}),
          }));
        // Online (Google) models: always listed so they are discoverable; usable once a Gemini key is saved.
        const online: AIModel[] = [["gemini-2.5-flash", "Gemini 2.5 Flash", "Fast"], ["gemini-2.5-pro", "Gemini 2.5 Pro", "Reasoning"]].map(([id, name, type]): AIModel => ({
          id: `gemini:${id}`, name, description: gem?.set ? "Online - answered by Google Gemini (needs internet)." : "Online - add a Gemini API key in Settings > Integrations to use it.",
          size: "", format: "GGUF", isDownloaded: !!gem?.set, parameters: "Cloud", type: type as AIModel["type"], source: "gemini", tags: ["Cloud"],
        }));
        // Online providers set up in Settings: one entry per model, listed once a key is saved and the provider is on.
        const viaKeys: AIModel[] = ((onl?.providers || []) as any[]).filter(p => p.keySet && p.enabled).flatMap((p: any): AIModel[] =>
          (p.models as string[]).map((name): AIModel => ({
            id: `online:${p.id}:${name}`, name: `${name}`, description: `Online - answered by ${p.label} (needs internet; the chat is sent to them).`,
            size: "", format: "GGUF", isDownloaded: true, parameters: p.label, type: "General", source: "online", tags: ["Cloud"],
          })));
        return [...known, ...extraFiles, ...fromServer("ollama", "Ollama"), ...fromServer("lmstudio", "LM Studio"), ...online, ...viaKeys]
          .map(m => ({ ...m, tags: m.tags ?? inferFlags(m.name), sizeBytes: m.sizeBytes ?? parseSize(m.size) }));
      });
    }
  }, []);
  useEffect(() => {
    refreshModels();
    window.addEventListener("cursed:models-changed", refreshModels);
    return () => window.removeEventListener("cursed:models-changed", refreshModels);
  }, [refreshModels]);

  // If the selected model isn't actually available (e.g. the default isn't
  // downloaded) but others are, switch to the first usable one.
  useEffect(() => {
    const cur = models.find(m => m.id === selectedModelId);
    if (cur?.isDownloaded) return;
    // Prefer models that run fully locally over Ollama ":cloud" ones.
    const firstUsable = models.find(m => m.isDownloaded && !/:cloud$|-cloud$/.test(m.id)) || models.find(m => m.isDownloaded);
    if (firstUsable) setSelectedModelId(firstUsable.id);
  }, [models]);

  const [settings, setSettings] = useState<AppSettings>(() => ({ ...defaultSettings(), ...readSavedSettings() }));
  // Settings survive a reload; the motion switch is applied to the whole page.
  useEffect(() => { saveSettings(settings); }, [settings]);
  useEffect(() => { document.documentElement.dataset.font = settings.uiFont; }, [settings.uiFont]);
  const globalTheme = themeById(settings.theme).id;
  const moduleTheme = effectiveTheme(settings, activeTab);
  useEffect(() => { document.documentElement.dataset.theme = globalTheme; }, [globalTheme]);
  useEffect(() => { document.documentElement.dataset.motion = settings.reduceMotion ? "reduce" : "full"; }, [settings.reduceMotion]);

  const setVoiceEngine = (v: "auto" | "browser" | "whisper") => {
    setSettings(prev => ({ ...prev, voiceEngine: v }));
  };
  useEffect(() => { try { localStorage.setItem("cursed.voiceEngine", settings.voiceEngine); } catch { /* storage blocked */ } }, [settings.voiceEngine]);

  const selectedModel = models.find(m => m.id === selectedModelId) || models[0];
  const activeChat = chats.find(c => c.id === activeChatId) || null;

  const createNewChat = (): Chat => {
    const newChat: Chat = {
      id: Date.now().toString(),
      title: "New Interaction",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelId: selectedModelId,
      ...(settings.defaultSystemPrompt.trim() ? { systemPrompt: settings.defaultSystemPrompt.trim() } : {}),
    };
    // Functional update: createNewChat and the onUpdateChat it's immediately
    // followed by (sending the first message from the welcome screen) both
    // fire in the same synchronous tick. A plain `setChats([newChat, ...chats])`
    // reads the stale `chats` closure, and whichever of the two setChats
    // calls applies second silently clobbers the other's result.
    setChats(prev => [newChat, ...prev]);
    setActiveChatId(newChat.id);
    setActiveTab("chat");
    return newChat;
  };

  const updateChat = (updatedChat: Chat) => {
    setChats(prev => prev.map(c => c.id === updatedChat.id ? updatedChat : c));
  };

  const archiveChat = (id: string) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, archived: true } : c));
    if (activeChatId === id) setActiveChatId(undefined);
  };

  const renameChat = (id: string, title: string) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, title } : c));
  };

  const pinChat = (id: string) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c));
  };

  const deleteChat = (id: string) => {
    setChats(prev => prev.filter(c => c.id !== id));
    if (activeChatId === id) setActiveChatId(undefined);
  };

  const unarchiveChat = (id: string) => {
    setChats(prev => prev.map(c => c.id === id ? { ...c, archived: false } : c));
  };

  const updateModel = (id: string, patch: Partial<AIModel>) => {
    setModels(prev => prev.map(m => (m.id === id ? { ...m, ...patch } : m)));
  };

  const handleDownloadModel = async (id: string) => {
    const model = models.find(m => m.id === id);
    if (!model?.downloadUrl) return;

    updateModel(id, { downloadProgress: 0 });
    const controller = new AbortController();
    downloadControllers.current.set(id, controller);

    try {
      const response = await fetch("/api/models/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, url: model.downloadUrl }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("Failed to start download");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = JSON.parse(line.slice(6));
          if (data.error) throw new Error(data.error);
          if (typeof data.progress === "number") {
            updateModel(id, { downloadProgress: data.progress === 100 ? undefined : data.progress });
          }
          if (data.done) {
            updateModel(id, { isDownloaded: true, downloadProgress: undefined });
          }
        }
      }
    } catch (e) {
      console.error(`Failed to download ${id}:`, e);
      updateModel(id, { downloadProgress: undefined });
    }
  };

  const handleCancelDownload = (id: string) => {
    downloadControllers.current.get(id)?.abort();
    downloadControllers.current.delete(id);
    updateModel(id, { downloadProgress: undefined });
  };

  const handleDeleteModel = async (id: string) => {
    try {
      await fetch(`/api/models/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (e) {
      console.error(`Failed to delete ${id}:`, e);
      return;
    }
    updateModel(id, { isDownloaded: false });
    refreshModels();
    if (selectedModelId === id) {
       setSelectedModelId("phi-3-mini");
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden font-sans selection:bg-violet-500/30 selection:text-violet-400 p-4 gap-4">
        <div className="atmosphere"></div>
        <ToastHost activeTab={activeTab} onNavigate={setActiveTab} />
        <SeriesNotifier />
        <ComfyConsolePip />
        {/* Desktop Sidebar */}
        <div className="hidden md:block h-full">
          <Sidebar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            chats={chats.filter(c => !c.archived)}
            archivedChats={chats.filter(c => c.archived)}
            activeChatId={activeChatId}
            setActiveChatId={setActiveChatId}
            createNewChat={() => { setActiveChatId(undefined); setActiveTab("chat"); }}
            onUnarchiveChat={unarchiveChat}
            onRenameChat={renameChat}
            onDeleteChat={deleteChat}
            onPinChat={pinChat}
            voiceEnabled={settings.voiceEnabled}
          />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative">
          {settings.showStatusBar && <SystemBar lead={<ThemeQuick settings={settings} set={patch => setSettings({ ...settings, ...patch })} tab={activeTab} />} />}
          {!serverUp && (
            <div className="mx-2 mb-2 px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-bold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              Can't reach the Cursed_Ai server - it may have stopped. Start it with Cursed_Ai.bat; this banner clears by itself when it's back.
            </div>
          )}
          <MobileHeader activeTab={activeTab} setActiveTab={setActiveTab} voiceEnabled={settings.voiceEnabled} />

          <main data-theme={moduleTheme} data-override={moduleTheme !== globalTheme ? "" : undefined} className="flex-1 overflow-hidden h-full">
            {activeTab === "chat" && (
              <ChatWindow
                chat={activeChat}
                onOpenStudio={(req) => { setActiveTab(req.kind); requestStudio(req); }}
                onNavigate={setActiveTab}
                onUpdateChat={updateChat}
                onArchiveChat={archiveChat}
                onCreateChat={createNewChat}
                models={models}
                selectedModel={selectedModel}
                onSelectModel={setSelectedModelId}
                settings={settings}
                onSetVoiceEngine={setVoiceEngine}
              />
            )}
            {activeTab === "models" && (
              <ModelManager 
                models={models} 
                selectedModelId={selectedModelId}
                onSelectModel={setSelectedModelId}
                onDownloadModel={handleDownloadModel}
                onDeleteModel={handleDeleteModel}
                onRefresh={refreshModels}
                onCancelDownload={handleCancelDownload}
              />
            )}
            {activeTab === "memory" && <MemoryView />}
            {activeTab === "engine" && <EngineView />}
            {activeTab === "console" && <ConsoleView />}
            {/* Kept mounted (just hidden) so a running image/video job keeps going and can announce itself when you are on another page. */}
            <div className={activeTab === "image" ? "contents" : "hidden"}><ImageGeneratorView modelId={selectedModelId} /></div>
            <div className={activeTab === "video" ? "contents" : "hidden"}><VideoGeneratorView modelId={selectedModelId} /></div>
            {/* Kept mounted so a running Claude Code task keeps streaming while you look at another page. */}
            <div className={activeTab === "ollamaclaude" ? "contents" : "hidden"}><OllamaClaudeView settings={settings} /></div>
            <div className={activeTab === "trainlora" ? "contents" : "hidden"}><TrainLoraView /></div>
            <div className={activeTab === "finetune" ? "contents" : "hidden"}><FineTuneView /></div>
            <div className={activeTab === "trainspeech" ? "contents" : "hidden"}><SpeechTrainView /></div>
            <div className={activeTab === "series" ? "contents" : "hidden"}><SeriesStudioView modelId={selectedModelId} models={models} look={moduleTheme === "classic" ? undefined : themeById(moduleTheme).mode} /></div>
            {activeTab === "settings" && (
              <SettingsView
                settings={settings}
                setSettings={setSettings}
                chats={chats}
                onImportChats={(incoming) => {
                  const have = new Set(chats.map(c => c.id));
                  const fresh = incoming.filter(c => !have.has(c.id));
                  setChats(prev => [...fresh, ...prev]);
                  return fresh.length;
                }}
                onClearChats={() => { setChats([]); setActiveChatId(undefined); }}
                onResetSettings={() => { setSettings(defaultSettings()); }}
              />
            )}
            {activeTab === "vision" && (
              <VisionView
                models={models}
                selectedModelId={selectedModelId}
                onOpenModels={() => setActiveTab("models")}
                onContinueInChat={(messages, modelId) => {
                  const now = Date.now();
                  const first = messages.find(m => m.role === "user")?.content || "Image";
                  const chat: Chat = { id: now.toString(), title: ("Image: " + first).slice(0, 48), messages, createdAt: now, updatedAt: now, modelId };
                  setChats(prev => [chat, ...prev]);
                  setSelectedModelId(modelId);
                  setActiveChatId(chat.id);
                  setActiveTab("chat");
                }}
              />
            )}
          </main>
          {settings.voiceEnabled && (
            <VoiceAssistant 
              selectedModel={selectedModel}
              settings={settings}
              onSetVoiceEngine={setVoiceEngine}
              onOpenStudio={(req) => { setActiveTab(req.kind); requestStudio(req); }}
              onNewMessage={(msg) => {
                if (activeChat) {
                  updateChat({
                    ...activeChat,
                    messages: [...activeChat.messages, msg],
                    updatedAt: Date.now()
                  });
                } else {
                  // Create a new chat if none is active
                  const newChat: Chat = {
                    id: Date.now().toString(),
                    title: "Cursed_Pirate conversation",
                    messages: [msg],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    modelId: selectedModelId,
                  };
                  setChats(prev => [newChat, ...prev]);
                  setActiveChatId(newChat.id);
                }
              }}
            />
          )}

        </div>
      </div>
    </TooltipProvider>
  );
}

