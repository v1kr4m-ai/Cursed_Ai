/**
 * Which pictures feed a reference still's image workflow.
 *
 * A "Text 2 Img using Ref Img" workflow draws a new still of the person in a photo. Without the photo
 * it draws somebody else, so every still is given the episode's attached photos: the character photos
 * first (the face to keep), then style photos. A still can name its own photos with fromRefIds.
 */
import fs from "fs";
import type { Episode, Ref } from "./model";
import { kindRank } from "./refKinds";

/** An attached photo is a ref that has a file but no prompt: it is used as-is, never generated. */
export const isAttachedPhoto = (r: Ref) => !!r.file && !r.prompt.trim();

export function refSourceFiles(episode: Episode, ref: Ref): string[] {
  const named = (ref.fromRefIds || []).map(id => episode.refs.find(r => r.id === id)).filter((r): r is Ref => !!r && !r.skip);
  const pool = named.length
    ? named
    // A still of one person is made from that person's photos (and from pictures that belong to nobody, such as an outfit), never from another person's.
    : episode.refs.filter(r => r.id !== ref.id && isAttachedPhoto(r) && !r.skip && (!ref.person || !r.person || r.person === ref.person)).sort((a, b) => kindRank(a) - kindRank(b));
  return pool.map(r => r.file!).filter(f => fs.existsSync(f));
}

/**
 * One file per reference slot of a workflow. A slot with no picture is left blank when the workflow can bypass it;
 * a slot that cannot be bypassed repeats the first picture instead, because a blank one would stop the run.
 */
export function fillSlots(files: string[], bypassable: boolean[] | undefined, slots: number): string[] {
  return Array.from({ length: slots }, (_, i) => files[i] ?? (bypassable?.[i] || !files.length ? "" : files[i % files.length]));
}
