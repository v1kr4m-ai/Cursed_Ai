import { LocalVoiceRecorder } from "./localVoice";

export type VoiceEnginePref = "auto" | "browser" | "whisper";

export const browserSpeechAvailable = () =>
  typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

/**
 * Which speech-to-text to use right now. The browser's own recognizer is only possible in some browsers
 * (Chrome/Edge/Safari) and needs internet; the local Whisper model works in every browser and offline.
 * "auto" and "browser" therefore fall back to Whisper whenever the browser option isn't usable.
 */
export function resolveEngine(pref: VoiceEnginePref | undefined, browserFailed = false): "browser" | "whisper" {
  if (pref === "whisper") return "whisper";
  const canUseBrowser = browserSpeechAvailable() && navigator.onLine && !browserFailed;
  return canUseBrowser ? "browser" : "whisper";
}

/** Can this device capture speech at all (either way)? */
/** True when the browser says it is online (re-evaluated every call, so coming back online switches back by itself). */
export const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

export const speechInputAvailable = () => browserSpeechAvailable() || LocalVoiceRecorder.isSupported;
