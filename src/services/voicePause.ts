import { savedSetting } from "../lib/settingsStore";

/**
 * How long a pause the microphone puts up with before it decides you have finished. Changed in Settings > Voice and read each
 * time it is needed, so a new value works on the very next sentence. Used by the offline recorder and by the browser recognizer.
 */
export const PAUSE_DEFAULT_MS = 2500;
export const PAUSE_MIN_MS = 800;
export const PAUSE_MAX_MS = 8000;

export const clampPause = (ms: number) => Math.min(PAUSE_MAX_MS, Math.max(PAUSE_MIN_MS, Number.isFinite(ms) ? ms : PAUSE_DEFAULT_MS));
export const getVoicePauseMs = () => clampPause(Number(savedSetting("voicePauseMs", PAUSE_DEFAULT_MS)));

/** How long one offline recording may last, so a long thought with pauses is not cut off (it used to stop at 30 s). */
export const LONG_RECORDING_MS = 180_000;

/**
 * Keeps a browser SpeechRecognition open through pauses. On its own the recognizer ends the moment it hears a short silence,
 * which cuts off anyone who stops to think. Call this after the handlers are set and before start(): the recognizer then listens
 * continuously and is stopped only after the chosen pause with no new words.
 */
export function holdOpen(rec: any, pauseMs: () => number = getVoicePauseMs) {
  rec.continuous = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer) { clearTimeout(timer); timer = undefined; } };
  const onresult = rec.onresult;
  rec.onresult = (e: any) => {
    onresult?.(e);
    clear();
    timer = setTimeout(() => { rec.__paused = true; try { rec.stop(); } catch { /* already stopped */ } }, pauseMs());
  };
  const onend = rec.onend;
  rec.onend = (e: any) => { clear(); onend?.(e); };
}
