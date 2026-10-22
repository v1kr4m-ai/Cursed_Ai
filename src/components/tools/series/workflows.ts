/**
 * Checks that the ComfyUI workflows a series uses can do what the series needs.
 *
 * A still made from a person's photo needs an image workflow with a reference-picture slot; a clip
 * made from reference pictures needs a video workflow with enough slots. Both must also be runnable
 * at all (a workflow that points at nodes missing from its file never runs). These checks say so in
 * words and name workflows that would work, instead of letting a render fail or ignore the photo.
 */
import React from "react";
import type { Project } from "./api";

export interface WfInfo {
  name: string;
  path: string;
  refImageCount: number;
  refImageLabels?: string[];
  isRunnable: boolean;
  missing: string[];
  outputKind: string;
  /** False for workflows that edit a picture rather than make one from a prompt (upscalers, face tools). */
  needsPrompt?: boolean;
  /** Per reference slot: can the workflow run with that slot left empty? */
  refImageBypassable?: boolean[];
}

export type Level = "ok" | "warn" | "bad";
export interface Verdict { level: Level; text: string }

const cache: Partial<Record<"image" | "video", Promise<WfInfo[]>>> = {};

/** The workflows in the folder the Image and Video tabs use, one kind at a time. Asked once, then remembered until refresh. */
export function fetchWorkflows(kind: "image" | "video", force = false): Promise<WfInfo[]> {
  if (force || !cache[kind]) {
    cache[kind] = fetch(`/api/tool/workflows?kind=${kind}`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || "Could not list workflows."); return (d.workflows || []) as WfInfo[]; })
      .catch(e => { delete cache[kind]; throw e; });
  }
  return cache[kind]!;
}

const norm = (p: string) => p.replace(/\//g, "\\").toLowerCase();
export const findWorkflow = (list: WfInfo[], path: string) => list.find(w => norm(w.path) === norm(path));

/** Does this series feed a person's photo into its stills? Attached photos or an on-camera style say yes. */
export function wantsPhoto(project: Project): boolean {
  const onCamera = project.format === "ugc" || project.format === "vlog";
  return onCamera || project.episodes.some(e => e.refs.some(r => r.file && !r.prompt.trim()));
}

/** The most reference pictures any one scene uses. */
export const maxSceneRefs = (project: Project) => Math.max(0, ...project.episodes.flatMap(e => e.scenes.map(s => s.refIds.length)));

/** A UI-format workflow can only be read while ComfyUI is running; that is a "start ComfyUI", not a broken workflow. */
const needsComfy = (w: WfInfo) => w.missing.some(m => /start ComfyUI/i.test(m));
const firstReason = (w: WfInfo) => (w.missing[0] || "unknown reason").replace(/\s+/g, " ").slice(0, 160);

export function judgeImage(info: WfInfo | undefined, path: string, photo: boolean): Verdict {
  if (!path) return { level: "bad", text: "No workflow chosen for the stills." };
  if (!info) return { level: "warn", text: "This file is not in your workflow folder, so it cannot be checked." };
  if (needsComfy(info)) return { level: "warn", text: "Start ComfyUI so this workflow can be checked." };
  if (!info.isRunnable) return { level: "bad", text: `This workflow cannot run: ${firstReason(info)}.` };
  if (photo && info.refImageCount < 1) return { level: "bad", text: "This workflow has no slot for a reference photo, so the stills will not look like your photo." };
  if (photo) return { level: "ok", text: `Takes ${info.refImageCount} reference photo${info.refImageCount > 1 ? "s" : ""}: your attached photos are fed in.` };
  return { level: "ok", text: info.refImageCount ? `Runs. It also has ${info.refImageCount} reference slot${info.refImageCount > 1 ? "s" : ""} for photos.` : "Runs (text to image)." };
}

export function judgeVideo(info: WfInfo | undefined, path: string, needed: number): Verdict {
  if (!path) return { level: "bad", text: "No workflow chosen for the clips." };
  if (!info) return { level: "warn", text: "This file is not in your workflow folder, so it cannot be checked." };
  if (needsComfy(info)) return { level: "warn", text: "Start ComfyUI so this workflow can be checked." };
  if (!info.isRunnable) return { level: "bad", text: `This workflow cannot run: ${firstReason(info)}.` };
  if (needed > 0 && info.refImageCount === 0) return { level: "warn", text: "No reference-picture slot was found in this workflow, so the pictures may not be used (text-to-video)." };
  if (needed > 0 && info.refImageCount < needed) return { level: "bad", text: `Takes ${info.refImageCount} reference picture${info.refImageCount === 1 ? "" : "s"} but a scene uses ${needed}. Remove a reference from that scene or pick a workflow with more slots.` };
  return { level: "ok", text: `Takes ${info.refImageCount} reference picture${info.refImageCount === 1 ? "" : "s"}; your scenes use up to ${needed}.` };
}

/** Workflows that would pass the check, simplest first. */
export function suggestions(list: WfInfo[], kind: "image" | "video", opts: { photo?: boolean; needed?: number }): WfInfo[] {
  const need = kind === "image" ? (opts.photo ? 1 : 0) : Math.max(1, opts.needed || 1);
  return list
    .filter(w => w.isRunnable && w.needsPrompt !== false && !/upscal|expression|face ?swap|inpaint|outpaint|train/i.test(w.name) && w.refImageCount >= need)
    .sort((a, b) => a.refImageCount - b.refImageCount || (a.name < b.name ? -1 : 1))
    .slice(0, 4);
}

/** What one workflow offers (slots, which can be skipped), once the list has loaded. */
export function useWorkflowInfo(kind: "image" | "video", path: string): WfInfo | undefined {
  const [info, setInfo] = React.useState<WfInfo | undefined>();
  React.useEffect(() => { let live = true; fetchWorkflows(kind).then(l => { if (live) setInfo(findWorkflow(l, path)); }).catch(() => {}); return () => { live = false; }; }, [kind, path]);
  return info;
}
