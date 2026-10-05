import React, { useState, useEffect, useRef, useCallback } from "react";
import { Mic, MicOff, Volume2, Square, Bot, Loader2, User, AlertTriangle, Power, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { AIModel, AppSettings, Message, MessageRole } from "../../types";
import { AIService } from "../../services/aiService";
import { LocalVoiceRecorder } from "../../services/localVoice";
import { resolveEngine, isOnline } from "../../services/voiceEngine";
import { notifyError } from "../../lib/notify";

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
 * Without a usable browser recognizer (other browsers, or no internet) it switches to the local Whisper model:
 * still hands-free - it listens until you stop talking, transcribes on this PC, then replies - fully offline.
 */
export function VoiceAssistant({ selectedModel, onNewMessage, settings }: VoiceAssistantProps) {
  const [browserFailed, setBrowserFailed] = useState(false);
  const usingWhisper = resolveEngine(settings.voiceEngine, browserFailed) === "whisper";
  const [level, setLevel] = useState(0);              // microphone loudness while listening offline
  const [transcribing, setTranscribing] = useState(false);
  const [heardYou, setHeardYou] = useState(false);       // offline: speech detected
  const [noSound, setNoSound] = useState(false);          // offline: mic is silent

  const [state, setState] = useState<VoiceState>("off");
  const [live, setLive] = useState("");            // what you're saying right now
  const [reply, setReply] = useState("");          // the model's reply, streaming
  const [history, setHistory] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (error) notifyError(error); }, [error]); // errors also pop up, even when minimised
  const readViewport = () => ({ w: Math.max(window.innerWidth, 320), h: Math.max(window.innerHeight, 400) });
  const [viewport, setViewport] = useState(readViewport);
  // Position as fractions (0..1) of the free area, so it survives window resizes.
  // null = default spot: right edge, above the chat box's send button.
  const [posFrac, setPosFrac] = useState<{ fx: number; fy: number } | null>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("cursed.pirate.pos") || "null");
      if (saved && typeof saved.fx === "number" && typeof saved.fy === "number") return saved;
    } catch { /* ignore */ }
    return null;
  });
  const dragRef = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean; mode: "fab" | "panel" } | null>(null);
  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

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

  // Streaming speech: sentences are queued to the synthesizer as the reply
  // arrives, so it starts talking while the model is still writing.
  const speechRef = useRef({ pending: 0, ended: false, skipped: false, done: () => {} });
  const enqueueSpeech = useCallback((text: string) => {
    const synth = window.speechSynthesis;
    const clean = text.replace(/[*_`#>]/g, "").trim();
    const sp = speechRef.current;
    if (!synth || !clean || sp.skipped) return;
    sp.pending++;
    const u = new SpeechSynthesisUtterance(clean);
    const finish = () => { sp.pending--; if (sp.ended && sp.pending <= 0) sp.done(); };
    u.onend = finish;
    u.onerror = finish;
    if (stateRef.current !== "speaking") setVoiceState("speaking");
    synth.speak(u);
  }, []);

  // Offline listening: record until you stop talking, transcribe locally, then run the turn (which listens again).
  const startListeningRef = useRef<() => void>(() => {});
  const whisperListen = async () => {
    if (!activeRef.current) return;
    setLive("");
    setTranscribing(false);
    setHeardYou(false);
    setNoSound(false);
    setVoiceState("listening");
    const rec = new LocalVoiceRecorder();
    recorderRef.current = rec;
    let peak = 0;
    const startedAt = Date.now();
    try {
      const text = await rec.listenOnce({
        onLevel: (l) => { peak = Math.max(peak, l); setLevel(l); if (Date.now() - startedAt > 5000 && peak < 0.02) setNoSound(true); },
        onSpeechStart: () => { setHeardYou(true); setNoSound(false); },
        onPartial: (t) => setLive(t),            // live captions while you talk (offline)
        onEnd: () => setTranscribing(true),
      });
      setTranscribing(false);
      setHeardYou(false);
      setLevel(0);
      if (!activeRef.current) return;
      if (text.trim()) { setLive(text.trim()); runTurnRef.current(text.trim()); }
      else setTimeout(() => startListeningRef.current(), 0); // nothing said - keep listening
    } catch (e: any) {
      setTranscribing(false);
      const blocked = /permission|denied|notallowed/i.test(String(e?.name) + String(e?.message));
      setError(blocked ? ERROR_TEXT["not-allowed"] : e?.message || String(e));
      activeRef.current = false;
      setVoiceState("off");
    }
  };

  const startListening = useCallback(() => {
    if (!activeRef.current) return;
    setLive("");
    if (usingWhisper) { void whisperListen(); return; }
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      setVoiceState("listening");
      rec.start();
    } catch {
      /* already started */
    }
  }, [usingWhisper]);
  startListeningRef.current = startListening;

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
    let failed = false;
    let spoken = 0; // chars of `full` already handed to the speech queue
    const sp = speechRef.current;
    sp.pending = 0; sp.ended = false; sp.skipped = false; sp.done = () => {};
    // Speak up to the last sentence end (or, for long run-ons, the last comma/space).
    const flushSpeech = (final: boolean) => {
      const rest = full.slice(spoken);
      let cut = -1;
      const re = /[.!?\n]+(\s|$)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(rest))) cut = m.index + m[0].length;
      if (cut < 0 && rest.length > 90) cut = Math.max(rest.lastIndexOf(", "), rest.lastIndexOf(" ")) + 1;
      if (final) cut = rest.length;
      if (cut > 0) { enqueueSpeech(rest.slice(0, cut)); spoken += cut; }
    };
    try {
      await AIService.generate(historyRef.current, modelRef.current.id, {
        onToken: (t) => { full += t; setReply(full); flushSpeech(false); },
        onError: (e) => { failed = true; setError(e?.message || String(e)); },
        onComplete: () => {},
      }, {
        signal: controller.signal,
        temperature: settingsRef.current.temperature,
        topP: settingsRef.current.topP,
        maxTokens: settingsRef.current.maxTokens,
        memoryEnabled: settingsRef.current.memoryEnabled,
      });
    } catch (e: any) {
      if (e?.name !== "AbortError") { failed = true; setError(e?.message || String(e)); }
    }
    abortRef.current = null;
    if (!activeRef.current) return;

    if (full.trim()) {
      flushSpeech(true);
      const aMsg: Message = { id: (Date.now() + 1).toString(), role: MessageRole.ASSISTANT, content: full, timestamp: Date.now() };
      historyRef.current = [...historyRef.current, aMsg];
      setHistory(historyRef.current);
      onNewMessageRef.current(aMsg);
      setReply("");
      // Listen again once everything queued has been spoken.
      sp.done = () => { if (activeRef.current) startListening(); };
      sp.ended = true;
      if (sp.pending <= 0) sp.done();
    } else if (failed) {
      // Don't loop listen -> fail -> listen; stop and show the error.
      activeRef.current = false;
      setVoiceState("off");
    } else {
      startListening();
    }
  }, [enqueueSpeech, startListening]);
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
      if (e.error === "network") {  // no internet: carry on with the offline model
        setBrowserFailed(true);
        setError("No internet for browser speech - switched to the offline voice model.");
        if (activeRef.current) setTimeout(() => startListeningRef.current(), 100);
        return;
      }
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
    if (activeRef.current) return stopAll();
    activeRef.current = true;
    if (isOnline()) setBrowserFailed(false); // internet is back: use the online recognizer again
    startListening();
  };

  const on = state !== "off";
  // Closing just minimises to the bubble - the conversation keeps going. "End" is what stops it.
  const closePanel = () => setOpen(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  const label =
    state === "listening" ? (transcribing ? "Transcribing..." : usingWhisper ? (heardYou ? "Hearing you..." : "Listening (offline) - just speak") : "Listening — just speak")
    : state === "thinking" ? "Thinking..."
    : state === "speaking" ? "Speaking..."
    : "Press Start to begin a live conversation";

  // --- Floating position (draggable, remembered, always kept on screen) ---
  const FAB = 44, M = 8;
  const vw = viewport.w, vh = viewport.h;
  const panelW = Math.min(400, vw - 2 * M), panelH = Math.min(560, vh - 2 * M);
  const rangeX = vw - FAB - 2 * M, rangeY = vh - FAB - 2 * M;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const fab = posFrac
    ? { x: M + clamp(posFrac.fx, 0, 1) * rangeX, y: M + clamp(posFrac.fy, 0, 1) * rangeY }
    : { x: vw - FAB - 24, y: clamp(vh - FAB - 150, M, vh - FAB - M) };
  // The open panel hangs off the icon's position but is kept fully on screen.
  const panelLeft = clamp(fab.x + FAB - panelW, M, vw - panelW - M);
  const panelTop = clamp(fab.y + FAB - panelH, M, vh - panelH - M);

  const beginDrag = (e: React.PointerEvent, mode: "fab" | "panel") => {
    if ((e.target as HTMLElement).closest("button") && mode === "panel") return; // header buttons stay clickable
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: fab.x, py: fab.y, moved: false, mode };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setPosFrac({ fx: clamp((d.px + dx - M) / rangeX, 0, 1), fy: clamp((d.py + dy - M) / rangeY, 0, 1) });
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (d.moved && posFrac) { try { localStorage.setItem("cursed.pirate.pos", JSON.stringify(posFrac)); } catch { /* storage blocked */ } }
    if (d.mode === "fab" && !d.moved) setOpen(true);
  };

  if (!open) {
    return (
      <button
        onPointerDown={(e) => beginDrag(e, "fab")}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        title="Cursed_Pirate"
        style={{ left: fab.x, top: fab.y }}
        className="fixed z-40 h-11 w-11 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-2xl shadow-violet-900/50 flex items-center justify-center hover:scale-110 transition-transform touch-none cursor-grab active:cursor-grabbing"
      >
        <Bot size={20} />
      </button>
    );
  }

  return (
    <div ref={panelRef} style={{ left: panelLeft, top: panelTop, width: panelW, height: panelH }} className="fixed z-40 flex flex-col bg-zinc-950/95 backdrop-blur-xl border border-white/10 rounded-[2rem] p-5 overflow-hidden shadow-2xl">
      <div
        onPointerDown={(e) => beginDrag(e, "panel")} onPointerMove={moveDrag} onPointerUp={endDrag}
        className="flex items-center justify-between mb-4 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none">
        <div>
          <h1 className="text-xl font-black text-white tracking-tighter">Cursed_Pirate</h1>
          <p className="text-zinc-500 font-medium uppercase tracking-[0.2em] text-[10px] mt-1">
            {usingWhisper ? "Local Whisper (offline)" : "Browser speech"} · {selectedModel.name}
          </p>
        </div>
        <div className="flex gap-2">
          {on && (
            <Button onClick={stopAll} variant="ghost" className="bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold gap-2">
              <Power size={16} /> End
            </Button>
          )}
          <Button onClick={closePanel} variant="ghost" title="Minimise" className="text-zinc-400"><X size={16} /></Button>
        </div>
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
              {usingWhisper ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-end gap-1 h-8">
                    {[0.5, 0.8, 1, 0.8, 0.5, 0.7, 0.9, 0.6].map((m, i) => (
                      <div key={i} className={`w-1.5 rounded-full transition-all duration-100 ${transcribing ? "bg-amber-400 animate-pulse" : heardYou ? "bg-emerald-400" : "bg-violet-400/60"}`} style={{ height: transcribing ? 14 : Math.max(4, Math.min(32, 4 + level * 40 * m)) }} />
                    ))}
                  </div>
                  <div className="flex gap-1.5 text-[9px] font-black uppercase tracking-widest">
                    {[["Waiting", !heardYou && !transcribing], ["Hearing", heardYou && !transcribing], ["Transcribing", transcribing]].map(([n, on]) => (
                      <span key={n as string} className={`px-2 py-0.5 rounded-full ${on ? "bg-violet-500 text-white" : "bg-white/5 text-zinc-600"}`}>{n as string}</span>
                    ))}
                  </div>
                  {noSound && <p className="text-[10px] text-amber-400 max-w-[260px] text-center">No sound is reaching the microphone - check which microphone the browser is using and that it is not muted.</p>}
                </div>
              ) : [1, 2, 3, 4, 5].map(i => (
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
          {on ? "Listening..." : "Start conversation"}
        </Button>
        {state === "speaking" && (
          <Button variant="ghost" onClick={() => { speechRef.current.skipped = true; window.speechSynthesis.cancel(); }} className="text-zinc-400 gap-2 text-xs">
            <Square size={12} className="fill-current" /> Skip speaking
          </Button>
        )}
      </div>
    </div>
  );
}
