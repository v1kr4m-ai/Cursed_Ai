/**
 * Renaming and adding the named slots of Produce (the reference cards: a person, place, outfit, object...).
 * Scenes point at a card by id, so the card keeps its picture and its place in every scene; what changes is the
 * name itself and the places that spell it out: scene cast, shot, line, text card and the assembled prompt.
 */
import type { Episode, Ref } from "./api";
import { kindOf, refKindInfo } from "../../../../seriesTool/refKinds";

const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const wordChar = (c?: string) => !!c && /[A-Za-z0-9']/.test(c);
/** Whole-name, case-insensitive replace ("Ann" does not touch "Anna"). */
export function replaceName(text: string, from: string, to: string): string {
  const needle = from.trim().toLowerCase();
  if (!text || !needle) return text;
  const hay = text.toLowerCase();
  let out = "", at = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, at)) {
    const end = i + needle.length;
    if (wordChar(text[i - 1]) || wordChar(text[end])) { out += text.slice(at, end); } else { out += text.slice(at, i) + to; }
    at = end;
  }
  return out + text.slice(at);
}

/** The episodes after giving a reference a new name; unchanged when the name is empty or the same. */
export function renameRef(episodes: Episode[], episodeId: string, refId: string, rawName: string): Episode[] {
  const name = rawName.trim();
  const ref = episodes.find(e => e.id === episodeId)?.refs.find(r => r.id === refId);
  if (!ref || !name || name === ref.name) return episodes;
  const old = ref.name;
  // A person is one name shared by all their pictures in every episode: rename them all together.
  const wholePerson = kindOf(ref) === "person" && same(ref.person || ref.name, ref.name);
  const swap = (t: string) => replaceName(t, old, name);
  return episodes.map(e => {
    if (!wholePerson && e.id !== episodeId) return e;
    return {
      ...e,
      refs: e.refs.map(r => {
        if (wholePerson) return same(r.name, old) || same(r.person, old) ? { ...r, name: same(r.name, old) ? name : r.name, person: same(r.person, old) ? name : r.person } : r;
        return r.id === refId ? { ...r, name } : r;
      }),
      scenes: e.scenes.map(sc => ({
        ...sc,
        shot: swap(sc.shot), vo: swap(sc.vo), textCard: swap(sc.textCard), promptText: swap(sc.promptText),
        cast: sc.cast?.map(c => (same(c, old) ? name : c)),
      })),
    };
  });
}

/** A new, empty slot for an episode (render it from a prompt, or drop a photo on it). Name made unique within the episode. */
export function newRef(ep: Episode, kind: string, baseName = "New reference", id = Math.random().toString(36).slice(2, 10)): Ref {
  const info = refKindInfo(kind) || refKindInfo("person")!;
  let name = baseName, n = 2;
  while (ep.refs.some(r => same(r.name, name))) name = `${baseName} ${n++}`;
  return { id, name, role: info.role, kind: info.id, prompt: "", negative: "", seed: Math.floor(Math.random() * 100000), file: null, status: "pending", error: null };
}
