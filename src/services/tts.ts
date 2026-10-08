/** Text-to-speech settings (voice + speed), remembered in the browser and used by read-aloud and the assistant. */

const KEY = "cursed.tts";
export interface TtsPrefs { voiceURI: string; rate: number }

export function getTtsPrefs(): TtsPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { voiceURI: typeof p.voiceURI === "string" ? p.voiceURI : "", rate: typeof p.rate === "number" ? Math.min(2, Math.max(0.5, p.rate)) : 1 };
  } catch { return { voiceURI: "", rate: 1 }; }
}

export function setTtsPrefs(p: Partial<TtsPrefs>) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...getTtsPrefs(), ...p })); } catch { /* storage blocked */ }
}

/** An utterance with the user's chosen voice and speed applied. Markdown symbols are not read out. */
export function makeUtterance(text: string): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text.replace(/[*_`#>]/g, ""));
  const { voiceURI, rate } = getTtsPrefs();
  u.rate = rate;
  if (voiceURI) {
    const v = window.speechSynthesis.getVoices().find(x => x.voiceURI === voiceURI);
    if (v) { u.voice = v; u.lang = v.lang; }
  }
  return u;
}

/** Installed voices (they load a moment after the page opens, so listen for the update). */
export function onVoices(cb: (voices: SpeechSynthesisVoice[]) => void): () => void {
  const synth = window.speechSynthesis;
  if (!synth) { cb([]); return () => {}; }
  const update = () => cb(synth.getVoices());
  update();
  synth.addEventListener?.("voiceschanged", update);
  return () => synth.removeEventListener?.("voiceschanged", update);
}
