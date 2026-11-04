/**
 * Pure parts of the "Dia voice" for a series (voiceEngine "dia"): turning scenes into Dia scripts, mapping speakers to
 * [S1]/[S2], deciding which scenes cannot be voiced, and file names. The job that runs Dia is in voiceTrackRoutes.ts.
 *
 * Dia limits, stated honestly: English only, two speakers per call, one voice sample per call (the sample is used for [S1]).
 */
import { cleanLines, type PeopleVoices, type SceneLine } from "./voices";
import { projectFormat } from "./formats";
import { planTurns, type XttsTurn } from "./xttsPlan";
import type { Episode, Project, Scene } from "./model";

export type Tag = "[S1]" | "[S2]";

/** Sound effects Dia knows; any other (bracket-free) parenthesis is a stage direction it would read aloud or garble. */
const NONVERBAL = ["laughs", "clears throat", "sighs", "gasps", "coughs", "singing", "sings", "mumbles", "groans", "sniffs", "claps", "screams", "inhales", "exhales", "applause", "burps", "humming", "sneezes", "chuckle", "whistles"];

/** True unless the text has letters of a script other than Latin (Devanagari, Arabic, CJK...). Numbers and punctuation are fine. */
export const isEnglishText = (text: string): boolean => !/\p{L}/u.test(text.replace(/\p{Script=Latin}/gu, ""));

/** Text Dia can say: no emoji, markup, links or square brackets (those are speaker tags), only the sound effects it knows. */
export function cleanForDia(text: string): string {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\(([^)]*)\)/g, (m, inner) => (NONVERBAL.includes(String(inner).trim().toLowerCase()) ? `(${String(inner).trim().toLowerCase()})` : " "))
    .replace(/[#@]\w+/g, " ")
    .replace(/[*_~`<>{}|\\^]/g, " ")
    .replace(/\p{Extended_Pictographic}|️|‍/gu, " ")
    .replace(/&/g, " and ")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[—–]/g, ", ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ").trim();
}

export interface Turn { tag: Tag; text: string }
export interface Mapped { turns: Turn[]; /** every distinct speaker in order of appearance ("" = narrator) */ speakers: string[]; /** speaker name ("" = narrator/project voice) per tag actually used */ who: Partial<Record<Tag, string>>; notes: string[] }

const key = (s?: string) => (s || "").trim().toLowerCase();

/**
 * Speakers to tags in order of first appearance, so the script always starts with [S1] (a line without a speaker is the
 * narrator). A third distinct speaker has no tag of its own: it takes the tag that is not the previous turn's, and a note says so.
 * The voice sample is only ever used for [S1], so speakers are never reordered for it.
 */
export function mapSpeakers(lines: SceneLine[]): Mapped {
  const notes: string[] = [];
  const names: string[] = [];
  for (const l of lines) { const k = key(l.speaker); if (!names.some(n => key(n) === k)) names.push(l.speaker?.trim() || ""); }
  const order = names;
  if (order.length > 2) notes.push(`${order.length} different speakers but Dia has two voices: ${order.slice(2).map(n => n || "the narrator").join(", ")} share a voice with another speaker.`);
  const tagOf = new Map<string, Tag>(order.slice(0, 2).map((n, i) => [key(n), i === 0 ? "[S1]" : "[S2]"] as [string, Tag]));
  const turns: Turn[] = [];
  const who: Partial<Record<Tag, string>> = {};
  order.slice(0, 2).forEach((n, i) => { who[i === 0 ? "[S1]" : "[S2]"] = n; });
  for (const l of lines) {
    let tag = tagOf.get(key(l.speaker));
    if (!tag) tag = turns.length && turns[turns.length - 1].tag === "[S1]" ? "[S2]" : "[S1]";
    const prev = turns[turns.length - 1];
    if (prev && prev.tag === tag) prev.text += " " + l.text; else turns.push({ tag, text: l.text });
  }
  return { turns, speakers: order, who, notes };
}

/** What the person with a voice sample gave, or undefined. */
export function sampleOf(people: PeopleVoices | undefined, name?: string): { audio: string; text: string } | undefined {
  if (!people || !name) return undefined;
  const k = Object.keys(people).find(x => key(x) === key(name));
  const e = k ? people[k] : undefined;
  return e?.refAudio?.trim() ? { audio: e.refAudio.trim(), text: (e.refText || "").trim() } : undefined;
}

/** The scene's lines as written: `lines` when set, otherwise the single `vo` line (as the narrator). */
export const sceneSpeech = (s: Pick<Scene, "vo" | "lines">): SceneLine[] => {
  const lines = cleanLines(s.lines);
  return lines.length ? lines : cleanLines([s.vo]);
};

/** About how long Dia speaks this text, in seconds (roughly 2.6 words a second). */
export const estimateSeconds = (text: string): number => Math.round((text.split(/\s+/).filter(Boolean).length / 2.6) * 10) / 10;

export const MAX_SECONDS = 30;
/** Dia makes about 86 audio tokens a second; allow 1.5x the estimate plus 1.5 s so a slow speaker is not cut, but a run-on is. */
export const tokenCap = (seconds: number): number => Math.max(300, Math.round((seconds * 1.5 + 1.5) * 86));

export interface ScenePlan {
  sceneId: string; number: number; file: string;
  /** The script given to Dia, or "" when the scene is skipped. */
  script: string;
  skipped?: string;
  notes: string[];
  /** Voice sample (used for [S1]) and its transcript tagged for Dia, when one applies. */
  referenceAudio?: string; referenceText?: string;
  seconds: number;
  /** voiceEngine "xtts" only: one turn per speaker change, each with its language and voice (sample or built-in). */
  turns?: XttsTurn[];
  /** Cap on what Dia generates (about 86 tokens a second): short lines otherwise tend to run on for a long time. */
  maxTokens?: number;
}

/** Output name inside the project folder, by scene id so inserting or moving scenes never makes one overwrite another: voice/<sceneId>.wav. (Older files voice/ep02_s03.wav stay valid through scene.voiceFile.) */
export const voiceFileName = (sceneId: string) => `voice/${sceneId.replace(/[^A-Za-z0-9_-]/g, "_")}.wav`;

export function planScene(p: Pick<Project, "format" | "voice" | "people" | "voiceEngine">, ep: Pick<Episode, "number">, s: Scene): ScenePlan {
  const base: ScenePlan = { sceneId: s.id, number: s.number, file: voiceFileName(s.id), script: "", notes: [], seconds: 0 };
  const speech = projectFormat(p).speech;
  if (speech === "none") return { ...base, skipped: "This style has no spoken voice." };
  if (speech === "sung") return { ...base, skipped: "Singing is not something Dia can do." };
  if (p.voiceEngine === "xtts") {
    if (!sceneSpeech(s).length) return { ...base, skipped: "No spoken line." };
    const t = planTurns(sceneSpeech(s), p.people, sampleOf);
    if (t.skipped) return { ...base, skipped: t.skipped };
    // the script is what the voice file is stamped with: speaker, language, sample and words of every turn
    const script = t.turns.map(x => `${x.who}|${x.language}|${x.referenceAudio || x.speaker}: ${x.text}`).join("\n");
    return { ...base, script, turns: t.turns, notes: t.notes, seconds: estimateSeconds(t.turns.map(x => x.text).join(" ")) };
  }
  const lines = sceneSpeech(s).map(l => ({ ...l, text: cleanForDia(l.text) })).filter(l => l.text);
  const raw = sceneSpeech(s).map(l => l.text).join(" ");
  if (!raw) return { ...base, skipped: "No spoken line." };
  if (!isEnglishText(raw)) return { ...base, skipped: "Not English: Dia speaks English only." };
  if (!lines.length) return { ...base, skipped: "Nothing speakable is left once emoji and markup are removed." };
  const m = mapSpeakers(lines);
  const script = m.turns.map(t => `${t.tag} ${t.text}`).join(" ");
  const seconds = estimateSeconds(m.turns.map(t => t.text).join(" "));
  if (seconds > MAX_SECONDS) return { ...base, skipped: `About ${seconds} s of speech: too long for one Dia call (limit about ${MAX_SECONDS} s). Shorten the line.` };
  const out: ScenePlan = { ...base, script, seconds, notes: m.notes, maxTokens: tokenCap(seconds) };
  const sample = sampleOf(p.people, m.who["[S1]"]);
  if (sample) {
    out.referenceAudio = sample.audio;
    out.referenceText = sample.text ? `[S1] ${cleanForDia(sample.text)}` : "";
    if (!sample.text) out.notes.push("The voice sample has no transcript, so the copy will be much worse.");
  }
  for (const n of m.speakers) {
    if (!n || key(n) === key(m.who["[S1]"]) || !sampleOf(p.people, n)) continue;
    out.notes.push(`${n}'s voice sample is not used: Dia takes one sample per scene, and only for the speaker who starts it.`);
  }
  if (out.referenceAudio) out.maxTokens = undefined; // the caller adds the sample's length (it needs the file's duration)
  return out;
}

export const planEpisode = (p: Pick<Project, "format" | "voice" | "people" | "voiceEngine">, ep: Pick<Episode, "number" | "scenes">, onlySceneId?: string): ScenePlan[] =>
  [...ep.scenes].sort((a, b) => a.number - b.number).filter(s => !onlySceneId || s.id === onlySceneId).map(s => planScene(p, ep, s));

/** The words a voice file was made from; compared with the scene now to tell when it is out of date. */
export const stampOf = (x: ScenePlan): string => x.script + (x.referenceAudio ? `|${x.referenceAudio}|${x.referenceText || ""}` : "");
export const voiceStamp = (p: Pick<Project, "format" | "voice" | "people" | "voiceEngine">, ep: Pick<Episode, "number">, s: Scene): string => stampOf(planScene(p, ep, s));

/** Token cap with a voice sample: Dia prefills the sample (about 86 tokens a second) inside the same budget. Undefined (no cap) when its length is unknown. */
export const tokenCapWithSample = (seconds: number, sampleSeconds: number | null): number | undefined =>
  sampleSeconds && sampleSeconds > 0 ? tokenCap(seconds) + Math.ceil(sampleSeconds * 86) + 100 : undefined;

/** Scenes as the UI sent them (the whole episodes array) keep the voice the job recorded meanwhile; an explicit null clears it. */
export function keepVoices<E extends { id: string; scenes: any[] }>(stored: E[] | undefined, incoming: E[]): E[] {
  if (!stored || !Array.isArray(incoming)) return incoming;
  return incoming.map(e => {
    const old = stored.find(x => x.id === e.id);
    if (!old || !Array.isArray(e.scenes)) return e;
    return { ...e, scenes: e.scenes.map((s: any) => {
      const o = old.scenes.find((x: any) => x.id === s?.id);
      if (!o || !s || typeof s !== "object") return s;
      const add: any = {};
      for (const k of ["voiceFile", "voiceText"]) if (!(k in s) && o[k] !== undefined) add[k] = o[k];
      return Object.keys(add).length ? { ...s, ...add } : s;
    }) };
  });
}
