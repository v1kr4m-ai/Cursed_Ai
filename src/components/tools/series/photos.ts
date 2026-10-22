/**
 * Reference photos belong to the whole series, not to one episode. Attach a person's photo once and
 * this puts it into every episode (episodes added later too) and wires it into every scene that has
 * no character picture yet, so the stills and clips are made from it without any per-scene setup.
 */
import { api, fileUrl, type Episode, type Project, type Ref } from "./api";
import { kindOf } from "../../../../seriesTool/refKinds";

/** An attached photo has a file and no prompt: it is used as it is, never generated. */
export const isPhoto = (r: Ref) => !!r.file && !r.prompt.trim();

/** The photos to spread: the attached ones of the first episode that has any. */
export function seriesPhotos(project: Project): Ref[] {
  const ep = project.episodes.find(e => e.refs.some(isPhoto));
  return ep ? ep.refs.filter(isPhoto) : [];
}

async function copyPhoto(project: Project, episodeId: string, photo: Ref) {
  const blob = await (await fetch(fileUrl(photo.file!))).blob();
  const ext = (photo.file!.match(/\.[a-z0-9]+$/i)?.[0] || ".png").toLowerCase();
  await api.uploadRef(project.id, episodeId, new File([blob], photo.name.replace(/[^\w ()-]+/g, "_") + ext, { type: blob.type || "image/png" }), photo.name, photo.role, photo.kind);
}

export interface SyncResult { project: Project; copied: number; wired: number }

/**
 * Makes every episode carry the series photos, and every scene that has no character picture use them.
 * Safe to run again: photos an episode already has (same name) are not copied twice.
 */
export async function syncPhotos(start: Project, extra: File[] = []): Promise<SyncResult> {
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

  // Wire: a scene with no character picture gets this episode's character photos.
  let wired = 0;
  const episodes: Episode[] = project.episodes.map(ep => {
    const mine = ep.refs.filter(r => isPhoto(r) && kindOf(r) === "person").map(r => r.id);
    if (!mine.length) return ep;
    return {
      ...ep,
      scenes: ep.scenes.map(sc => {
        const hasCharacter = sc.refIds.some(id => ep.refs.find(r => r.id === id)?.role === "character");
        if (hasCharacter) return sc;
        wired++;
        return { ...sc, refIds: [...sc.refIds, ...mine] };
      }),
    };
  });
  if (wired) project = await api.patch(project.id, { episodes });
  return { project, copied, wired };
}
