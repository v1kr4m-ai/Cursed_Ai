/**
 * "Talking video" for one scene: the scene's made voice (Dia / XTTS wav) + a picture of the speaker go through the user's
 * ComfyUI workflow "Wan 2.2 S2V 14B", so the character visibly speaks with lip-sync, and that clip becomes the scene's clip.
 * The pure decisions live here (no Node imports: the browser uses them too); the job is in routes.ts.
 */
import { kindOf } from "./refKinds";

export const TALK_WORKFLOW = "Video - Image and voice to talking video (Wan 2.2 S2V 14B).json";
/** The workflow makes video in chunks of 77 frames at 16 fps: a first chunk and two "extend" chunks, at most. Three frames of the start are dropped. */
export const TALK_FPS = 16;
export const CHUNK_FRAMES = 77;
export const MAX_CHUNKS = 3;
const DROPPED_FRAMES = 3;
/** The longest voice one talking clip can carry (seconds). */
export const MAX_TALK_SECONDS = (MAX_CHUNKS * CHUNK_FRAMES - DROPPED_FRAMES) / TALK_FPS;
/** Silence kept after the last word. */
export const TALK_TAIL = 0.25;

/** Shown before the person confirms: 14B (fp8) on an 8 GB card swaps models in and out of memory and is slow. */
export const TALK_WARNING = "Wan 2.2 S2V 14B is a heavy model. Measured on an 8 GB card: about 3 minutes for a 4 second voice (one 5 second chunk, small 640 px video); a longer voice needs more chunks and takes longer (not timed yet), up to "
  + `${Math.floor(MAX_TALK_SECONDS)} seconds (a longer voice is refused, nothing is cut). The graphics card is busy the whole time (other renders and voices wait) and a longer or bigger run can run out of memory.`;

export interface TalkPlan { chunks: number; tooLong: boolean; maxSeconds: number }

/** How many 77-frame chunks cover `voiceSeconds` of speech (1..3), and whether the voice is longer than the workflow can carry. */
export function planTalking(voiceSeconds: number): TalkPlan {
  const need = Math.max(1, Math.ceil((voiceSeconds * TALK_FPS + DROPPED_FRAMES) / CHUNK_FRAMES));
  return { chunks: Math.min(MAX_CHUNKS, need), tooLong: voiceSeconds > MAX_TALK_SECONDS, maxSeconds: MAX_TALK_SECONDS };
}

/** The video size for the model: the project's shape with the long side at 640 (kept small for an 8 GB card), both sides a multiple of 16. */
export function talkingSize(width: number, height: number, longSide = 640): { width: number; height: number } {
  const scale = longSide / Math.max(width, height, 1);
  const snap = (v: number) => Math.max(256, Math.round((v * scale) / 16) * 16);
  return { width: snap(width), height: snap(height) };
}

/** Shortest graph for fewer chunks: the last "extend" nodes are bypassed by pointing the final cut/concat at an earlier latent (the rest is pruned before the run). False when the graph is not the known layout. */
export function limitChunks(graph: Record<string, any>, chunks: number): boolean {
  const last = chunks <= 1 ? "3" : chunks === 2 ? "79:78" : "";
  if (!last || !graph["85:78"] || !graph[last] || graph["94"]?.class_type !== "LatentCut" || graph["95"]?.class_type !== "LatentConcat") return false;
  for (const [id, key] of [["94", "samples"], ["95", "samples2"]] as const) {
    const link = graph[id].inputs?.[key];
    if (!Array.isArray(link) || link.length !== 2 || link[0] !== "85:78") return false;
  }
  graph["94"].inputs.samples = [last, 0];
  graph["95"].inputs.samples2 = [last, 0];
  return true;
}

export interface PicRef { id: string; name: string; role: "style" | "character"; kind?: string; person?: string; skip?: boolean; prompt: string; file: string | null }
export interface TalkScene { refIds: string[]; cast?: string[]; lines?: { speaker?: string; text: string }[] }

const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Who speaks first in the scene (the picture is of them): the first line with a speaker, else the first of the cast. */
export const speakerOf = (s: TalkScene): string | undefined => s.lines?.find(l => l.speaker?.trim())?.speaker?.trim() || s.cast?.find(c => c.trim())?.trim();

/**
 * The picture to animate: a person picture of the speaker ticked in the scene (an attached photo before a made still);
 * failing that the speaker's picture elsewhere in the episode; with nobody named, the scene's first person picture.
 * `exists` says whether a file is on disk. Returns the picture or the reason there is none.
 */
export function pickTalkingPicture(refs: PicRef[], scene: TalkScene, exists: (file: string) => boolean): { ref: PicRef } | { reason: string } {
  const usable = (r?: PicRef): r is PicRef => !!r && !r.skip && !!r.file && exists(r.file) && kindOf(r) === "person";
  const attachedFirst = (list: PicRef[]) => [...list.filter(r => !r.prompt.trim()), ...list.filter(r => r.prompt.trim())];
  const speaker = speakerOf(scene);
  const inScene = attachedFirst(scene.refIds.map(id => refs.find(r => r.id === id)).filter(usable));
  const rest = attachedFirst(refs.filter(r => !scene.refIds.includes(r.id)).filter(usable));
  const isSpeaker = (r: PicRef) => same(r.person, speaker) || same(r.name, speaker);
  const found = speaker
    ? inScene.find(isSpeaker) || inScene.find(r => !r.person) || rest.find(isSpeaker)
    : inScene[0];
  if (found) return { ref: found };
  return { reason: speaker
    ? `There is no picture of ${speaker} to animate. Attach or make a Person / face picture for ${speaker} and tick it in this scene.`
    : "There is no picture of a speaker to animate. Tick a Person / face picture (rendered or attached) in this scene." };
}

/** The prompt for the talking model: the picture sets who and where, the text says what the shot is. */
export function talkingPrompt(shot: string, look: string): string {
  return ["A person speaks naturally to the camera with clear lip-synced mouth movement and a lively expression.", shot.trim(), look.trim()].filter(Boolean).join(" ").slice(0, 700);
}

/** A scene whose current clip is the talking clip (a take picked later makes it false, with nothing else to clear). */
export const isTalking = (s: { talkingClip?: string | null; clipPath: string | null }): boolean => !!s.talkingClip && s.talkingClip === s.clipPath;

/** The talking clip was made from an older voice than the scene has now (the voice was redone). */
export const talkingStale = (s: { talkingClip?: string | null; clipPath: string | null; voiceText?: string; talkingVoice?: string }): boolean => isTalking(s) && (s.voiceText ?? "") !== (s.talkingVoice ?? "");

/** The voice file to mix over a scene's clip when joining: none for a talking clip, which already carries the voice, so it is not laid on twice. */
export const joinVoice = (s: { voiceFile?: string; talkingClip?: string | null; clipPath: string | null }): string | undefined => (isTalking(s) ? undefined : s.voiceFile);
