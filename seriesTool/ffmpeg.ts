/**
 * Joins an episode's scene clips into one file with the local ffmpeg.
 *
 * Clips generated at different times can differ in resolution, frame rate and sample rate, so the
 * concat demuxer is not safe here: every input is normalised through the concat *filter* first.
 * Letterbox padding keeps the aspect intact if one clip was rendered at a different shape.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export interface StitchArgs {
  clips: string[];
  outFile: string;
  width: number;
  height: number;
  fps: number;
  onLine?: (line: string) => void;
  signal?: AbortSignal;
  /** Optional spoken voice per clip (same order as `clips`; null = none). Mixed over the clip with its own sound ducked. */
  voices?: (string | null | undefined)[];
}

/** A clip's own sound is turned down to this while a made voice speaks, so the model's invented speech does not double it. */
export const DUCK = 0.2;
/** Silence left after a voice that runs past its clip. */
export const VOICE_TAIL = 0.25;

/** How long the clip plays when a voice is laid over it: never shorter than the voice, so no speech is cut (the last frame is held). */
export const mixedLength = (clip: number, voice: number): number => Math.round(Math.max(clip, voice + VOICE_TAIL) * 1000) / 1000;

/**
 * `voices[i]` (optional): this clip gets the voice from input `input` (inputs after the clips). The voice (Dia's files are very quiet, so it is loudness-normalised) is laid over the clip with
 * the clip's own sound at DUCK; if the voice outlasts the clip, the last frame is held and the sound padded so nothing is cut.
 */
export type ClipVoice = { input: number; clip: number; voice: number } | null | undefined;

export function buildFilter(count: number, width: number, height: number, fps: number, voices?: ClipVoice[]): string {
  let filter = "";
  for (let i = 0; i < count; i++) {
    const v = voices?.[i];
    const total = v ? mixedLength(v.clip, v.voice) : 0;
    const hold = v && total > v.clip + 0.01 ? `,tpad=stop_mode=clone:stop_duration=${Math.round((total - v.clip) * 1000) / 1000}` : "";
    filter += `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,`;
    filter += `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}${hold}[v${i}];`;
    if (v) {
      const std = "aresample=48000,aformat=channel_layouts=stereo";
      filter += `[${i}:a]${std},volume=${DUCK},apad=whole_dur=${total}[c${i}];[${v.input}:a]${std},loudnorm=I=-16:TP=-1.5:LRA=11,apad=whole_dur=${total}[s${i}];`;
      filter += `[c${i}][s${i}]amix=inputs=2:duration=longest:normalize=0,atrim=duration=${total}[a${i}];`;
    } else filter += `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}];`;
  }
  for (let i = 0; i < count; i++) filter += `[v${i}][a${i}]`;
  filter += `concat=n=${count}:v=1:a=1[v][a]`;
  return filter;
}

export async function stitch(a: StitchArgs): Promise<string> {
  if (!a.clips.length) throw new Error("No finished clips to join yet.");
  for (const clip of a.clips) {
    if (!fs.existsSync(clip)) throw new Error(`Missing clip: ${path.basename(clip)}`);
  }

  fs.mkdirSync(path.dirname(a.outFile), { recursive: true });
  const args = ["-y"];
  for (const clip of a.clips) args.push("-i", clip);
  const mixes: ClipVoice[] = [];
  let next = a.clips.length;
  const withVoice = a.voices?.some((f, i) => f && i < a.clips.length && fs.existsSync(f));
  const lengths = withVoice ? await Promise.all(a.clips.map((c, i) => (a.voices?.[i] && fs.existsSync(a.voices[i]!) ? Promise.all([probeDuration(c), probeDuration(a.voices[i]!)]) : null))) : [];
  a.clips.forEach((_c, i) => {
    const l = lengths[i], f = a.voices?.[i];
    if (l && l[0] && l[1] && f) { args.push("-i", f); mixes[i] = { input: next++, clip: l[0], voice: l[1] }; }
  });
  args.push(
    "-filter_complex", buildFilter(a.clips.length, a.width, a.height, a.fps, mixes),
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    a.outFile,
  );

  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { windowsHide: true });
    let tail = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-4000); // ffmpeg's error lands at the end of a very chatty stream
      for (const line of text.split(/\r?\n/)) if (line.trim()) a.onLine?.(line.trim());
    });
    proc.on("error", e => reject(new Error(`Could not run ffmpeg - is it on PATH? (${(e as Error).message})`)));
    proc.on("close", code => (code === 0 ? resolve(a.outFile) : reject(new Error(tail.split(/\r?\n/).filter(Boolean).slice(-3).join(" ")))));
    a.signal?.addEventListener("abort", () => proc.kill("SIGKILL"), { once: true });
  });
}

/** Duration in seconds via ffprobe, used to show real clip lengths and the episode total. */
export function probeDuration(file: string): Promise<number | null> {
  return new Promise(resolve => {
    const proc = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { windowsHide: true });
    let out = "";
    proc.stdout.on("data", (c: Buffer) => { out += c.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const n = Number(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
  });
}

/** ffmpeg arguments that cut a talking clip to `seconds` (the voice plus a short tail) and bring its voice to the same loudness the mixed voices get. */
export function buildTalkingTrimArgs(input: string, out: string, seconds: number): string[] {
  return ["-y", "-v", "error", "-i", input, "-t", String(Math.round(seconds * 1000) / 1000), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out];
}

/** One speaker's piece of a multi-speaker talking scene: cut to exactly `seconds` (the video holds its last frame and the sound is padded with silence if the render is a hair short), sound levelled. */
export function buildTalkingPieceArgs(input: string, out: string, seconds: number): string[] {
  return ["-y", "-v", "error", "-i", input, "-t", String(Math.round(seconds * 1000) / 1000), "-vf", "tpad=stop_mode=clone:stop_duration=2", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,apad",
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", "16", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-b:a", "192k", "-movflags", "+faststart", out];
}

/** The pieces one after another into one clip (all made by buildTalkingPieceArgs, same size and settings). */
export function buildTalkingConcatArgs(inputs: string[], out: string): string[] {
  const filter = `${inputs.map((_, i) => `[${i}:v][${i}:a]`).join("")}concat=n=${inputs.length}:v=1:a=1[v][a]`;
  return ["-y", "-v", "error", ...inputs.flatMap(f => ["-i", f]), "-filter_complex", filter, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out];
}

/** Runs ffmpeg with these arguments; rejects with the tail of its error. */
export function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { windowsHide: true });
    let tail = "";
    proc.stderr.on("data", (c: Buffer) => { tail = (tail + c.toString()).slice(-2000); });
    proc.on("error", e => reject(new Error(`Could not run ffmpeg - is it on PATH? (${(e as Error).message})`)));
    proc.on("close", code => (code === 0 ? resolve() : reject(new Error(tail.split(/\r?\n/).filter(Boolean).slice(-3).join(" ") || `ffmpeg exit code ${code}`))));
    signal?.addEventListener("abort", () => proc.kill("SIGKILL"), { once: true });
  });
}

/** ffmpeg arguments that join spoken turns (wav files) into one 24 kHz mono wav, `gap` seconds of silence after each turn but the last. */
export function buildJoinArgs(inputs: string[], out: string, gap = 0.35): string[] {
  const pads = inputs.map((_, i) => `[${i}:a]${i < inputs.length - 1 ? `apad=pad_dur=${gap}` : "anull"}[a${i}]`).join(";");
  const filter = `${pads};${inputs.map((_, i) => `[a${i}]`).join("")}concat=n=${inputs.length}:v=0:a=1[out]`;
  return ["-y", "-v", "error", ...inputs.flatMap(f => ["-i", f]), "-filter_complex", filter, "-map", "[out]", "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", out];
}
