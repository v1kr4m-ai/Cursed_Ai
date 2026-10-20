/**
 * Voice typing for any text box: the browser's recognizer when it exists and there is internet,
 * the local Whisper model otherwise. Dictation only ever *appends* to what is already typed - it
 * never sends anything by itself.
 *
 * Extracted from the chat composer so other screens get the same behaviour. (ChatWindow still has
 * its own copy; it can move onto this hook whenever that file is next touched.)
 */
import React from "react";
import { LocalVoiceRecorder } from "./localVoice";
import { isOnline, micBlockedReason, resolveEngine, speechErrorText, speechInputAvailable, type VoiceEnginePref } from "./voiceEngine";
import { notifyError, notifyWarning } from "../lib/notify";

export interface Dictation {
  supported: boolean;
  listening: boolean;
  transcribing: boolean;
  /** 0..1 loudness while the offline recorder is listening, for the button's ring. */
  level: number;
  engine: "browser" | "whisper";
  toggle: () => void;
}

/**
 * @param value   what is in the box right now - dictated words are appended to it
 * @param onText  called with the full new value as words arrive
 */
export function useDictation(value: string, onText: (next: string) => void, pref: VoiceEnginePref = "auto"): Dictation {
  const [listening, setListening] = React.useState(false);
  const [transcribing, setTranscribing] = React.useState(false);
  const [level, setLevel] = React.useState(0);
  const [browserFailed, setBrowserFailed] = React.useState(false);

  const recognition = React.useRef<any>(null);
  const recorder = React.useRef<LocalVoiceRecorder | null>(null);
  // Read at click time rather than through the closure, so a half-typed line is not lost.
  const latest = React.useRef(value);
  latest.current = value;

  React.useEffect(() => {
    const back = () => setBrowserFailed(false); // internet returned: prefer the online recognizer again
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);

  React.useEffect(() => () => {
    try { recognition.current?.stop(); } catch { /* already gone */ }
    recorder.current?.finish();
  }, []);

  const append = (base: string, text: string) => onText(base ? `${base} ${text}` : text);

  const startWhisper = async () => {
    const rec = new LocalVoiceRecorder();
    recorder.current = rec;
    const base = latest.current;
    setListening(true);
    try {
      const text = await rec.listenOnce({
        onLevel: setLevel,
        onPartial: t => append(base, t),
        onEnd: () => { setListening(false); setTranscribing(true); setLevel(0); },
      });
      if (text) append(base, text);
    } catch (e: any) {
      const blocked = /permission|denied|notallowed/i.test(`${e?.name}${e?.message}`);
      notifyError(blocked ? "Microphone blocked - allow it for this site (lock icon in the address bar)." : `Voice input failed: ${e?.message || e}`);
    } finally {
      setListening(false);
      setTranscribing(false);
      recorder.current = null;
    }
  };

  const toggle = () => {
    if (transcribing) return;
    const blocked = micBlockedReason();
    if (blocked || !speechInputAvailable()) {
      notifyError(blocked || "No microphone is available in this browser.");
      return;
    }
    if (isOnline() && !listening) setBrowserFailed(false);

    const engineNow = resolveEngine(pref, browserFailed);
    if (listening) {
      if (engineNow === "whisper") recorder.current?.finish();
      else { recognition.current?.stop(); setListening(false); }
      return;
    }
    if (engineNow === "whisper") { startWhisper(); return; }

    const Recognizer = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new Recognizer();
    r.continuous = false;
    r.interimResults = true;
    r.lang = "en-US";
    const base = latest.current;
    r.onresult = (event: any) => append(base, Array.from(event.results).map((x: any) => x[0].transcript).join(""));
    r.onend = () => setListening(false);
    r.onerror = (e: any) => {
      setListening(false);
      const code = e?.error || "unknown";
      if (code === "aborted") return;
      // No internet, or the browser's speech service is down: fall back to the offline model.
      if (code === "network" || code === "service-not-allowed") {
        notifyWarning(speechErrorText("network"));
        setBrowserFailed(true);
        startWhisper();
        return;
      }
      notifyError(speechErrorText(code));
    };
    recognition.current = r;
    setListening(true);
    r.start();
  };

  return {
    supported: speechInputAvailable(),
    listening,
    transcribing,
    level,
    engine: resolveEngine(pref, browserFailed),
    toggle,
  };
}
