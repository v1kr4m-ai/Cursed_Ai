/**
 * Reference photos belong to the whole series, not to one episode. Attach a person's photo once and
 * this puts it into every episode (episodes added later too), puts it in place of a picture ComfyUI was going to
 * make for the same person or name, and ticks it in the scenes it belongs to - so "Render what's missing" uses it
 * without any per-scene setup.
 */
import { api, fileUrl, type Episode, type Project, type Ref } from "./api";
import { kindOf } from "../../../../seriesTool/refKinds";

/** An attached photo has a file and no prompt: it is used as it is, never generated. */
export const isPhoto = (r: Ref) => !!r.file && !r.prompt.trim();

/** The photos to spread: every attached photo in the series, once per name (the first episode that has it wins). */
export function seriesPhotos(project: Project): Ref[] {
  const seen = new Map<string, Ref>();
  for (const ep of project.episodes) for (const r of ep.refs) if (isPhoto(r) && !seen.has(r.name)) seen.set(r.name, r);
  return [...seen.values()];
}

/** Whether a scene is about this person: named in its cast, or in its words. */
function mentions(sc: Episode["scenes"][number], who: string): boolean {
  const name = who.trim().toLowerCase();
  if (!name) return false;
  if ((sc.cast || []).some(c => c.trim().toLowerCase() === name)) return true;
  const words = `${sc.vo || ""} ${sc.shot || ""} ${sc.textCard || ""}`.toLowerCase();
  return new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(words);
}

async function copyPhoto(project: Project, episodeId: string, photo: Ref) {
  const blob = await (await fetch(fileUrl(photo.file!))).blob();
  const ext = (photo.file!.match(/\.[a-z0-9]+$/i)?.[0] || ".png").toLowerCase();
  await api.uploadRef(project.id, episodeId, new File([blob], photo.name.replace(/[^\w ()-]+/g, "_") + ext, { type: blob.type || "image/png" }), photo.name, photo.role, photo.kind, photo.person);
}

export interface SyncResult { project: Project; copied: number; wired: number }

/**
 * Makes every episode carry the series photos; replaces, in every episode, a picture ComfyUI was going to make for
 * the same name (or the same person) with the photo - in the scenes too; and ticks person photos in the scenes that
 * mention that person, and in scenes with no character picture at all. `slots` (the video workflow's picture inputs)
 * caps how many pictures a scene is given. Safe to run again.
 */
export async function syncPhotos(start: Project, extra: File[] = [], slots = Infinity): Promise<SyncResult> {
  let project = start;
  let copied = 0;
  // Photos picked before any plan existed go into the first episode.
  if (extra.length && project.episodes[0]) {
    for (const f of extra) { await api.uploadRef(project.id, project.episodes[0].id, f, f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60), "character", "person"); copied++; }
    project = await api.get(project.id);
  }
  const photos = seriesPhotos(project);
  if (!photos.length) return { project, copied, wired: 0 };

  for (const ep of project.episodes) {
    const have = new Set(ep.refs.filter(isPhoto).map(r => r.name));
    for (const p of photos) if (!have.has(p.name)) { await copyPhoto(project, ep.id, p); copied++; }
  }
  if (copied) project = await api.get(project.id);

  let wired = 0;
  const episodes: Episode[] = project.episodes.map(ep => {
    const mine = ep.refs.filter(isPhoto);
    // A made-to-order picture of the same name or person gives way to the photo: scenes switch to the photo.
    const swap = new Map<string, string>();
    for (const g of ep.refs.filter(r => !isPhoto(r))) {
      const ph = mine.find(p => p.name === g.name || (kindOf(p) === "person" && kindOf(g) === "person" && !!(p.person || "").trim() && [g.person, g.name].includes(p.person)));
      if (ph) swap.set(g.id, ph.id);
    }
    let scenes = ep.scenes.map(sc => ({ ...sc, refIds: sc.refIds.map(id => swap.get(id) || id).filter((id, i, a) => a.indexOf(id) === i) }));
    // Person photos go into the scenes that mention the person, and into scenes with no character picture yet.
    const people = mine.filter(r => kindOf(r) === "person");
    const refsLeft = ep.refs.filter(r => !swap.has(r.id));
    scenes = scenes.map(sc => {
      const hasCharacter = sc.refIds.some(id => refsLeft.find(r => r.id === id)?.role === "character");
      const add = people.filter(r => !sc.refIds.includes(r.id) && (!hasCharacter || mentions(sc, r.person || r.name)));
      const room = Math.max(0, slots - sc.refIds.length);
      if (!add.length || !room) return sc;
      wired++;
      return { ...sc, refIds: [...sc.refIds, ...add.slice(0, room).map(r => r.id)] };
    });
    if (swap.size) wired += swap.size;
    return { ...ep, refs: refsLeft, scenes };
  });
  if (wired) project = await api.patch(project.id, { episodes });
  return { project, copied, wired };
}
