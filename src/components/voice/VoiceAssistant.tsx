import React, { useState, useEffect, useRef } from "react";
import { Mic, MicOff, Volume2, Square, Bot, Loader2, Zap, Shield } from "lucide-react";
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

type VoiceState = "idle" | "listening" | "processing" | "speaking";

export function VoiceAssistant({ selectedModel, onNewMessage, settings }: VoiceAssistantProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const recognitionRef = useRef<any>(null);
  const localRecorderRef = useRef<LocalVoiceRecorder | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const usingWhisper = settings.voiceEngine === "whisper";

  useEffect(() => {
    if (usingWhisper) return; // local Whisper path doesn't use the Web Speech API at all

    // Initialize Web Speech API
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = "en-US";

      recognitionRef.current.onresult = (event: any) => {
        const currentTranscript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result: any) => result.transcript)
          .join("");
        setTranscript(currentTranscript);
      };

      recognitionRef.current.onend = () => {
        if (state === "listening") {
          handleProcessVoice();
        }
      };
    }

    synthRef.current = window.speechSynthesis;

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (synthRef.current) synthRef.current.cancel();
    };
  }, [state, usingWhisper]);

  useEffect(() => {
    // speechSynthesis is used by both engines for the spoken reply
    synthRef.current = window.speechSynthesis;
    return () => synthRef.current?.cancel();
  }, []);

  const toggleListening = async () => {
    if (usingWhisper) {
      if (state === "listening") {
        setState("processing");
        try {
          const text = await localRecorderRef.current?.stopAndTranscribe();
          setTranscript(text || "");
          if (text) {
            await handleProcessVoice(text);
          } else {
            setState("idle");
          }
        } catch (e) {
          console.error("Local transcription failed:", e);
          setState("idle");
        }
        return;
      }
      setTranscript("");
      setResponse("");
      localRecorderRef.current = new LocalVoiceRecorder();
      try {
        await localRecorderRef.current.start();
        setState("listening");
      } catch (e) {
        console.error("Failed to start recording:", e);
      }
      return;
    }

    if (state === "listening") {
      recognitionRef.current?.stop();
      setState("idle");
    } else {
      setTranscript("");
      setResponse("");
      setState("listening");
      recognitionRef.current?.start();
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    synthRef.current?.cancel();
    setState("idle");
  };

  // Accepts an explicit transcript override for the Whisper path, where the
  // text arrives async (from the server) after setTranscript() is called -
  // reading the `transcript` state var here would be a stale closure.
  const handleProcessVoice = async (transcriptOverride?: string) => {
    const finalTranscript = transcriptOverride ?? transcript;
    if (!finalTranscript) {
      setState("idle");
      return;
    }

    setState("processing");

    // Create actual message for history tracking
    const userMsg: Message = {
      id: Date.now().toString(),
      role: MessageRole.USER,
      content: finalTranscript,
      timestamp: Date.now()
    };
    onNewMessage(userMsg);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      let fullResponse = "";
      await AIService.generate([userMsg], selectedModel.id, {
        onToken: (token) => {
          fullResponse += token;
          setResponse(fullResponse);
        },
        onError: (error) => {
          console.error("Voice processing failed:", error);
          setState("idle");
        },
        onComplete: () => {
          const assistantMsg: Message = {
            id: (Date.now() + 1).toString(),
            role: MessageRole.ASSISTANT,
            content: fullResponse,
            timestamp: Date.now() + 1
          };
          onNewMessage(assistantMsg);
          speakResponse(fullResponse);
        }
      }, {
        signal: controller.signal,
        temperature: settings.temperature,
        topP: settings.topP,
        maxTokens: settings.maxTokens,
        memoryEnabled: settings.memoryEnabled
      });
    } catch (error) {
      console.error("Voice processing failed:", error);
      setState("idle");
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const speakResponse = (text: string) => {
    if (!synthRef.current) return;
    
    // Cancel any current speech
    synthRef.current.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => setState("speaking");
    utterance.onend = () => setState("idle");
    utterance.onerror = () => setState("idle");
    
    synthRef.current.speak(utterance);
  };

  const stopSpeaking = () => {
    synthRef.current?.cancel();
    setState("idle");
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-transparent glass rounded-[2.5rem] h-full p-8 relative overflow-hidden">
      {/* Background Decorative Rings */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center opacity-10">
        <motion.div 
          animate={{ scale: [1, 1.2, 1], rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="w-[500px] h-[500px] border border-violet-500 rounded-full"
        />
        <motion.div 
          animate={{ scale: [1.2, 1, 1.2], rotate: -360 }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="w-[400px] h-[400px] border border-emerald-500 rounded-full"
        />
      </div>

      <div className="max-w-2xl w-full flex flex-col items-center gap-12 z-10">
        <div className="text-center space-y-4">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center gap-3 mb-2"
          >
            <div className="vulkan-tag">{usingWhisper ? "Local Whisper (Offline)" : "Browser Speech"}</div>
            <div className="model-tag">{selectedModel.name}</div>
          </motion.div>
          <h1 className="text-5xl font-black text-white tracking-tighter">Sunayna Assistant</h1>
          <p className="text-zinc-500 font-medium uppercase tracking-[0.2em] text-sm">Offline Multimodal Pipeline Active</p>
        </div>

        {/* Visualizer Area */}
        <div className="relative w-64 h-64 flex items-center justify-center">
          <AnimatePresence>
            {state === "listening" && (
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1.5, opacity: 0.2 }}
                exit={{ scale: 2, opacity: 0 }}
                transition={{ duration: 1.5, repeat: Infinity }}
                className="absolute inset-0 bg-violet-600 rounded-full blur-3xl"
              />
            )}
            {state === "speaking" && (
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1.2, opacity: 0.15 }}
                exit={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 1, repeat: Infinity }}
                className="absolute inset-0 bg-emerald-500 rounded-full blur-3xl"
              />
            )}
          </AnimatePresence>

          <motion.div 
            className={`w-48 h-48 rounded-[3rem] glass flex items-center justify-center border-2 transition-colors duration-500 shadow-2xl ${
              state === "listening" ? "border-violet-500 shadow-violet-500/20" : 
              state === "speaking" ? "border-emerald-500 shadow-emerald-500/20" : 
              state === "processing" ? "border-white/20 animate-pulse" : "border-white/10"
            }`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {state === "processing" ? (
              <Loader2 className="text-zinc-400 animate-spin" size={48} />
            ) : state === "speaking" ? (
              <Volume2 className="text-emerald-400" size={48} />
            ) : state === "listening" ? (
                <div className="flex gap-1.5">
                   {[1,2,3,4,5].map(i => (
                     <motion.div 
                        key={i}
                        animate={{ height: [12, 32, 12] }}
                        transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                        className="w-1.5 bg-violet-400 rounded-full"
                     />
                   ))}
                </div>
            ) : (
              <Bot className="text-zinc-600" size={48} />
            )}
          </motion.div>
        </div>

        {/* Text Display */}
        <div className="w-full text-center min-h-[80px]">
          <AnimatePresence mode="wait">
            {state === "listening" && (
              <motion.div 
                key="listening"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-2"
              >
                <p className="text-violet-400 font-bold uppercase tracking-widest text-[10px]">Listening...</p>
                <p className="text-xl text-zinc-300 font-medium italic">"{transcript || "Say something..."}"</p>
              </motion.div>
            )}
            {state === "processing" && (
              <motion.div 
                key="processing"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-zinc-500 font-bold uppercase tracking-widest text-[10px]"
              >
                Processing Core Inference...
              </motion.div>
            )}
            {(state === "speaking" || (state === "idle" && response)) && (
              <motion.div 
                key="response"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-4"
              >
                {state === "speaking" && <p className="text-emerald-400 font-bold uppercase tracking-widest text-[10px] pulse-anim">AI Assistant is speaking</p>}
                <p className="text-lg text-zinc-200 leading-relaxed font-medium line-clamp-3 overflow-hidden">{response}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-6">
          <Button 
            size="lg"
            className={`h-16 w-16 rounded-2xl transition-all shadow-xl ${
              state === "listening" 
                ? "bg-red-500 hover:bg-red-600 text-white" 
                : "bg-violet-600 hover:bg-violet-500 text-white"
            }`}
            onClick={toggleListening}
            disabled={state === "processing" || state === "speaking"}
          >
            {state === "listening" ? <MicOff size={24} /> : <Mic size={24} />}
          </Button>

          {state === "speaking" && (
            <Button 
              variant="outline"
              size="lg"
              className="h-16 w-16 rounded-2xl border-white/10 glass bg-white/5 text-zinc-400 hover:text-white"
              onClick={stopSpeaking}
            >
              <Square size={20} className="fill-current" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-8 mt-4 pt-10 border-t border-white/5 w-full justify-center">
            <div className="flex items-center gap-2 group cursor-pointer">
              <Zap size={14} className="text-emerald-500" />
              <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest group-hover:text-zinc-400 transition-colors">Low Latency Mode</span>
            </div>
            <div className="flex items-center gap-2 group cursor-pointer">
              <Shield size={14} className="text-violet-500" />
              <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest group-hover:text-zinc-400 transition-colors">Local Sandbox Encryption</span>
            </div>
        </div>
      </div>
    </div>
  );
}
