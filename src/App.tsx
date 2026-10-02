/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { Eye } from "lucide-react";
import { Sidebar, MobileHeader } from "./components/layout/Sidebar";
import { ChatWindow } from "./components/chat/ChatWindow";
import { ModelManager } from "./components/models/ModelManager";
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
    description: "Vision-capable model. Image understanding isn't wired up in this build yet — downloading it won't enable vision chat.",
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
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  const [models, setModels] = useState<AIModel[]>(INITIAL_MODELS);
  const [selectedModelId, setSelectedModelId] = useState("phi-3-mini");
  
  useEffect(() => {
    async function syncModels() {
      const data = await AIService.getModels();
      const ext = await fetch("/api/external-models").then(r => r.json()).catch(() => null);

      setModels(prev => {
        const available: string[] = data?.available || [];
        const norm = (n: string) => n.toLowerCase().replace(" ", "-");
        // Catalog entries: downloaded if a matching file is on disk.
        const known = prev.filter(m => !m.source || m.source === "gguf").map(m => ({
          ...m,
          isDownloaded: available.some((f: string) =>
            f.toLowerCase() === m.id.toLowerCase() ||
            f.toLowerCase() === `${m.id}.gguf`.toLowerCase() ||
            f.toLowerCase().includes(norm(m.name))
          ),
        }));
        // Any other .gguf already in the user's models folder.
        const extraFiles: AIModel[] = available
          .map((f: string) => f.replace(/\.gguf$/i, ""))
          .filter((id: string) => !known.some(m => m.isDownloaded && (id.toLowerCase() === m.id.toLowerCase() || id.toLowerCase().includes(norm(m.name)))))
          .map((id: string): AIModel => ({
            id, name: id, description: "GGUF file from your models folder.", size: "", format: "GGUF",
            isDownloaded: true, parameters: "", type: "General", source: "gguf",
          }));
        const fromServer = (provider: "ollama" | "lmstudio", label: string): AIModel[] =>
          (ext?.[provider]?.models || []).map((name: string): AIModel => ({
            id: `${provider}:${name}`, name, description: `Served by ${label} on this machine.`, size: "",
            format: "GGUF", isDownloaded: true, parameters: label, type: "General", source: provider,
          }));
        return [...known, ...extraFiles, ...fromServer("ollama", "Ollama"), ...fromServer("lmstudio", "LM Studio")];
      });
    }
    syncModels();
  }, []);

  // If the selected model isn't actually available (e.g. the default isn't
  // downloaded) but others are, switch to the first usable one.
  useEffect(() => {
    const cur = models.find(m => m.id === selectedModelId);
    if (cur?.isDownloaded) return;
    const firstUsable = models.find(m => m.isDownloaded);
    if (firstUsable) setSelectedModelId(firstUsable.id);
  }, [models]);

  const [settings, setSettings] = useState<AppSettings>({
    vulkanEnabled: true,
    theme: "dark",
    apiPort: 3000,
    apiEnabled: false,
    memoryEnabled: true,
    voiceEnabled: true,
    voiceEngine: "browser",
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1024,
    threads: 4,
    kvCacheSize: 4096,
  });

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

    try {
      const response = await fetch("/api/models/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, url: model.downloadUrl }),
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

  const handleDeleteModel = async (id: string) => {
    try {
      await fetch(`/api/models/${id}`, { method: "DELETE" });
    } catch (e) {
      console.error(`Failed to delete ${id}:`, e);
      return;
    }
    updateModel(id, { isDownloaded: false });
    if (selectedModelId === id) {
       setSelectedModelId("phi-3-mini");
    }
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-[#050505] text-[#e5e5e5] overflow-hidden font-sans selection:bg-violet-500/30 selection:text-violet-400 p-4 gap-4">
        <div className="atmosphere"></div>
        {/* Desktop Sidebar */}
        <div className="hidden md:block h-full">
          <Sidebar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            chats={chats.filter(c => !c.archived)}
            archivedChats={chats.filter(c => c.archived)}
            activeChatId={activeChatId}
            setActiveChatId={setActiveChatId}
            createNewChat={createNewChat}
            onUnarchiveChat={unarchiveChat}
            voiceEnabled={settings.voiceEnabled}
          />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative">
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
              />
            )}
            {activeTab === "voice" && settings.voiceEnabled && (
              <VoiceAssistant 
                selectedModel={selectedModel}
                settings={settings}
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
                      title: "Voice Conversation",
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
            {activeTab === "models" && (
              <ModelManager 
                models={models} 
                selectedModelId={selectedModelId}
                onSelectModel={setSelectedModelId}
                onDownloadModel={handleDownloadModel}
                onDeleteModel={handleDeleteModel}
              />
            )}
            {activeTab === "memory" && <MemoryView />}
            {activeTab === "engine" && <EngineView />}
            {activeTab === "console" && <ConsoleView />}
            {activeTab === "image" && <ImageGeneratorView />}
            {activeTab === "video" && <VideoGeneratorView />}
            {activeTab === "settings" && (
              <SettingsView 
                settings={settings} 
                setSettings={setSettings} 
              />
            )}
            {activeTab === "vision" && (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-transparent glass rounded-3xl h-full">
                 <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 shadow-xl shadow-violet-500/10">
                    <Eye size={32} className="text-violet-400" />
                 </div>
                 <h1 className="text-xl font-bold text-white tracking-tight">Vision System Offline</h1>
                 <p className="text-zinc-500 mt-2 max-w-xs text-sm">Download Moondream 2 weights to enable image understanding capabilities.</p>
                 <Button 
                   className="mt-6 bg-violet-600 hover:bg-violet-500 text-white font-bold px-6 rounded-xl"
                   onClick={() => setActiveTab("models")}
                 >
                   Explore Models
                 </Button>
              </div>
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

