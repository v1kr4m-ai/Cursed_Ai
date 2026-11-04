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

// ---------------------------------------------------------- several speakers in one scene (XTTS voices only: Dia makes one file, so its turn timing is unknown)

/** One speaker's turn of a scene voice made by XTTS, kept as its own file (voice/<sceneId>_t<N>.wav). `speaker` "" = narrator. */
export interface VoiceTurn { speaker: string; file: string; seconds: number }
/** The silence between turns in the joined scene voice (buildJoinArgs); the talking clips keep it so picture and sound stay in sync with that voice. */
export const TURN_GAP = 0.35;
/** About how long one render takes on this 8 GB card (measured on a 4 s voice; longer ones take longer). */
export const MINUTES_PER_RENDER = 3;
const spk = (s?: string) => (s || "").trim().toLowerCase();

/** True when the kept turns are by two or more different speakers: only then is a talking scene rendered turn by turn. */
export const isMultiSpeaker = (turns?: VoiceTurn[]): boolean => !!turns && new Set(turns.map(t => spk(t.speaker))).size >= 2;

/** The kept turns still belong to the voice file: their lengths plus the join gaps add up to the file's length (a Dia redo or a copied project can leave older turns behind). */
export const turnsMatchVoice = (turns: VoiceTurn[], voiceSeconds: number, tolerance = 0.1): boolean =>
  turns.length > 0 && Math.abs(turns.reduce((n, t) => n + t.seconds, 0) + TURN_GAP * (turns.length - 1) - voiceSeconds) <= tolerance;

/** How long to cut each piece so the pieces together keep the joined voice's timing: piece i ends at the running end time rounded to a 1/16 s frame, so rounding never adds up. `seconds` are the renders' lengths. */
export function pieceLengths(seconds: number[], fps = TALK_FPS): number[] {
  let end = 0, prev = 0;
  return seconds.map((s, i) => {
    end += s + (i < seconds.length - 1 ? TURN_GAP : TALK_TAIL);
    const frames = Math.round(end * fps);
    const len = (frames - prev) / fps;
    prev = frames;
    return len;
  });
}

export interface TurnRender { speaker: string; files: string[]; seconds: number }

/** The renders for a multi-speaker scene: one per turn, but neighbouring turns of one speaker are merged while the whole still fits one clip. Or the reason a turn is too long (nothing is cut). */
export function planTurnRenders(turns: VoiceTurn[]): { renders: TurnRender[]; chunks: number } | { reason: string } {
  const renders: TurnRender[] = [];
  for (const t of turns) {
    const last = renders[renders.length - 1];
    if (last && spk(last.speaker) === spk(t.speaker) && last.seconds + TURN_GAP + t.seconds <= MAX_TALK_SECONDS) { last.files.push(t.file); last.seconds += TURN_GAP + t.seconds; }
    else renders.push({ speaker: t.speaker, files: [t.file], seconds: t.seconds });
  }
  const long = renders.findIndex(r => planTalking(r.seconds).tooLong);
  if (long >= 0) return { reason: `${renders[long].speaker || "The narrator"}'s turn (${renders[long].seconds.toFixed(1)} s) is longer than the ${MAX_TALK_SECONDS.toFixed(1)} s one talking clip can carry. Nothing is cut: shorten that speaker's lines or split the scene, then make the voice again.` };
  return { renders, chunks: renders.reduce((n, r) => n + planTalking(r.seconds).chunks, 0) };
}

/** The picture for one speaker's turn: the same choice as for a single speaker, as if that person spoke first. Narrator: the scene's first person picture. */
export function pickTurnPicture(refs: PicRef[], scene: TalkScene, speaker: string, exists: (file: string) => boolean): { ref: PicRef } | { reason: string } {
  return pickTalkingPicture(refs, { refIds: scene.refIds, cast: scene.cast, lines: speaker.trim() ? [{ speaker, text: "" }] : undefined }, exists);
}

/** ComfyUI's error in plain words: a memory failure says what to do, anything else is the raw message trimmed. */
export function plainRenderError(message: string): string {
  const m = (message || "").trim();
  if (/out of memory|MemoryError|VBAR|OOM/i.test(m)) return "ComfyUI ran out of memory while making this. Free memory (close other GPU programs) or restart ComfyUI, then try again. The earlier clip is still in place.";
  return m.length > 400 ? `${m.slice(0, 400)}...` : m;
}

/** What a failed render leaves on its scene or picture: one that already had a usable file keeps it (and stays done, so joining is not blocked) but now carries the reason; a cancel leaves no message. */
export function failedRenderState(had: boolean, aborted: boolean, message: string): { status: "done" | "pending" | "failed"; error: string | null } {
  if (aborted) return { status: had ? "done" : "pending", error: null };
  return { status: had ? "done" : "failed", error: plainRenderError(message) };
}

/** Warnings for a join: scenes whose talking clip carries an earlier voice than the scene has now. */
export function joinWarnings(scenes: { number: number; talkingClip?: string | null; clipPath: string | null; voiceText?: string; talkingVoice?: string }[]): string[] {
  return scenes.filter(talkingStale).map(s => `Scene ${s.number}: the talking clip was made with an earlier voice - make the talking video again.`);
}
