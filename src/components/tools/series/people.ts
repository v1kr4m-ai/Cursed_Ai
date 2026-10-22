/**
 * Several people in one series. A person is a name shared by that person's pictures (a photo marked "Person"
 * with a name). From those names the series knows who exists, gives each person a still made only from their own
 * photos, and puts the right people in each scene, so two characters never get each other's face.
 */
import type { Episode, Project, Ref, Scene } from "./api";
import { kindOf } from "../../../../seriesTool/refKinds";

const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const isPhoto = (r: Ref) => !!r.file && !r.prompt.trim();
const newId = () => Math.random().toString(36).slice(2, 10);

export interface Person { name: string; photos: Ref[] }

/** The people of the series, in the order they were first named, each with their attached photos (from the first episode that has them). */
export function peopleOf(project: Project): Person[] {
  const out: Person[] = [];
  for (const ep of project.episodes) for (const r of ep.refs) {
    if (!r.person) continue;
    let p = out.find(x => same(x.name, r.person));
    if (!p) { p = { name: r.person.trim(), photos: [] }; out.push(p); }
    if (isPhoto(r) && !p.photos.some(x => x.name === r.name)) p.photos.push(r);
  }
  return out;
}

/** The line the planner is given when people are named. */
export function castInstruction(people: Person[]): string {
  if (!people.length) return "";
  return `Cast - these are the people of the series, with their own photos: ${people.map(p => p.name).join(", ")}. `
    + `Every scene gets a "cast" list with the names of the people who appear in it, written exactly as above (one name for a solo scene, several when they share it). `
    + `Do not write a ref for the people: each person's picture is added automatically. Write only the style_plate, plus refs for places, products or outfits if a scene needs them.`;
}

/** The still that stands for a person in an episode: a generated character ref, not an attached photo. */
const stillOf = (ep: Episode, name: string) => ep.refs.find(r => !!r.prompt.trim() && kindOf(r) === "person" && (same(r.person, name) || same(r.name, name)));

const DEFAULT_STILL = "Keep the exact face, hair, skin tone and identity of the person in image 1. The person stands naturally and smiles at the camera. Natural selfie-style photo, soft natural light, sharp, realistic, vertical.";
const DEFAULT_NEGATIVE = "different face, extra fingers, distorted hands, text, captions, subtitles, watermark, logo, blurry, cartoon";

/**
 * Gives every person a still in every episode (made from that person's own photos) and sets each scene's pictures
 * from its cast: style pictures first, then the people in cast order, then anything else. Scenes without a cast are left alone.
 */
export function ensureCast(project: Project): Episode[] {
  const people = peopleOf(project);
  if (!people.length) return project.episodes;
  return project.episodes.map(ep => {
    let refs = ep.refs.map(r => ({ ...r }));
    for (const person of people) {
      const photos = refs.filter(r => isPhoto(r) && same(r.person, person.name) && kindOf(r) === "person");
      const still = refs.find(r => !!r.prompt.trim() && kindOf(r) === "person" && (same(r.person, person.name) || same(r.name, person.name)));
      if (still) { still.person = person.name; if (!still.fromRefIds?.length && photos.length) still.fromRefIds = photos.map(p => p.id); }
      else if (photos.length) refs.push({ id: newId(), name: person.name, role: "character", kind: "person", person: person.name, prompt: DEFAULT_STILL, negative: DEFAULT_NEGATIVE, seed: Math.floor(Math.random() * 100000), fromRefIds: photos.map(p => p.id), file: null, status: "pending", error: null });
    }
    const draft: Episode = { ...ep, refs };
    const scenes = ep.scenes.map(sc => placeCast(draft, sc, people));
    return { ...draft, scenes };
  });
}

/** One scene's picture list from its cast. */
export function placeCast(ep: Episode, scene: Scene, people: Person[]): Scene {
  const cast = (scene.cast || []).filter(n => people.some(p => same(p.name, n)));
  if (!cast.length) return scene;
  const isPersonRef = (r: Ref) => kindOf(r) === "person" && !!r.person;
  const mine = cast.map(n => stillOf(ep, n) || ep.refs.find(r => isPhoto(r) && same(r.person, n))).filter((r): r is Ref => !!r);
  // Every named person is replaced by this scene's cast; pictures that belong to nobody (style, outfit, place) stay where they were.
  const keep = scene.refIds.map(id => ep.refs.find(r => r.id === id)).filter((r): r is Ref => !!r && !isPersonRef(r));
  const style = keep.filter(r => r.role === "style");
  const rest = keep.filter(r => r.role !== "style");
  return { ...scene, refIds: [...style, ...mine, ...rest].map(r => r.id) };
}

/** Renames a person everywhere (all their photos and stills, and the casts of scenes). */
export function renamePerson(project: Project, from: string, to: string): Episode[] {
  const name = to.trim();
  if (!name) return project.episodes;
  return project.episodes.map(ep => ({
    ...ep,
    refs: ep.refs.map(r => (same(r.person, from) ? { ...r, person: name, ...(same(r.name, from) ? { name } : {}) } : r)),
    scenes: ep.scenes.map(sc => (sc.cast?.some(n => same(n, from)) ? { ...sc, cast: sc.cast.map(n => (same(n, from) ? name : n)) } : sc)),
  }));
}

/** Skip or use a picture everywhere it was copied (same name and person in every episode). */
export function setSkip(project: Project, ref: Ref, skip: boolean): Episode[] {
  return project.episodes.map(ep => ({ ...ep, refs: ep.refs.map(r => (r.name === ref.name && (r.person || "") === (ref.person || "") && isPhoto(r) === isPhoto(ref) ? { ...r, skip } : r)) }));
}
