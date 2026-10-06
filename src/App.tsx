/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
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

export default function App() {
  const [activeTab, setActiveTab] = useState("chat");
  const [chats, setChats] = useState<Chat[]>(() => {
    try { return JSON.parse((localStorage.getItem("cursed.chats") ?? localStorage.getItem("sunayna.chats") ?? "[]")).filter((c: Chat) => c.messages?.length); } catch { return []; }
  });
  // Every launch starts on a fresh chat (the welcome screen); past chats are opened from History.
  const [activeChatId, setActiveChatId] = useState<string | undefined>(undefined);
  // Chat history survives reloads (browser storage).
  useEffect(() => {
    try { localStorage.setItem("cursed.chats", JSON.stringify(chats)); } catch { /* storage full/blocked */ }
  }, [chats]);
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
  const wasUp = useRef(true);
  useEffect(() => {
    if (wasUp.current && !serverUp) notifyError("Lost connection to the Cursed_Ai server - start it again with start.bat.");
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
        return [...known, ...extraFiles, ...fromServer("ollama", "Ollama"), ...fromServer("lmstudio", "LM Studio")]
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

  const [settings, setSettings] = useState<AppSettings>({
    vulkanEnabled: true,
    theme: "dark",
    apiPort: 3000,
    apiEnabled: false,
    memoryEnabled: true,
    voiceEnabled: true,
    voiceEngine: ((): "auto" | "browser" | "whisper" => { try { const v = localStorage.getItem("cursed.voiceEngine"); return v === "browser" || v === "whisper" ? v : "auto"; } catch { return "auto"; } })(),
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1024,
    threads: 4,
    kvCacheSize: 4096,
  });

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
      <div className="flex h-screen bg-[#050505] text-[#e5e5e5] overflow-hidden font-sans selection:bg-violet-500/30 selection:text-violet-400 p-4 gap-4">
        <div className="atmosphere"></div>
        <ToastHost activeTab={activeTab} onNavigate={setActiveTab} />
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
            voiceEnabled={settings.voiceEnabled}
          />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative">
          <SystemBar />
          {!serverUp && (
            <div className="mx-2 mb-2 px-4 py-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 text-xs font-bold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              Can't reach the Cursed_Ai server - it may have stopped. Start it with start.bat; this banner clears by itself when it's back.
            </div>
          )}
          <MobileHeader activeTab={activeTab} setActiveTab={setActiveTab} voiceEnabled={settings.voiceEnabled} />

          <main className="flex-1 overflow-hidden h-full">
            {activeTab === "chat" && (
              <ChatWindow
                chat={activeChat}
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
            <div className={activeTab === "image" ? "contents" : "hidden"}><ImageGeneratorView /></div>
            <div className={activeTab === "video" ? "contents" : "hidden"}><VideoGeneratorView /></div>
            {activeTab === "settings" && (
              <SettingsView 
                settings={settings} 
                setSettings={setSettings} 
              />
            )}
            {activeTab === "vision" && (
              <VisionView models={models} selectedModelId={selectedModelId} onOpenModels={() => setActiveTab("models")} />
            )}
          </main>
          {settings.voiceEnabled && (
            <VoiceAssistant 
              selectedModel={selectedModel}
              settings={settings}
              onSetVoiceEngine={setVoiceEngine}
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

