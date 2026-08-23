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
    isDownloaded: true,
    parameters: "3.8B",
    type: "General",
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
  },
  {
    id: "moondream",
    name: "Moondream 2",
    description: "Vision-capable model. Can describe images and answer visual questions locally.",
    size: "1.6 GB",
    format: "GGUF",
    isDownloaded: false,
    parameters: "1.6B",
    type: "Vision",
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
      if (data && data.available) {
        setModels(prev => prev.map(m => ({
          ...m,
          // If the model filename (e.g. phi.gguf) is in available list, mark it as downloaded
          // We check both id and a possible filename match
          isDownloaded: data.available.some((f: string) => 
            f.toLowerCase() === m.id.toLowerCase() || 
            f.toLowerCase() === `${m.id}.gguf`.toLowerCase() ||
            f.toLowerCase().includes(m.name.toLowerCase().replace(" ", "-"))
          )
        })));
      }
    }
    syncModels();
  }, []);

  const [settings, setSettings] = useState<AppSettings>({
    vulkanEnabled: true,
    theme: "dark",
    apiPort: 11434,
    apiEnabled: false,
    memoryEnabled: true,
    voiceEnabled: false,
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1024,
  });

  const selectedModel = models.find(m => m.id === selectedModelId) || models[0];
  const activeChat = chats.find(c => c.id === activeChatId) || null;

  const createNewChat = () => {
    const newChat: Chat = {
      id: Date.now().toString(),
      title: "New Interaction",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelId: selectedModelId,
    };
    setChats([newChat, ...chats]);
    setActiveChatId(newChat.id);
    setActiveTab("chat");
  };

  const updateChat = (updatedChat: Chat) => {
    setChats(chats.map(c => c.id === updatedChat.id ? updatedChat : c));
  };

  const handleDownloadModel = (id: string) => {
    setModels(prev => prev.map(m => {
      if (m.id === id) {
        return { ...m, downloadProgress: 0 };
      }
      return m;
    }));

    // Simulate download
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 10) + 2;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setModels(prev => prev.map(m => {
          if (m.id === id) {
            return { ...m, isDownloaded: true, downloadProgress: undefined };
          }
          return m;
        }));
      } else {
        setModels(prev => prev.map(m => {
          if (m.id === id) {
            return { ...m, downloadProgress: progress };
          }
          return m;
        }));
      }
    }, 300);
  };

  const handleDeleteModel = (id: string) => {
    setModels(prev => prev.map(m => {
      if (m.id === id) {
        return { ...m, isDownloaded: false };
      }
      return m;
    }));
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
            chats={chats}
            activeChatId={activeChatId}
            setActiveChatId={setActiveChatId}
            createNewChat={createNewChat}
          />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full relative">
          <MobileHeader activeTab={activeTab} setActiveTab={setActiveTab} />
          
          <main className="flex-1 overflow-hidden h-full">
            {activeTab === "chat" && (
              <ChatWindow 
                chat={activeChat} 
                onUpdateChat={updateChat} 
                selectedModel={selectedModel}
                settings={settings}
              />
            )}
            {activeTab === "voice" && (
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
                    setChats([newChat, ...chats]);
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

