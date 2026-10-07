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
  FileText,
  Pencil,
  Download,
  MessageSquareText
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { motion, AnimatePresence } from "motion/react";
import { Chat, Message, MessageRole, AIModel, AppSettings } from "@/src/types";
import { pickFile, Picked } from "../../services/attachments";
import { AIService } from "@/src/services/aiService";
import { LocalVoiceRecorder } from "@/src/services/localVoice";
import { resolveEngine, speechInputAvailable, isOnline, micBlockedReason, speechErrorText } from "../../services/voiceEngine";
import { MicModeButton } from "../voice/MicModeButton";
import { cn } from "@/lib/utils";
import { notify, notifyError, notifyWarning } from "../../lib/notify";
import { ProgressBar } from "../layout/ProgressBar";
import { fitFor, useSystemInfo } from "../../lib/ramFit";
import { useGpuInfo, gpuLabel } from "../../lib/gpuInfo";

interface ChatWindowProps {
  chat: Chat | null;
  onUpdateChat: (chat: Chat) => void;
  onArchiveChat: (id: string) => void;
  onCreateChat: () => Chat;
  models: AIModel[];
  selectedModel: AIModel;
  onSelectModel: (id: string) => void;
  settings: AppSettings;
  onSetVoiceEngine?: (pref: "auto" | "browser" | "whisper") => void;
}

/** Markdown code block with a copy button. */
function CodeBlock({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group/code">
      <pre ref={ref}>{children}</pre>
      <button
        onClick={() => { navigator.clipboard.writeText(ref.current?.innerText || ""); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/60 text-[10px] font-bold text-zinc-300 hover:text-white opacity-0 group-hover/code:opacity-100 transition-opacity"
      >{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}

export function ChatWindow({ chat, onUpdateChat, onArchiveChat, onCreateChat, models, selectedModel, onSelectModel, settings, onSetVoiceEngine }: ChatWindowProps) {
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
    if (notes.length) { setAttachMsg(notes.join(" ")); notes.forEach(n => (/only the first/.test(n) ? notifyWarning(n) : notifyError(n))); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const canSend = (!!input.trim() || pending.length > 0) && !reading;
  const gpu = useGpuInfo();
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
  // Dictation works in every browser and offline: the browser's recognizer when it exists and is online,
  // otherwise the local Whisper model (which listens until you stop talking).
  const [browserSpeechFailed, setBrowserSpeechFailed] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  useEffect(() => {                       // internet is back: use the online recognizer again
    const back = () => setBrowserSpeechFailed(false);
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);
  const engine = resolveEngine(settings.voiceEngine, browserSpeechFailed);
  const dictationSupported = speechInputAvailable();

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

  const startWhisperDictation = async () => {
    const recorder = new LocalVoiceRecorder();
    localRecorderRef.current = recorder;
    setIsDictating(true);
    setAttachMsg(null);
    const base = input;                       // live captions replace only what is dictated
    try {
      const text = await recorder.listenOnce({
        onLevel: setMicLevel,
        onPartial: (t) => setInput((base ? base + " " : "") + t),
        onEnd: () => { setIsDictating(false); setIsTranscribing(true); setMicLevel(0); },
      });
      if (text) setInput((base ? base + " " : "") + text);
    } catch (e: any) {
      const blocked = /permission|denied|notallowed/i.test(String(e?.name) + String(e?.message));
      const msg = blocked ? "Microphone blocked - allow it for this site (lock icon in the address bar)." : `Voice input failed: ${e?.message || e}`;
      setAttachMsg(msg);
      notifyError(msg);
    } finally {
      setIsDictating(false);
      setIsTranscribing(false);
      localRecorderRef.current = null;
    }
  };

  const toggleDictation = async () => {
    if (isTranscribing) return;
    const blocked = micBlockedReason();
    if (blocked || !dictationSupported) { notifyError(blocked || "No microphone is available in this browser."); return; }
    if (isOnline() && !isDictating) setBrowserSpeechFailed(false);

    // Decide at click time (not from the last render): the internet or the browser may have changed since.
    const engineNow = resolveEngine(settings.voiceEngine, browserSpeechFailed);
    if (isDictating) {            // second click = stop now
      if (engineNow === "whisper") localRecorderRef.current?.finish();
      else { dictationRef.current?.stop(); setIsDictating(false); }
      return;
    }
    if (engineNow === "whisper") return startWhisperDictation();

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results).map((r: any) => r[0].transcript).join("");
      setInput(transcript);
    };
    recognition.onend = () => setIsDictating(false);
    recognition.onerror = (e: any) => {
      setIsDictating(false);
      const code = e?.error || "unknown";
      if (code === "aborted") return;
      // No internet (or the browser's speech service is down): switch to the offline model and carry on.
      if (code === "network" || code === "service-not-allowed") { notifyWarning(speechErrorText("network")); setBrowserSpeechFailed(true); startWhisperDictation(); return; }
      notifyError(speechErrorText(code));
    };
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

  // Esc stops a reply that is being generated.
  useEffect(() => {
    if (!isGenerating) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleStopGeneration(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
    const baseChat: Chat = {
      ...activeChat,
      messages: [...activeChat.messages, userMessage],
      title: activeChat.messages.length === 0 ? ((input || pending[0]?.attachment.name || "Attachment").slice(0, 30) + (input.length > 30 ? "..." : "")) : activeChat.title,
    };
    setInput("");
    setPending([]);
    setAttachMsg(null);
    await generateReply(baseChat);
  };

  // Streams a model reply for a chat whose last message is the user's. Used by send and by Regenerate.
  const generateReply = async (baseChat: Chat) => {
    const assistantMessagePlaceholder: Message = {
      id: Date.now().toString() + "r",
      role: MessageRole.ASSISTANT,
      content: "",
      timestamp: Date.now() + 1,
    };
    const updatedChat: Chat = { ...baseChat, messages: [...baseChat.messages, assistantMessagePlaceholder] };

    onUpdateChat(updatedChat);
    setIsGenerating(true);
    setLiveTps(null);
    setGenTokens(0);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const generationStart = performance.now();
    let tokenCount = 0;
    let finalContent = "";

    try {
      const toModel: Message[] = baseChat.systemPrompt?.trim()
        ? [{ id: "sys", role: MessageRole.SYSTEM, content: baseChat.systemPrompt.trim(), timestamp: 0 }, ...baseChat.messages]
        : baseChat.messages;
      await AIService.generate(
        toModel,
        selectedModel.id,
        {
          onToken: (token) => {
            finalContent += token;
            tokenCount++;
            setGenTokens(tokenCount);
            const elapsedSec = (performance.now() - generationStart) / 1000;
            if (elapsedSec > 0) setLiveTps(tokenCount / elapsedSec);
            const currentMessages = [...updatedChat.messages];
            currentMessages[currentMessages.length - 1] = { ...assistantMessagePlaceholder, content: finalContent };
            onUpdateChat({ ...updatedChat, messages: currentMessages });
          },
          onError: (error) => {
            console.error("Failed to generate response:", error);
            notifyError(error?.message || String(error), "chat");
            // Show the failure in the reply bubble instead of leaving it blank.
            const msgs = [...updatedChat.messages];
            msgs[msgs.length - 1] = { ...assistantMessagePlaceholder, content: finalContent || `⚠️ ${error?.message || error}` };
            onUpdateChat({ ...updatedChat, messages: msgs });
            setIsGenerating(false);
          },
          onComplete: () => { setIsGenerating(false); }
        },
        {
          signal: controller.signal,
          temperature: settings.temperature,
          topP: settings.topP,
          maxTokens: settings.maxTokens,
          memoryEnabled: settings.memoryEnabled
        }
      );
      if (!controller.signal.aborted && finalContent) notify({ message: "Your chat reply is ready", tab: "chat", onlyIfAway: true });
      // Stopped before any text arrived: leave a note instead of an empty bubble.
      if (controller.signal.aborted && !finalContent) {
        const msgs = [...updatedChat.messages];
        msgs[msgs.length - 1] = { ...assistantMessagePlaceholder, content: "Stopped before the model replied." };
        onUpdateChat({ ...updatedChat, messages: msgs });
      }
    } catch (error) {
      console.error("Failed to generate response:", error);
      setIsGenerating(false);
    } finally {
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      setIsGenerating(false);
    }
  };

  // Re-run the last user message for a fresh answer.
  const regenerate = () => {
    if (!chat || isGenerating) return;
    const lastUser = [...chat.messages].map((m, i) => ({ m, i })).reverse().find(x => x.m.role === MessageRole.USER);
    if (!lastUser) return;
    generateReply({ ...chat, messages: chat.messages.slice(0, lastUser.i + 1) });
  };

  // Put a sent message back in the box to change and resend; replies after it are dropped.
  const editMessage = (idx: number) => {
    if (!chat || isGenerating) return;
    const m = chat.messages[idx];
    if (idx < chat.messages.length - 2 && !window.confirm("Edit this message? The replies after it will be removed.")) return;
    setInput(m.content);
    onUpdateChat({ ...chat, messages: chat.messages.slice(0, idx) });
  };

  const exportMarkdown = () => {
    if (!chat) return;
    const md = [`# ${chat.title}`, chat.systemPrompt ? `> System prompt: ${chat.systemPrompt}\n` : "",
      ...chat.messages.map(m => `**${m.role === MessageRole.USER ? "You" : "Assistant"}:**\n\n${m.content}\n`)].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = `${chat.title.replace(/[^\w -]+/g, "").trim() || "chat"}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const [genTokens, setGenTokens] = useState(0);
  // Warn once per model when it is a poor fit for this PC's memory.
  const sys = useSystemInfo();
  const warnedModel = useRef<string | null>(null);
  useEffect(() => {
    const fit = fitFor(selectedModel.sizeBytes, sys);
    if (fit && fit.level !== "ok" && warnedModel.current !== selectedModel.id) {
      warnedModel.current = selectedModel.id;
      notifyWarning(`${selectedModel.name}: ${fit.label}. ${fit.detail}`);
    }
  }, [selectedModel.id, sys]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");

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
          <MicModeButton
            pref={settings.voiceEngine}
            onSelect={(p) => { onSetVoiceEngine?.(p); notify({ message: p === "browser" ? "Microphone: online browser speech" : p === "whisper" ? "Microphone: offline (Whisper)" : "Microphone: automatic" }); }}
            onClick={toggleDictation}
            active={isDictating}
            busy={isTranscribing}
            disabled={isTranscribing}
            ringPx={engine === "whisper" ? micLevel * 10 : 0}
            title={isDictating ? "Stop dictation" : isTranscribing ? "Transcribing locally..." : engine === "browser" ? "Dictate (online browser speech)" : "Dictate (offline)"}
          />
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
      {isGenerating ? (
        <button
          onClick={handleStopGeneration}
          title="Stop generating (Esc)"
          className="w-12 h-12 rounded-xl mb-1 mr-1 flex items-center justify-center bg-red-600 text-white hover:bg-red-500 shadow-lg shadow-red-900/40 transition-all"
        >
          <Square size={18} className="fill-current" />
        </button>
      ) : (
        <button
          onClick={onSend}
          disabled={!canSend}
          className={cn(
            "w-12 h-12 rounded-xl transition-all mb-1 mr-1 flex items-center justify-center",
            canSend
             ? "bg-violet-600 text-white hover:bg-violet-500 shadow-lg shadow-violet-900/40"
             : "bg-white/5 text-zinc-600 cursor-not-allowed"
          )}
        >
          <Send size={20} />
        </button>
      )}
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
            <div className="vulkan-tag" title={gpu?.devices?.join(", ")}>{gpuLabel(gpu)}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
           <div className="flex items-center gap-2">
             <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_10px_#10b981]"></div>
             <span className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-mono">Engine Online</span>
           </div>
           <div className="h-6 w-[1px] bg-white/5 mx-2"></div>
           <button onClick={regenerate} disabled={isGenerating} title="Regenerate the last reply" className="text-zinc-500 hover:text-white p-2 transition-colors disabled:opacity-30"><RotateCcw size={18} /></button>
           <div className="relative">
             <button onClick={() => setMenuOpen(v => !v)} title="Chat options" className="text-zinc-500 hover:text-white p-2 transition-colors"><MoreVertical size={18} /></button>
             {menuOpen && (
               <>
                 <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                 <div className="absolute right-0 top-full mt-2 w-56 bg-zinc-950 border border-white/15 rounded-2xl shadow-2xl shadow-black/60 z-50 overflow-hidden py-1">
                   {[
                     { icon: <MessageSquareText size={15} />, label: chat.systemPrompt ? "Edit system prompt" : "Set system prompt", act: () => { setPromptDraft(chat.systemPrompt || ""); setPromptOpen(true); } },
                     { icon: <Download size={15} />, label: "Export as Markdown", act: exportMarkdown },
                     { icon: <Trash2 size={15} />, label: "Clear chat", act: handleClearChat },
                     { icon: <Archive size={15} />, label: "Archive chat", act: handleArchive },
                   ].map(it => (
                     <button key={it.label} onClick={() => { setMenuOpen(false); it.act(); }} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-zinc-200 hover:bg-white/5 text-left">{it.icon}{it.label}</button>
                   ))}
                 </div>
               </>
             )}
           </div>
        </div>
      </div>

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="bg-zinc-950 border-white/10 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">System prompt</DialogTitle>
            <DialogDescription>Instructions the model follows throughout this chat - a persona, tone or rules. Applies to every reply from now on.</DialogDescription>
          </DialogHeader>
          <textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            rows={6}
            placeholder="e.g. You are a concise assistant. Answer in at most three sentences."
            className="w-full rounded-xl bg-zinc-900 border border-white/10 text-zinc-100 text-sm p-3 resize-none focus:outline-none focus:border-violet-500/50"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPromptOpen(false)}>Cancel</Button>
            <Button className="bg-violet-600 hover:bg-violet-500 text-white" onClick={() => { onUpdateChat({ ...chat, systemPrompt: promptDraft.trim() || undefined }); setPromptOpen(false); }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-8 py-8" ref={scrollRef}>
        <div className="max-w-4xl mx-auto flex flex-col pb-12">
          {chat.messages.map((m, idx) => (
            <motion.div 
              key={m.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "chat-bubble group/msg",
                m.role === MessageRole.USER ? "user-bubble" : "ai-bubble"
              )}
            >
              {m.role === MessageRole.ASSISTANT ? (
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>
                    {m.content || (isGenerating && idx === chat.messages.length - 1 ? "▋" : "")}
                  </ReactMarkdown>
                  {m.content && !(isGenerating && idx === chat.messages.length - 1) && (
                    <div className="mt-3 flex items-center gap-1">
                      <button
                        onClick={() => toggleSpeak(m.id, m.content)}
                        title={speakingId === m.id ? "Stop reading" : "Read aloud"}
                        className={cn("p-1.5 rounded-lg transition-colors", speakingId === m.id ? "bg-emerald-500/20 text-emerald-400" : "text-zinc-500 hover:text-white hover:bg-white/10")}
                      >
                        {speakingId === m.id ? <Square size={14} className="fill-current" /> : <Volume2 size={14} />}
                      </button>
                      <button onClick={() => copyToClipboard(m.id, m.content)} title="Copy reply" className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-colors">
                        {copiedId === m.id ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                      {idx === chat.messages.length - 1 && (
                        <button onClick={regenerate} title="Regenerate this reply" className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"><RotateCcw size={14} /></button>
                      )}
                    </div>
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
                  {!isGenerating && (
                    <div className="mt-2 flex justify-end gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                      <button onClick={() => copyToClipboard(m.id, m.content)} title="Copy message" className="p-1 rounded-md text-white/60 hover:text-white hover:bg-white/10">
                        {copiedId === m.id ? <Check size={13} /> : <Copy size={13} />}
                      </button>
                      <button onClick={() => editMessage(idx)} title="Edit and resend" className="p-1 rounded-md text-white/60 hover:text-white hover:bg-white/10"><Pencil size={13} /></button>
                    </div>
                  )}
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
          
          {isGenerating && (
            <div className="mb-2">
              <ProgressBar
                value={genTokens > 0 ? (genTokens / Math.max(1, settings.maxTokens)) * 100 : null}
                label={genTokens > 0 ? `Writing reply - ${genTokens} of up to ${settings.maxTokens} tokens` : "Loading model / thinking..."}
              />
            </div>
          )}
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
