import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Volume2, Square, Bot, Loader2, User, AlertTriangle, Power } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { AIModel, AppSettings, Message, MessageRole } from "../../types";
import { AIService } from "../../services/aiService";
import { LocalVoiceRecorder } from "../../services/localVoice";

interface VoiceAssistantProps {
  selectedModel: AIModel;
  onNewMessage: (msg: Message) => void;
  settings: AppSettings;
}

type VoiceState = "off" | "listening" | "thinking" | "speaking";

const ERROR_TEXT: Record<string, string> = {
  "not-allowed": "Microphone blocked. Allow mic access for this site (lock icon in the address bar) and try again.",
  "service-not-allowed": "Speech recognition isn't allowed in this browser.",
  "audio-capture": "No microphone found.",
  "network": "Browser speech recognition needs internet (it uses your browser's cloud service). Switch Voice Engine to Local Whisper in Settings to work offline.",
};

/**
 * Live voice conversation. Browser engine: continuous listening with interim
 * results shown as you speak; a finished phrase is sent to the model, the
 * reply streams on screen and is spoken aloud, then it listens again.
 * Local Whisper engine can't stream partial text, so it's tap-to-talk.
 */
export function VoiceAssistant({ selectedModel, onNewMessage, settings }: VoiceAssistantProps) {
  const usingWhisper = settings.voiceEngine === "whisper";

  const [state, setState] = useState<VoiceState>("off");
  const [live, setLive] = useState("");            // what you're saying right now
  const [reply, setReply] = useState("");          // the model's reply, streaming
  const [history, setHistory] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  // Refs mirror state for event handlers bound once (avoids stale closures).
  const stateRef = useRef<VoiceState>("off");
  const activeRef = useRef(false);                 // conversation switched on
  const historyRef = useRef<Message[]>([]);
  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<LocalVoiceRecorder | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const settingsRef = useRef(settings);
  const modelRef = useRef(selectedModel);
  const scrollRef = useRef<HTMLDivElement>(null);
  const runTurnRef = useRef<(t: string) => void>(() => {});
  const onNewMessageRef = useRef(onNewMessage);
  onNewMessageRef.current = onNewMessage;
  settingsRef.current = settings;
  modelRef.current = selectedModel;

  const setVoiceState = (s: VoiceState) => { stateRef.current = s; setState(s); };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [history, live, reply]);

  const speak = useCallback((text: string, done: () => void) => {
    const synth = window.speechSynthesis;
    if (!synth || !text.trim()) return done();
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>]/g, ""));
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
  }, []);

  const startListening = useCallback(() => {
    if (!activeRef.current) return;
    setLive("");
    if (usingWhisper) { setVoiceState("off"); return; } // tap-to-talk, handled in the button
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      setVoiceState("listening");
      rec.start();
    } catch {
      /* already started */
    }
  }, [usingWhisper]);

  // One full turn: send text to the model with history, stream + speak the reply.
  const runTurn = useCallback(async (text: string) => {
    const userMsg: Message = { id: Date.now().toString(), role: MessageRole.USER, content: text, timestamp: Date.now() };
    historyRef.current = [...historyRef.current, userMsg];
    setHistory(historyRef.current);
    onNewMessageRef.current(userMsg);
    setLive("");
    setReply("");
    setVoiceState("thinking");

    const controller = new AbortController();
    abortRef.current = controller;
    let full = "";
    try {
      await AIService.generate(historyRef.current, modelRef.current.id, {
        onToken: (t) => { full += t; setReply(full); },
        onError: (e) => { setError(e?.message || String(e)); },
        onComplete: () => {},
      }, {
        signal: controller.signal,
        temperature: settingsRef.current.temperature,
        topP: settingsRef.current.topP,
        maxTokens: settingsRef.current.maxTokens,
        memoryEnabled: settingsRef.current.memoryEnabled,
      });
    } catch (e: any) {
      if (e?.name !== "AbortError") setError(e?.message || String(e));
    }
    abortRef.current = null;
    if (!activeRef.current) return;

    if (full.trim()) {
      const aMsg: Message = { id: (Date.now() + 1).toString(), role: MessageRole.ASSISTANT, content: full, timestamp: Date.now() };
      historyRef.current = [...historyRef.current, aMsg];
      setHistory(historyRef.current);
      onNewMessageRef.current(aMsg);
      setReply("");
      setVoiceState("speaking");
      speak(full, () => { if (activeRef.current) startListening(); });
    } else {
      startListening();
    }
  }, [speak, startListening]);
  runTurnRef.current = runTurn;

  // Browser speech recognition, created once.
  useEffect(() => {
    if (usingWhisper) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("This browser has no speech recognition. Use Chrome/Edge, or switch Voice Engine to Local Whisper in Settings.");
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = "en-US";

    let finalText = "";
    let lastHeard = ""; // fallback when the engine ends without marking a result final
    let silentCycles = 0;
    rec.onresult = (event: any) => {
      let interim = "";
      finalText = "";
      for (let i = 0; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      lastHeard = (finalText + interim).trim();
      silentCycles = 0;
      setError(null);
      setLive(lastHeard);
    };
    rec.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // normal silence
      setError(ERROR_TEXT[e.error] || `Speech recognition error: ${e.error}`);
      if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
        activeRef.current = false;
        setVoiceState("off");
      }
    };
    rec.onend = () => {
      if (!activeRef.current || stateRef.current !== "listening") return;
      const text = (finalText.trim() || lastHeard);
      finalText = "";
      lastHeard = "";
      if (text) runTurnRef.current(text);
      else {
        if (++silentCycles === 3) setError("Listening, but no speech is reaching the browser. Check the right microphone is selected in the site permissions and not muted - or switch Voice Engine to Local Whisper in Settings.");
        setTimeout(() => { if (activeRef.current && stateRef.current === "listening") { try { rec.start(); } catch {} } }, 200);
      }
    };
    recognitionRef.current = rec;
    return () => {
      activeRef.current = false;
      try { rec.abort(); } catch {}
      recognitionRef.current = null;
    };
  }, [usingWhisper]);

  useEffect(() => () => {
    activeRef.current = false;
    abortRef.current?.abort();
    window.speechSynthesis?.cancel();
    recorderRef.current?.cancel();
  }, []);

  // Whisper recording timer
  useEffect(() => {
    if (!usingWhisper || state !== "listening") { setRecordingSeconds(0); return; }
    const start = Date.now();
    const t = setInterval(() => setRecordingSeconds(Math.floor((Date.now() - start) / 1000)), 250);
    return () => clearInterval(t);
  }, [usingWhisper, state]);

  const stopAll = () => {
    activeRef.current = false;
    abortRef.current?.abort();
    window.speechSynthesis?.cancel();
    try { recognitionRef.current?.abort(); } catch {}
    recorderRef.current?.cancel();
    setLive("");
    setVoiceState("off");
  };

  const toggleConversation = async () => {
    setError(null);
    if (usingWhisper) {
      // tap-to-talk
      if (stateRef.current === "listening") {
        setVoiceState("thinking");
        try {
          const text = await recorderRef.current?.stopAndTranscribe();
          setLive(text || "");
          if (text) { activeRef.current = true; await runTurn(text); activeRef.current = false; setVoiceState("off"); return; }
        } catch (e: any) { setError(e.message); }
        setVoiceState("off");
        return;
      }
      recorderRef.current = new LocalVoiceRecorder();
      try { await recorderRef.current.start(); setLive(""); setReply(""); setVoiceState("listening"); }
      catch (e: any) { setError(ERROR_TEXT["not-allowed"]); }
      return;
    }
    if (activeRef.current) return stopAll();
    activeRef.current = true;
    startListening();
  };

  const on = state !== "off";
  const label =
    state === "listening" ? (usingWhisper ? `Recording... ${recordingSeconds}s — tap to transcribe` : "Listening — just speak")
    : state === "thinking" ? "Thinking..."
    : state === "speaking" ? "Speaking..."
    : usingWhisper ? "Tap the mic, talk, tap again" : "Press Start to begin a live conversation";

  return (
    <div className="flex-1 flex flex-col bg-transparent glass rounded-[2.5rem] h-full p-6 relative overflow-hidden">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-3xl font-black text-white tracking-tighter">Sunayna Assistant</h1>
          <p className="text-zinc-500 font-medium uppercase tracking-[0.2em] text-[10px] mt-1">
            {usingWhisper ? "Local Whisper (offline)" : "Browser speech"} · {selectedModel.name}
          </p>
        </div>
        {on && (
          <Button onClick={stopAll} variant="ghost" className="bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold gap-2">
            <Power size={16} /> End
          </Button>
        )}
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
        {history.length === 0 && !live && !reply && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4 opacity-70">
            <Bot size={48} className="text-zinc-700" />
            <p className="text-zinc-500 text-sm max-w-xs">{label}</p>
          </div>
        )}
        {history.map((m) => (
          <div key={m.id} className={`flex gap-3 ${m.role === MessageRole.USER ? "justify-end" : ""}`}>
            {m.role !== MessageRole.USER && <Bot size={18} className="text-violet-400 mt-1 shrink-0" />}
            <p className={`max-w-[80%] text-sm leading-relaxed rounded-2xl px-4 py-3 whitespace-pre-wrap ${m.role === MessageRole.USER ? "bg-violet-600/20 text-zinc-100" : "bg-white/5 text-zinc-200"}`}>{m.content}</p>
            {m.role === MessageRole.USER && <User size={18} className="text-zinc-500 mt-1 shrink-0" />}
          </div>
        ))}
        {live && (
          <div className="flex gap-3 justify-end">
            <p className="max-w-[80%] text-sm leading-relaxed rounded-2xl px-4 py-3 bg-violet-600/10 text-zinc-300 italic border border-violet-500/20">{live}<span className="animate-pulse">▋</span></p>
            <User size={18} className="text-zinc-500 mt-1 shrink-0" />
          </div>
        )}
        {reply && (
          <div className="flex gap-3">
            <Bot size={18} className="text-violet-400 mt-1 shrink-0" />
            <p className="max-w-[80%] text-sm leading-relaxed rounded-2xl px-4 py-3 bg-white/5 text-zinc-200 whitespace-pre-wrap">{reply}<span className="animate-pulse">▋</span></p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 text-red-400 text-xs bg-red-500/10 rounded-xl px-4 py-3 shrink-0">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {/* Controls */}
      <div className="mt-4 shrink-0 flex flex-col items-center gap-3">
        <AnimatePresence>
          {state === "listening" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-1.5 h-8 items-center">
              {[1, 2, 3, 4, 5].map(i => (
                <motion.div key={i} animate={{ height: [8, 28, 8] }} transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }} className="w-1.5 bg-violet-400 rounded-full" />
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
          {state === "thinking" && <Loader2 size={12} className="animate-spin" />}
          {state === "speaking" && <Volume2 size={12} className="text-emerald-400" />}
          {label}
        </p>
        <Button
          size="lg"
          onClick={toggleConversation}
          disabled={state === "thinking" || state === "speaking"}
          className={`h-16 rounded-2xl px-8 font-bold gap-3 shadow-xl ${state === "listening" ? "bg-red-500 hover:bg-red-600" : "bg-violet-600 hover:bg-violet-500"} text-white`}
        >
          {state === "listening" ? <MicOff size={22} /> : <Mic size={22} />}
          {usingWhisper ? (state === "listening" ? "Stop & transcribe" : "Talk") : on ? "Listening..." : "Start conversation"}
        </Button>
        {state === "speaking" && (
          <Button variant="ghost" onClick={() => { window.speechSynthesis.cancel(); }} className="text-zinc-400 gap-2 text-xs">
            <Square size={12} className="fill-current" /> Skip speaking
          </Button>
        )}
      </div>
    </div>
  );
}
