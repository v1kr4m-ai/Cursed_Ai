import React from "react";
import { 
  MessageSquare, 
  Database, 
  Settings, 
  BrainCircuit, 
  Mic, 
  Eye, 
  Plus, 
  ChevronLeft,
  ChevronRight,
  Menu,
  Terminal,
  Download,
  Info,
  Cpu,
  ArchiveRestore,
  ImagePlus,
  Clapperboard
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { 
  Sheet, 
  SheetContent, 
  SheetTrigger 
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { motion, AnimatePresence } from "motion/react";
import { Chat } from "../../types";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  chats: Chat[];
  archivedChats?: Chat[];
  activeChatId?: string;
  setActiveChatId: (id: string) => void;
  createNewChat: () => void;
  onUnarchiveChat?: (id: string) => void;
  voiceEnabled?: boolean;
}

export function Sidebar({
  activeTab,
  setActiveTab,
  chats,
  archivedChats = [],
  activeChatId,
  setActiveChatId,
  createNewChat,
  onUnarchiveChat,
  voiceEnabled = true
}: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);

  const navItems = [
    { id: "chat", label: "Chat", icon: MessageSquare },
    { id: "models", label: "Models", icon: Database },
    { id: "memory", label: "Memory", icon: BrainCircuit },
    { id: "engine", label: "Engine", icon: Cpu },
    { id: "image", label: "Image", icon: ImagePlus },
    { id: "video", label: "Video", icon: Clapperboard },
    { id: "vision", label: "Vision", icon: Eye },
    { id: "console", label: "Console", icon: Terminal },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className={`h-full glass rounded-3xl flex flex-col transition-all duration-300 ${isCollapsed ? "w-16" : "w-72"}`}>
      <div className="p-6 flex items-center justify-between">
        {!isCollapsed && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-emerald-500 flex items-center justify-center font-bold text-white shadow-lg">S</div>
            <div>
              <h1 className="font-bold tracking-tight text-xl text-white leading-none">Cursed_Ai</h1>
              <p className="text-[10px] opacity-50 uppercase tracking-widest mt-1">Offline AI Studio</p>
            </div>
          </div>
        )}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="text-zinc-500 hover:text-white hover:bg-white/5"
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </Button>
      </div>

      <div className="px-3 pb-4">
        {!isCollapsed && (
          <Button 
            className="w-full justify-start gap-3 bg-violet-600 hover:bg-violet-500 text-white font-bold h-11 rounded-xl shadow-lg shadow-violet-900/20 px-4"
            onClick={createNewChat}
          >
            <Plus size={18} />
            New Chat
          </Button>
        )}
        {isCollapsed && (
          <Button 
            size="icon"
            className="w-full flex justify-center bg-violet-600 hover:bg-violet-500 text-white h-11 rounded-xl"
            onClick={createNewChat}
          >
            <Plus size={18} />
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3">
        <div className="space-y-1">
          {navItems.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              className={`w-full justify-start gap-3 h-11 rounded-xl transition-all ${
                activeTab === item.id 
                  ? "bg-white/10 text-violet-400 border border-white/5" 
                  : "text-zinc-400 hover:text-white hover:bg-white/5"
              }`}
              onClick={() => setActiveTab(item.id)}
            >
              <item.icon size={18} />
              {!isCollapsed && <span className="font-medium text-sm">{item.label}</span>}
              {!isCollapsed && item.id === "chat" && chats.length > 0 && (
                <Badge variant="outline" className="ml-auto bg-black/40 border-white/5 text-[10px] text-zinc-500">
                  {chats.length}
                </Badge>
              )}
            </Button>
          ))}
        </div>

        {!isCollapsed && activeTab === "chat" && (
          <div className="mt-8">
            <h3 className="px-4 text-[10px] font-bold text-zinc-600 uppercase tracking-[0.2em] mb-3">History</h3>
            <div className="space-y-1 px-1">
              {chats.map((chat) => (
                <Button
                  key={chat.id}
                  variant="ghost"
                  className={`w-full justify-start h-10 text-[13px] truncate p-3 rounded-xl transition-all ${
                    activeChatId === chat.id 
                      ? "bg-violet-900/20 text-violet-400 border-l-2 border-l-violet-500 rounded-l-none" 
                      : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
                  }`}
                  onClick={() => { setActiveChatId(chat.id); }}
                >
                  <MessageSquare size={14} className="mr-3 flex-shrink-0 opacity-50" />
                  <span className="truncate">{chat.title || "Untitled History"}</span>
                </Button>
              ))}
            </div>
          </div>
        )}

        {!isCollapsed && activeTab === "chat" && archivedChats.length > 0 && (
          <div className="mt-6 px-1">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="w-full px-3 text-[10px] font-bold text-zinc-600 hover:text-zinc-400 uppercase tracking-[0.2em] mb-3 text-left"
            >
              {showArchived ? "Hide" : "Show"} Archived ({archivedChats.length})
            </button>
            {showArchived && (
              <div className="space-y-1">
                {archivedChats.map((chat) => (
                  <div
                    key={chat.id}
                    className="w-full flex items-center justify-between h-10 text-[13px] px-3 rounded-xl text-zinc-600 group"
                  >
                    <span className="truncate opacity-60">{chat.title || "Untitled History"}</span>
                    <button
                      title="Unarchive"
                      onClick={() => onUnarchiveChat?.(chat.id)}
                      className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-violet-400 transition-opacity shrink-0 ml-2"
                    >
                      <ArchiveRestore size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-white/5">
        {!isCollapsed ? (
          <div className="flex items-center gap-4 bg-white/5 p-3 rounded-2xl border border-white/5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Terminal size={16} className="text-emerald-400" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-xs font-bold text-zinc-200 truncate">Vulkan Core</p>
              <p className="text-[10px] text-emerald-500/70 font-medium">GPU Acceleration</p>
            </div>
            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981] animate-pulse"></div>
          </div>
        ) : (
          <div className="flex justify-center">
             <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
          </div>
        )}
      </div>
    </div>
  );
}

export function MobileHeader({ setActiveTab, activeTab, voiceEnabled = true }: { setActiveTab: (tab: string) => void, activeTab: string, voiceEnabled?: boolean }) {
  return (
    <div className="h-16 glass rounded-2xl flex items-center px-6 justify-between md:hidden mb-4 border-white/5 shadow-lg">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-emerald-500 flex items-center justify-center font-bold text-white text-sm shadow-lg">S</div>
        <span className="font-bold text-white tracking-tight">Cursed_Ai</span>
      </div>
      
      <Sheet>
        <SheetTrigger render={<Button variant="ghost" size="icon" className="text-zinc-400 hover:text-white hover:bg-white/5" />}>
          <Menu size={24} />
        </SheetTrigger>
        <SheetContent side="left" className="bg-[#050505]/95 backdrop-blur-2xl border-white/5 p-0 w-72">
           <div className="p-8">
             <div className="flex items-center gap-3 mb-10">
               <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-emerald-500 flex items-center justify-center font-bold text-white shadow-lg">S</div>
               <h2 className="text-xl font-bold text-white tracking-tight">Cursed_Ai</h2>
             </div>
             <div className="space-y-2">
               {["chat", "models", "memory", "engine", "image", "video", "vision", "console", "settings"].map((tab) => (
                 <Button 
                   key={tab}
                   variant="ghost"
                   className={`w-full justify-start h-11 rounded-xl text-sm font-medium capitalize transition-all ${
                     activeTab === tab ? "bg-white/10 text-violet-400" : "text-zinc-500 hover:text-white hover:bg-white/5"
                   }`}
                   onClick={() => setActiveTab(tab)}
                 >
                   {tab}
                 </Button>
               ))}
             </div>
             <div className="mt-10 pt-10 border-t border-white/5 text-center">
                <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-[0.2em]">Offline AI Studio</p>
             </div>
           </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
