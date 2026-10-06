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

/** Why the microphone cannot work on this page at all (null = fine). Browsers only allow it on https or localhost. */
export function micBlockedReason(): string | null {
  if (typeof window === "undefined") return null;
  if (!window.isSecureContext) return "The microphone only works on http://localhost or https. Open the app at http://localhost:3000 on this PC.";
  if (!navigator.mediaDevices?.getUserMedia && !browserSpeechAvailable()) return "This browser can't use a microphone. Try Chrome, Edge or Firefox.";
  return null;
}

/** Plain-language text for a SpeechRecognition error code. */
export function speechErrorText(code: string): string {
  switch (code) {
    case "not-allowed": case "service-not-allowed": return "Microphone blocked - allow it for this site (lock icon in the address bar), then try again.";
    case "audio-capture": return "No microphone found. Plug one in or pick it in your system sound settings.";
    case "no-speech": return "I didn't hear anything. Check that the right microphone is selected and not muted.";
    case "network": return "Browser speech needs internet - switching to the offline microphone.";
    default: return `Speech recognition error: ${code}`;
  }
}
