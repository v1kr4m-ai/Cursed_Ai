/**
 * The shape of a series project: an idea, the discussion that shaped it, the episodes it was
 * broken into, the scenes inside each episode, and the reference stills that keep characters
 * and grade consistent across scenes.
 *
 * One project = one folder on disk. project.json holds everything below; refs/, clips/ and
 * exports/ hold the media it points at.
 */

export type Status = "pending" | "queued" | "running" | "done" | "failed";

/** A reference still. `style` plates are wired as <Picture 1> in every scene of their episode. */
export interface Ref {
  id: string;
  name: string;
  role: "style" | "character";
  /** What the picture is for (person, outfit, product, location, pose, prop, palette, style); see refKinds.ts. Older refs have only a role. */
  kind?: string;
  prompt: string;
  negative: string;
  seed: number;
  /** Attached photos this still is made from (image-to-image). Empty: the episode's attached photos. */
  fromRefIds?: string[];
  /** Absolute path once rendered. */
  file: string | null;
  status: Status;
  error: string | null;
}

export interface Scene {
  id: string;
  number: number;
  /** One line of narration, 18-22 words for a ~7 second clip. */
  vo: string;
  /** What the camera sees and does. */
  shot: string;
  /** Burned-in text card, blank for none. */
  textCard: string;
  /** Ref ids in connection order: these become <Picture 1>..<Picture N> in the prompt. */
  refIds: string[];
  seed: number;
  /** The assembled prompt actually sent to ComfyUI. Editable - regenerating does not overwrite edits. */
  promptText: string;
  promptEdited: boolean;
  status: Status;
  clipPath: string | null;
  durationS: number | null;
  promptId: string | null;
  error: string | null;
}

import type { Subtitles } from "./subtitlesCore";
import { formatOf, sceneFields } from "./formats";
import { kindOf, refKindInfo, REF_KINDS } from "./refKinds";
import type { AudioMix, Output } from "./finishCore";

export interface Episode {
  id: string;
  number: number;
  title: string;
  /** What period or thread this episode covers - shown on the card, also fed to the planner. */
  era: string;
  /** The closing line that pulls the viewer into the next episode. */
  hookOut: string;
  refs: Ref[];
  scenes: Scene[];
  exportPath: string | null;
  /** Captions for the joined episode: cues, their look, and the burned-in copy once made. */
  subtitles?: Subtitles;
  /** When the episode was last exported to a folder. */
  exportedAt?: string;
  /** Sound added to the episode and where it starts. */
  audio?: AudioMix;
  /** Every finished version of the video (joined, with subtitles, with audio, both) with when it was made. */
  outputs?: Output[];
  /** Which version the user pinned as the final one; otherwise the newest counts. */
  finalKind?: string;
}

export interface ProjectSettings {
  comfyUrl: string;
  /** Absolute path to the ComfyUI workflow used for scenes (reference-to-video). */
  videoWorkflow: string;
  /** Absolute path to the workflow used for reference stills (text-to-image). */
  imageWorkflow: string;
  width: number;
  height: number;
  seconds: number;
  steps: number;
  fps: number;
}

/** A story, outline or spreadsheet written outside the app and attached as planning material. */
export interface Source {
  id: string;
  name: string;
  /** Extracted plain text - PDFs, Word, Excel and images (OCR) all arrive here as text. */
  text: string;
  addedAt: string;
  /**
   * A model-written outline of `text`, produced chunk by chunk when the document is too long to
   * hand to the planner whole. The planner prefers this when it exists.
   */
  digest?: string;
  digestedAt?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface Project {
  id: string;
  title: string;
  dir: string;
  createdAt: string;
  updatedAt: string;
  idea: { logline: string; audience: string; tone: string; notes: string };
  discussion: Message[];
  /** Pasted into every scene prompt verbatim so the look does not drift between clips. */
  styleLock: string;
  /** Narrator identity, restated in every scene prompt for the same reason. */
  voiceLock: string;
  settings: ProjectSettings;
  episodes: Episode[];
  /** Optional; older project.json files predate it. */
  sources?: Source[];
  /** What kind of video this is (see formats.ts). Missing means narration. */
  format?: string;
  /** Burn each scene's text card into the picture. Off by default: captions are added later in Assemble. */
  allowTextCards?: boolean;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  comfyUrl: "http://127.0.0.1:8188",
  videoWorkflow: "",
  imageWorkflow: "",
  width: 544,
  height: 928,
  seconds: 7,
  steps: 12,
  fps: 24,
};

export const DEFAULT_STYLE_LOCK =
  "Live-action, cinematic, filmed in vertical 9:16 framing, desaturated cold color grade with deep blacks, " +
  "heavy volumetric haze, handheld-stabilized documentary realism, shallow depth of field.";

export const DEFAULT_VOICE_LOCK =
  "a narrator with a deep, gravelly, slow-paced voice and a neutral British accent (S1)";

export const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * MiniMax H3 only accepts frame counts on a 17k+5 grid, so a requested duration snaps up to the
 * next valid count. 7 s -> 175 frames (7.29 s at 24 fps).
 */
export function snapFrames(seconds: number, fps: number): number {
  const frames = Math.max(5, Math.round(seconds * fps));
  // JS keeps the sign of the dividend, so the remainder is normalised back into 0..16 before
  // it is added - without this a 7 second clip snaps *down* to 158 frames instead of up to 175.
  return frames + (((5 - (frames % 17)) % 17) + 17) % 17;
}

/** The prompt text sent to ComfyUI: reference wiring, then the three fields the model expects. */
export function buildScenePrompt(project: Project, episode: Episode, scene: Scene): string {
  const refs = scene.refIds.map(id => episode.refs.find(r => r.id === id)).filter(Boolean) as Ref[];
  const wiring = refs.map((ref, i) => {
    const picture = `<Picture ${i + 1}>`;
    const info = refKindInfo(kindOf(ref)) || REF_KINDS[0];
    // A plain character ref keeps its original wording: appearance, clothing and proportions.
    return !ref.kind && ref.role === "character"
      ? `Use ${picture} as the exact appearance reference for ${ref.name}, preserving appearance, clothing and proportions.`
      : info.wiring(picture, ref.name);
  }).join(" ");

  const format = formatOf(project.format);
  // The default narrator is for narration; an on-camera format needs a person's voice instead.
  const voice = format.voice && project.voiceLock === DEFAULT_VOICE_LOCK ? format.voice : project.voiceLock;
  const fields = sceneFields({ format, look: project.styleLock, voice, line: scene.vo, shot: scene.shot, card: scene.textCard, allowCard: !!project.allowTextCards });

  return [wiring, "", fields.description, fields.soundscape, fields.music].join("\n");
}

/** Episode progress, used for the dashboard bars and the checklist. */
export function episodeProgress(ep: Episode) {
  const refsDone = ep.refs.filter(r => r.status === "done").length;
  const scenesDone = ep.scenes.filter(s => s.status === "done").length;
  return {
    refsDone,
    refsTotal: ep.refs.length,
    scenesDone,
    scenesTotal: ep.scenes.length,
    stitched: !!ep.exportPath,
    complete: ep.scenes.length > 0 && scenesDone === ep.scenes.length,
  };
}
