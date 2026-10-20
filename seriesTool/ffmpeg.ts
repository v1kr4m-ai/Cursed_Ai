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
}

export function buildFilter(count: number, width: number, height: number, fps: number): string {
  let filter = "";
  for (let i = 0; i < count; i++) {
    filter += `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,`;
    filter += `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[v${i}];`;
    filter += `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}];`;
  }
  for (let i = 0; i < count; i++) filter += `[v${i}][a${i}]`;
  filter += `concat=n=${count}:v=1:a=1[v][a]`;
  return filter;
}

export function stitch(a: StitchArgs): Promise<string> {
  if (!a.clips.length) return Promise.reject(new Error("No finished clips to join yet."));
  for (const clip of a.clips) {
    if (!fs.existsSync(clip)) return Promise.reject(new Error(`Missing clip: ${path.basename(clip)}`));
  }

  fs.mkdirSync(path.dirname(a.outFile), { recursive: true });
  const args = ["-y"];
  for (const clip of a.clips) args.push("-i", clip);
  args.push(
    "-filter_complex", buildFilter(a.clips.length, a.width, a.height, a.fps),
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
