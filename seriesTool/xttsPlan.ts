/**
 * Pure parts of the XTTS-v2 voice (Hindi and 16 other languages): which language a text is in, splitting it into pieces the
 * model reads well, and planning a scene as one turn per speaker. Used by the Voice tab's job (trainTool/voice.ts) and the
 * series voice (voiceTrack.ts). No Node imports: the browser uses planScene too.
 */
import type { Gender, PeopleVoices, SceneLine } from "./voices";
import { inferGender } from "./voices";
import voiceTable from "./xttsVoices.json";

export const XTTS_LANGUAGES: { id: string; label: string }[] = [
  { id: "hi", label: "Hindi" }, { id: "en", label: "English" }, { id: "ar", label: "Arabic" }, { id: "zh-cn", label: "Chinese" },
  { id: "es", label: "Spanish" }, { id: "fr", label: "French" }, { id: "de", label: "German" }, { id: "it", label: "Italian" },
  { id: "pt", label: "Portuguese" }, { id: "pl", label: "Polish" }, { id: "tr", label: "Turkish" }, { id: "ru", label: "Russian" },
  { id: "nl", label: "Dutch" }, { id: "cs", label: "Czech" }, { id: "hu", label: "Hungarian" }, { id: "ko", label: "Korean" }, { id: "ja", label: "Japanese" },
];
export const isXttsLanguage = (id: unknown): id is string => typeof id === "string" && XTTS_LANGUAGES.some(l => l.id === id);

const SCRIPTS: [string, RegExp][] = [
  ["hi", /\p{Script=Devanagari}/gu], ["ar", /\p{Script=Arabic}/gu], ["zh-cn", /\p{Script=Han}/gu], ["ja", /[\p{Script=Hiragana}\p{Script=Katakana}]/gu],
  ["ko", /\p{Script=Hangul}/gu], ["ru", /\p{Script=Cyrillic}/gu],
];

/**
 * The language a text is written in, from its script: the known non-Latin script with most letters wins, even when mixed with Latin (Devanagari -> hi, Arabic, Chinese,
 * Japanese, Korean, Cyrillic -> ru), plain Latin letters -> en. Kana beat Han (Japanese uses both). Null for a script XTTS has no
 * language for (Tamil, Thai...), and "" when there are no letters at all. Romanized Hindi ("kya haal hai") reads as English.
 */
export function detectLanguage(text: string): string | null {
  const total = (text.match(/\p{L}/gu) || []).length;
  if (!total) return "";
  const counts = SCRIPTS.map(([id, re]) => [id, (text.match(re) || []).length] as const);
  if (counts.find(([id]) => id === "ja")![1] > 0) return "ja";
  const [best, n] = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  if (n > 0) return best; // any known non-Latin script wins, so "Hello दोस्त" is read as Hindi
  return (text.match(/\p{Script=Latin}/gu) || []).length === total ? "en" : null;
}

/** Most characters per piece. XTTS warns above ~250 and cuts short for some languages. ponytail: rough per-language figures, tune after listening. */
export const maxChars = (lang: string): number => ({ ar: 160, "zh-cn": 80, ja: 70, ko: 90, ru: 180, cs: 180 } as Record<string, number>)[lang] ?? 230;

/** Text in pieces of at most maxChars(lang): at sentence ends (. ! ? | and CJK/Arabic marks), joined up while they fit, long sentences cut at commas, then spaces. */
export function splitForXtts(text: string, lang: string, max = maxChars(lang)): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?।॥؟…]["')\]]*)\s+|(?<=[。！？])/u).map(s => s.trim()).filter(Boolean);
  const cut = (s: string): string[] => {
    if (s.length <= max) return [s];
    const at = [...s.matchAll(/[,;:،，、]\s*/g)].map(m => m.index! + m[0].length).filter(i => i < s.length).pop() ?? -1;
    let i = at > 0 && at >= max * 0.3 && at <= max ? at : s.lastIndexOf(" ", max);
    if (i < max * 0.3) i = max; // no good place: cut hard (CJK has no spaces)
    return [s.slice(0, i).trim(), ...cut(s.slice(i).trim())].filter(Boolean);
  };
  const out: string[] = [];
  for (const piece of sentences.flatMap(cut)) {
    const last = out[out.length - 1];
    if (last && last.length + 1 + piece.length <= max) out[out.length - 1] = last + " " + piece; else out.push(piece);
  }
  return out;
}

/** Voices XTTS ships with, given to different speakers (in order of appearance) when they have no sample of their own. Unknown names fall back to the first speaker in the script. */
export const BUILTIN_SPEAKERS = ["Claribel Dervla", "Andrew Chipper", "Daisy Studious", "Badr Odhiambo", "Dionisio Schuyler", "Torcull Diarmuid"];

/** Every built-in speaker with the gender and median F0 measured from the real model (trainTool/scripts/xtts_classify.py); "ambiguous" ones are never auto-picked. */
export const XTTS_VOICES = voiceTable as { name: string; gender: Gender; f0: number; ambiguous?: boolean }[];
const pool = (g: Gender) => XTTS_VOICES.filter(v => v.gender === g && !v.ambiguous);

/**
 * The built-in voice for someone without a sample: their explicit `builtinVoice`; else a voice of their gender (their own `gender`, or
 * inferred from their voice text), stable by position among the people of that gender; the narrator takes the last voice of the
 * project voice's gender. Gender unknown: undefined (the caller keeps the old slot rule).
 */
export function genderedVoice(who: string, people: PeopleVoices | undefined, projectVoice?: string): string | undefined {
  const entry = (n: string) => { const k = Object.keys(people || {}).find(x => key(x) === key(n)); return k ? people![k] : undefined; };
  const genderOf = (n: string) => entry(n)?.gender || inferGender(entry(n)?.voice);
  if (!who) { const g = inferGender(projectVoice); return g ? pool(g).slice(-1)[0]?.name : undefined; }
  const e = entry(who);
  if (e?.builtinVoice?.trim()) return e.builtinVoice.trim();
  const g = genderOf(who);
  if (!g) return undefined;
  const same = Object.keys(people || {}).filter(n => genderOf(n) === g);
  return pool(g)[Math.max(0, same.findIndex(n => key(n) === key(who))) % pool(g).length]?.name;
}

export interface XttsTurn { /** "" = narrator */ who: string; text: string; language: string; referenceAudio?: string; speaker?: string }
const key = (s?: string) => (s || "").trim().toLowerCase();

/** Text XTTS can say: no emoji, markup, links, or anything in brackets (stage directions and sound effects would be read aloud). */
export function cleanForXtts(text: string): string {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/\[[^\]]*\]|\([^)]*\)|（[^）]*）/g, " ")
    .replace(/[#@]\w+/g, " ")
    .replace(/[*_~`<>{}|\^]/g, " ")
    .replace(/\p{Extended_Pictographic}|️|‍/gu, " ")
    .replace(/&/g, " and ")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[—–]/g, ", ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ").trim();
}

/**
 * One turn per speaker change (consecutive lines of one speaker are joined). Each turn gets its language from its own text and
 * that speaker's voice sample, or else a built-in voice (a different one per speaker, of the speaker's gender when known). A turn in a script XTTS cannot speak is left out with a note; the scene is skipped only when nothing is left.
 */
export function planTurns(lines: SceneLine[], people: PeopleVoices | undefined, sampleOf: (p: PeopleVoices | undefined, n?: string) => { audio: string } | undefined, projectVoice?: string): { turns: XttsTurn[]; skipped?: string; notes: string[] } {
  const turns: XttsTurn[] = [];
  const order: string[] = [];
  for (const l of lines) {
    const text = cleanForXtts(l.text);
    if (!/[\p{L}\p{N}]/u.test(text)) continue; // "...", "!!!", "।": nothing to say
    const who = l.speaker?.trim() || "";
    if (!order.some(n => key(n) === key(who))) order.push(who);
    const prev = turns[turns.length - 1];
    if (prev && key(prev.who) === key(who)) prev.text += " " + text; else turns.push({ who, text, language: "" });
  }
  if (!turns.length) return { turns, skipped: "Nothing speakable is left once emoji and markup are removed.", notes: [] };
  const notes: string[] = [];
  // a person keeps the same built-in voice in every scene: the narrator has a fixed slot, others their place in the project's people (unknown names: a stable hash)
  const names = Object.keys(people || {});
  const slot = (who: string) => { if (!who) return 0; const i = names.findIndex(k => key(k) === key(who)); return i >= 0 ? i + 1 : 1 + [...key(who)].reduce((a, c) => a + c.charCodeAt(0), 0); };
  const kept: XttsTurn[] = [];
  for (const t of turns) {
    const lang = detectLanguage(t.text);
    if (lang === null) { notes.push(`${t.who || "The narrator"}: a line in a script XTTS cannot speak was left out: ${t.text.slice(0, 30)}...`); continue; }
    t.language = lang || "en"; // digits only: nothing to tell, English reads them
    const sample = sampleOf(people, t.who);
    if (sample) t.referenceAudio = sample.audio; else t.speaker = genderedVoice(t.who, people, projectVoice) ?? BUILTIN_SPEAKERS[slot(t.who) % BUILTIN_SPEAKERS.length];
    kept.push(t);
  }
  if (!kept.length) return { turns: [], skipped: `XTTS cannot speak this script: ${turns[0].text.slice(0, 30)}...`, notes: [] };
  turns.splice(0, turns.length, ...kept);
  const noSample = order.filter(n => !sampleOf(people, n));
  if (noSample.length) notes.push(`${noSample.map(n => n || "the narrator").join(", ")}: no voice sample, so a built-in XTTS voice is used.`);
  return { turns, notes };
}
