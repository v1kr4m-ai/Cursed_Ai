/**
 * Which pictures feed a reference still's image workflow.
 *
 * A "Text 2 Img using Ref Img" workflow draws a new still of the person in a photo. Without the photo
 * it draws somebody else, so every still is given the episode's attached photos: the character photos
 * first (the face to keep), then style photos. A still can name its own photos with fromRefIds.
 */
import fs from "fs";
import type { Episode, Ref } from "./model";

/** An attached photo is a ref that has a file but no prompt: it is used as-is, never generated. */
export const isAttachedPhoto = (r: Ref) => !!r.file && !r.prompt.trim();

export function refSourceFiles(episode: Episode, ref: Ref): string[] {
  const named = (ref.fromRefIds || []).map(id => episode.refs.find(r => r.id === id)).filter((r): r is Ref => !!r);
  const pool = named.length
    ? named
    : [...episode.refs.filter(r => r.id !== ref.id && isAttachedPhoto(r) && r.role === "character"),
       ...episode.refs.filter(r => r.id !== ref.id && isAttachedPhoto(r) && r.role === "style")];
  return pool.map(r => r.file!).filter(f => fs.existsSync(f));
}
