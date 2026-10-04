import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  RotateCcw,
  Square,
  Copy,
  Check,
  MoreVertical,
  Trash2,
  Volume2,
  Cpu,
  Zap,
  User,
  Bot,
  Lock,
  Mic,
  MicOff,
  Archive,
  ChevronDown,
  CheckCircle2,
  Loader2,
  Paperclip,
  X,
  FileText
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { motion, AnimatePresence } from "motion/react";
import { Chat, Message, MessageRole, AIModel, AppSettings } from "@/src/types";
import { pickFile, Picked } from "../../services/attachments";
import { AIService } from "@/src/services/aiService";
import { LocalVoiceRecorder } from "@/src/services/localVoice";
import { cn } from "@/lib/utils";

interface ChatWindowProps {
  chat: Chat | null;
  onUpdateChat: (chat: Chat) => void;
  onArchiveChat: (id: string) => void;
  onCreateChat: () => Chat;
  models: AIModel[];
  selectedModel: AIModel;
  onSelectModel: (id: string) => void;
  settings: AppSettings;
}

export function ChatWindow({ chat, onUpdateChat, onArchiveChat, onCreateChat, models, selectedModel, onSelectModel, settings }: ChatWindowProps) {
  const [input, setInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isDictating, setIsDictating] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [liveTps, setLiveTps] = useState<number | null>(null);
  const [showModelPicker, setShowModelPicker] = useState(false);
  // Files attached to the message being written
  const [pending, setPending] = useState<Picked[]>([]);
  const [attachMsg, setAttachMsg] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onFilesChosen = async (files: FileList | null) => {
    if (!files?.length) return;
    setReading(true);
    setAttachMsg(null);
    const notes: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const p = await pickFile(file);
        if (p.note) notes.push(p.note);
        setPending(prev => [...prev, p]);
      } catch (e: any) {
        notes.push(e.message);
      }
    }
    setReading(false);
    if (notes.length) setAttachMsg(notes.join(" "));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const canSend = (!!input.trim() || pending.length > 0) && !reading;
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const toggleSpeak = (id: string, text: string) => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const wasThis = speakingId === id;
    synth.cancel();
    if (wasThis) return setSpeakingId(null);
    const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>]/g, ""));
    u.onend = u.onerror = () => setSpeakingId(cur => (cur === id ? null : cur));
    setSpeakingId(id);
    synth.speak(u);
  };
  useEffect(() => () => { window.speechSynthesis?.cancel(); }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const dictationRef = useRef<any>(null);
  const localRecorderRef = useRef<LocalVoiceRecorder | null>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const speechSupported = typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const whisperSupported = LocalVoiceRecorder.isSupported;
  const dictationSupported = settings.voiceEngine === "whisper" ? whisperSupported : speechSupported;

  useEffect(() => {
    if (!showModelPicker) return;
    const onClickOutside = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showModelPicker]);

  const toggleDictation = async () => {
    if (!dictationSupported) return;

    if (settings.voiceEngine === "whisper") {
      if (isDictating) {
        setIsDictating(false);
        setIsTranscribing(true);
        try {
          const text = await localRecorderRef.current?.stopAndTranscribe();
          if (text) setInput(text);
        } catch (e) {
          console.error("Local transcription failed:", e);
        } finally {
          setIsTranscribing(false);
        }
        return;
      }
      localRecorderRef.current = new LocalVoiceRecorder();
      try {
        await localRecorderRef.current.start();
        setIsDictating(true);
      } catch (e) {
        console.error("Failed to start recording:", e);
      }
      return;
    }

    if (isDictating) {
      dictationRef.current?.stop();
      setIsDictating(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join("");
      setInput(transcript);
    };
    recognition.onend = () => setIsDictating(false);
    recognition.onerror = () => setIsDictating(false);
    dictationRef.current = recognition;
    setIsDictating(true);
    recognition.start();
  };

  const handleClearChat = () => {
    if (!chat) return;
    if (!window.confirm("Clear all messages in this chat? This can't be undone.")) return;
    onUpdateChat({ ...chat, messages: [] });
  };

  const handleArchive = () => {
    if (!chat) return;
    onArchiveChat(chat.id);
  };

  // Sending from the empty-state screen: no chat exists yet, so create one
  // first, then send into it directly (see the targetChat param above).
  const handleWelcomeSend = () => {
    if (!canSend || isGenerating) return;
    handleSendMessage(onCreateChat());
  };

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat?.messages, isGenerating]);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
    }
  };

  // Pass targetChat explicitly when sending from the empty-state screen,
  // where a chat was just created this same tick and hasn't reached the
  // `chat` prop yet (App.tsx's setState is async).
  const handleSendMessage = async (targetChat?: Chat) => {
    const activeChat = targetChat ?? chat;
    if (!canSend || isGenerating || !activeChat) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: MessageRole.USER,
      content: input,
      images: pending.filter(p => p.image).map(p => p.image!),
      attachments: pending.map(p => p.attachment),
      timestamp: Date.now(),
    };

    const assistantMessagePlaceholder: Message = {
      id: (Date.now() + 1).toString(),
      role: MessageRole.ASSISTANT,
      content: "",
      timestamp: Date.now() + 1,
    };

    const updatedMessages = [...activeChat.messages, userMessage, assistantMessagePlaceholder];
    const updatedChat = {
      ...activeChat,
      messages: updatedMessages,
      title: activeChat.messages.length === 0 ? ((input || pending[0]?.attachment.name || "Attachment").slice(0, 30) + (input.length > 30 ? "..." : "")) : activeChat.title
    };

    onUpdateChat(updatedChat);
    setInput("");
    setPending([]);
    setAttachMsg(null);
    setIsGenerating(true);
    setLiveTps(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const generationStart = performance.now();
    let tokenCount = 0;

    try {
      let finalContent = "";
      await AIService.generate(
        [...activeChat.messages, userMessage],
        selectedModel.id,
        {
          onToken: (token) => {
            finalContent += token;
            tokenCount++;
            const elapsedSec = (performance.now() - generationStart) / 1000;
            if (elapsedSec > 0) setLiveTps(tokenCount / elapsedSec);
            const currentMessages = [...updatedChat.messages];
            currentMessages[currentMessages.length - 1] = {
              ...assistantMessagePlaceholder,
              content: finalContent
            };
            onUpdateChat({ ...updatedChat, messages: currentMessages });
          },
          onError: (error) => {
            console.error("Failed to generate response:", error);
            // Show the failure in the reply bubble instead of leaving it blank.
            const msgs = [...updatedChat.messages];
            msgs[msgs.length - 1] = {
              ...assistantMessagePlaceholder,
              content: finalContent || `⚠️ ${error?.message || error}`,
            };
            onUpdateChat({ ...updatedChat, messages: msgs });
            setIsGenerating(false);
          },
          onComplete: () => {
            setIsGenerating(false);
          }
        },
        {
          signal: controller.signal,
          temperature: settings.temperature,
          topP: settings.topP,
          maxTokens: settings.maxTokens,
          memoryEnabled: settings.memoryEnabled
        }
      );
    } catch (error) {
      console.error("Failed to generate response:", error);
      setIsGenerating(false);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsGenerating(false);
    }
  };

  const copyToClipboard = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const modelPicker = (
    <div className="relative" ref={modelPickerRef}>
      <button
        onClick={() => setShowModelPicker(v => !v)}
        title="Select model"
        className="h-10 px-3 rounded-xl hover:bg-white/5 text-zinc-400 hover:text-white transition-colors flex items-center gap-2 border border-white/5"
      >
        <Cpu size={16} className="text-violet-400" />
        <span className="text-xs font-bold max-w-[100px] truncate">{selectedModel.name}</span>
        <ChevronDown size={14} className={cn("transition-transform", showModelPicker && "rotate-180")} />
      </button>
      <AnimatePresence>
        {showModelPicker && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            className="absolute bottom-full mb-2 left-0 w-72 max-h-80 overflow-y-auto bg-zinc-950 border border-white/15 rounded-2xl shadow-2xl shadow-black/60 z-50"
          >
            {models.map((m) => (
              <button
                key={m.id}
                disabled={!m.isDownloaded}
                onClick={() => {
                  onSelectModel(m.id);
                  setShowModelPicker(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors",
                  m.isDownloaded ? "hover:bg-white/5 text-zinc-200" : "text-zinc-500 cursor-not-allowed"
                )}
              >
                <div>
                  <p className="text-sm font-bold">{m.name}</p>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest">
                    {m.isDownloaded ? m.type : "Not downloaded"}
                  </p>
                </div>
                {selectedModel.id === m.id && <CheckCircle2 size={16} className="text-violet-400 shrink-0" />}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  const inputBar = (onSend: () => void, placeholder: string) => (
    <div>
    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => onFilesChosen(e.target.files)}
      accept="image/*,.pdf,.docx,.txt,.md,.csv,.json,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.sh,.sql,.yaml,.yml,.log,.ini,.toml" />
    {(pending.length > 0 || reading || attachMsg) && (
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {pending.map((p, i) => (
          <div key={i} className="flex items-center gap-2 bg-violet-500/10 border border-violet-500/20 rounded-xl pl-1.5 pr-2 py-1.5 text-xs text-zinc-200 max-w-[220px]">
            {p.image ? <img src={p.image} className="w-7 h-7 rounded-md object-cover" /> : <FileText size={16} className="text-violet-400 ml-1" />}
            <span className="truncate">{p.attachment.name}</span>
            <button onClick={() => setPending(prev => prev.filter((_, j) => j !== i))} className="text-zinc-500 hover:text-red-400"><X size={14} /></button>
          </div>
        ))}
        {reading && <span className="text-xs text-zinc-500 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Reading file...</span>}
        {attachMsg && <span className="text-xs text-amber-400">{attachMsg}</span>}
      </div>
    )}
    <div className="bg-white/5 border border-white/10 rounded-2xl p-2 flex items-end gap-2 focus-within:border-white/20 transition-all shadow-2xl shadow-black/40">
      <div className="flex gap-1 mb-1 ml-1">
        {modelPicker}
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Attach images, documents, PDFs..."
          className="w-10 h-10 rounded-xl hover:bg-white/5 text-zinc-500 hover:text-white transition-colors flex items-center justify-center"
        ><Paperclip size={18} /></button>
        {dictationSupported && (
          <button
            onClick={toggleDictation}
            disabled={isTranscribing}
            title={isDictating ? "Stop dictation" : isTranscribing ? "Transcribing locally..." : "Dictate message"}
            className={cn(
              "w-10 h-10 rounded-xl transition-colors flex items-center justify-center",
              isDictating ? "bg-red-500/20 text-red-400" : "hover:bg-white/5 text-zinc-500",
              isTranscribing && "opacity-60 cursor-wait"
            )}
          >
            {isTranscribing ? <Loader2 size={18} className="animate-spin" /> : isDictating ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}
      </div>
      <div className="flex-1">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={placeholder}
          rows={1}
          className="w-full bg-transparent border-none focus:ring-0 text-white placeholder:text-white/20 resize-none p-3 py-4 max-h-48 scrollbar-hide text-[15px]"
          style={{ height: 'auto' }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = `${target.scrollHeight}px`;
          }}
        />
      </div>
      <button
        onClick={onSend}
        disabled={!canSend || isGenerating}
        className={cn(
          "w-12 h-12 rounded-xl transition-all mb-1 mr-1 flex items-center justify-center",
          canSend && !isGenerating
           ? "bg-violet-600 text-white hover:bg-violet-500 shadow-lg shadow-violet-900/40"
           : "bg-white/5 text-zinc-600 cursor-not-allowed"
        )}
      >
        <Send size={20} />
      </button>
    </div>
    </div>
  );

  if (!chat) {
    return (
      <div className="flex-1 flex flex-col h-full glass rounded-[2.5rem] overflow-hidden">
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center overflow-y-auto">
          <div className="w-20 h-20 rounded-[2rem] bg-white/5 border border-white/10 flex items-center justify-center mb-8 shadow-2xl shadow-violet-500/10">
            <Bot size={40} className="text-violet-400" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-3 tracking-tight">Cursed local AI Studio</h1>
          <p className="text-zinc-500 max-w-sm mb-10 text-sm leading-relaxed">
            Your private offline laboratory. Messages are processed locally on-device using the <span className="text-violet-400 font-mono">{selectedModel.name}</span> model.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-xl">
            {["Explain quantum computing in simple terms", "Write a secure local API script", "Analyze this system architecture", "Creative writing: Dark academia"].map((prompt) => (
              <button
                key={prompt}
                onClick={() => setInput(prompt)}
                className="p-4 text-xs font-medium text-zinc-400 border border-white/5 rounded-2xl hover:border-white/20 hover:bg-white/5 text-left transition-all group"
              >
                <div className="flex items-center gap-2 mb-1">
                   <div className="w-1.5 h-1.5 rounded-full bg-violet-600 group-hover:bg-violet-400"></div>
                   <span className="text-[10px] text-zinc-600 uppercase tracking-widest">Example Prompt</span>
                </div>
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Input bar pinned to the bottom of the main page, same as an active chat */}
        <div className="p-6 bg-transparent border-t border-white/5 shrink-0">
          <div className="max-w-4xl mx-auto">
            {inputBar(handleWelcomeSend, `Command ${selectedModel.name} via local core...`)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full glass rounded-[2.5rem] overflow-hidden relative">
      {/* Chat header */}
      <div className="h-20 border-b border-white/5 px-8 flex items-center justify-between bg-transparent backdrop-blur-md z-10">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="model-tag">{selectedModel.name} v1</div>
            <div className="vulkan-tag">Vulkan Enabled</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
           <div className="flex items-center gap-2">
             <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
             <span className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-mono">Engine Online</span>
           </div>
           <div className="h-6 w-[1px] bg-white/5 mx-2"></div>
           <button className="text-zinc-500 hover:text-white p-2 transition-colors"><RotateCcw size={18} /></button>
           <button className="text-zinc-500 hover:text-white p-2 transition-colors"><MoreVertical size={18} /></button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-8" ref={scrollRef}>
        <div className="max-w-4xl mx-auto flex flex-col pb-12">
          {chat.messages.map((m, idx) => (
            <motion.div 
              key={m.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "chat-bubble",
                m.role === MessageRole.USER ? "user-bubble" : "ai-bubble"
              )}
            >
              {m.role === MessageRole.ASSISTANT ? (
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {m.content || (isGenerating && idx === chat.messages.length - 1 ? "▋" : "")}
                  </ReactMarkdown>
                  {m.content && !(isGenerating && idx === chat.messages.length - 1) && (
                    <button
                      onClick={() => toggleSpeak(m.id, m.content)}
                      title={speakingId === m.id ? "Stop reading" : "Read aloud"}
                      className={cn("mt-3 p-1.5 rounded-lg transition-colors", speakingId === m.id ? "bg-emerald-500/20 text-emerald-400" : "text-zinc-500 hover:text-white hover:bg-white/10")}
                    >
                      {speakingId === m.id ? <Square size={14} className="fill-current" /> : <Volume2 size={14} />}
                    </button>
                  )}
                  {isGenerating && idx === chat.messages.length - 1 && (
                    <div className="flex items-center gap-2 mt-4 text-[10px] font-mono opacity-40 uppercase tracking-widest italic group">
                      <span className="pulse-anim">Streaming tokens...</span>
                      {liveTps !== null && <span className="text-emerald-400">{liveTps.toFixed(1)} t/s</span>}
                    </div>
                  )}
                </div>
              ) : (
                <div className="font-medium">
                  {(m.images?.length || m.attachments?.some(a => a.kind === "doc")) && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {m.images?.map((src, k) => <img key={k} src={src} className="max-h-40 rounded-xl border border-white/10" />)}
                      {m.attachments?.filter(a => a.kind === "doc").map((a, k) => (
                        <span key={k} className="flex items-center gap-1.5 bg-black/20 rounded-lg px-2 py-1 text-xs"><FileText size={13} /> {a.name}</span>
                      ))}
                    </div>
                  )}
                  {m.content}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>

      {/* Input area */}
      <div className="p-6 bg-transparent border-t border-white/5">
        <div className="max-w-4xl mx-auto relative">
          <div className="absolute -top-12 left-0 right-0 flex justify-center pointer-events-none">
            <AnimatePresence>
               {isGenerating && (
                   <motion.div 
                     initial={{ opacity: 0, scale: 0.9 }}
                     animate={{ opacity: 1, scale: 1 }}
                     exit={{ opacity: 0, scale: 0.9 }}
                     onClick={handleStopGeneration}
                     className="bg-zinc-900/80 backdrop-blur-xl text-zinc-400 text-[10px] py-1.5 px-4 rounded-full border border-white/5 flex items-center gap-2 pointer-events-auto shadow-2xl cursor-pointer hover:border-violet-500 hover:text-white transition-all group"
                   >
                     <Square size={10} className="fill-violet-500 text-violet-500 group-hover:fill-red-500 group-hover:text-red-500" />
                     Interrupting inference engine
                   </motion.div>
               )}
            </AnimatePresence>
          </div>
          
          {inputBar(() => handleSendMessage(), `Command ${selectedModel.name} via local core...`)}
          <div className="mt-3 flex items-center justify-between px-2">
            <div className="flex items-center gap-4">
              <p className="text-[10px] text-zinc-500 flex items-center gap-1.5 font-bold uppercase tracking-widest">
                <Zap size={10} className="text-emerald-500" />
                Vulkan Accelerator
              </p>
              <p className="text-[10px] text-zinc-500 flex items-center gap-1.5 font-bold uppercase tracking-widest">
                <Lock size={10} className="text-violet-500" />
                100% Offline
              </p>
            </div>
            <div className="flex gap-4">
               <button onClick={handleClearChat} className="text-[10px] text-zinc-600 hover:text-zinc-300 font-bold uppercase tracking-widest">Clear</button>
               <button onClick={handleArchive} className="text-[10px] text-zinc-600 hover:text-zinc-300 font-bold uppercase tracking-widest flex items-center gap-1.5">
                 <Archive size={10} /> Archive
               </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
