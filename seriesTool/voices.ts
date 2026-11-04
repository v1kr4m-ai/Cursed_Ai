/**
 * Several characters, each with their own voice. All optional: a project without `people` and scenes without
 * `lines` behave exactly as before (one project voice, one `vo` line per scene).
 */
export interface SceneLine { speaker?: string; text: string }
/** `refAudio`/`refText`: an optional voice sample (and what it says) the local Dia voice copies. */
export type PeopleVoices = Record<string, { voice?: string; refAudio?: string; refText?: string; gender?: Gender; builtinVoice?: string }>;
/** `gender` / `builtinVoice`: only used by XTTS to pick a built-in voice when the person has no sample. */
export type Gender = "female" | "male";

/** Gender a voice description implies ("a bright young woman", "deep baritone"), from simple word matches only; undefined when it says neither or both. */
export function inferGender(text?: string): Gender | undefined {
  const f = /\b(woman|women|girl|female|lady|she|her|soprano)\b/i.test(text || "");
  const m = /\b(man|men|boy|male|gentleman|he|his|deep|baritone|bass)\b/i.test(text || "");
  return f === m ? undefined : f ? "female" : "male";
}

/** True when the spoken voice is made locally (Dia or XTTS, in Produce) instead of by the video model. */
export const usesAiVoice = (p: { voiceEngine?: string }): boolean => p.voiceEngine === "dia" || p.voiceEngine === "xtts";

const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** A person's own voice description, or undefined (then the project voice applies). */
export function personVoice(people: PeopleVoices | undefined, name?: string): string | undefined {
  if (!people || !name) return undefined;
  const key = Object.keys(people).find(k => same(k, name));
  return (key && people[key]?.voice?.trim()) || undefined;
}

/** Lines from a planner answer or a saved scene: strings or {speaker,text}; blanks dropped; speaker optional. */
export function cleanLines(raw: unknown): SceneLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((l: any): SceneLine[] => {
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const text = (typeof l === "string" ? l : str(l?.text) || str(l?.vo) || str(l?.line)).trim();
    const speaker = l && typeof l === "object" ? (str(l.speaker) || str(l.name)).trim() : "";
    return text ? [speaker ? { speaker, text } : { text }] : [];
  });
}

/** Lines from a planner answer: cleaned, at most 12, text capped at 600 characters and speaker at 60. */
export const importLines = (raw: unknown): SceneLine[] => cleanLines(raw).slice(0, 12).map(l => ({ ...(l.speaker ? { speaker: l.speaker.slice(0, 60) } : {}), text: l.text.slice(0, 600) }));

/** The plain spoken text of a scene's lines (kept in `vo` so subtitles and word counts keep working). */
export const joinLines = (lines: SceneLine[]): string => lines.map(l => l.text.trim()).filter(Boolean).join(" ");

/** Whether the lines need the per-speaker wording (a named speaker or more than one line); otherwise `vo` is used as before. */
export const isMultiSpeaker = (lines?: SceneLine[]): boolean => Array.isArray(lines) && lines.length > 0 && (lines.length > 1 || !!lines[0].speaker);

/** Adds or removes a descriptor word in a free-text voice ("warm, a low raspy voice"). */
export function toggleVoiceWord(text: string | undefined, word: string): string {
  const parts = (text || "").split(/,\s*/).map(x => x.trim()).filter(Boolean);
  return (parts.includes(word) ? parts.filter(x => x !== word) : [...parts, word]).join(", ");
}

/** The planner is told who speaks with which voice. Empty when nobody has a voice set. */
export function voiceCastInstruction(names: string[], people: PeopleVoices | undefined): string {
  const withVoice = names.filter(n => personVoice(people, n));
  if (!withVoice.length) return "";
  return `- Dialogue: when more than one person speaks in a scene, add "lines": [{"speaker": "Name", "text": "what they say"}, ...] using exactly these names: ${names.join(", ")}; keep "vo" as all the spoken words joined. A scene with one narrator or one speaker needs no "lines".`
    + ` Voices: ${withVoice.map(n => `${n} - ${personVoice(people, n)}`).join("; ")}. Write each person's words to suit their voice.`;
}

/** `people` after renaming a person: their entry moves to the new name; if that name already has an entry, the existing one is kept. Same object when nothing changes. */
export function rekeyPeople<T>(people: Record<string, T> | undefined, from: string, to: string): Record<string, T> | undefined {
  const key = people && Object.keys(people).find(k => same(k, from));
  if (!people || key === undefined || key === to) return people;
  const { [key]: moved, ...rest } = people;
  return Object.keys(rest).some(k => same(k, to)) ? rest : { ...rest, [to]: moved };
}
