/**
 * Turns ComfyUI's log chunks into lines for the Console. ComfyUI sends pieces of text, newlines as their own pieces, and
 * progress bars that rewrite themselves with carriage returns; this puts them back together the way a terminal shows them.
 */

export interface ComfyChunk { t: string; m: string }
export interface ComfyLines { lines: string[]; partial: string }

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;
export const MAX_LINES = 4000;

export const emptyLines = (): ComfyLines => ({ lines: [], partial: "" });

export function appendChunks(state: ComfyLines, chunks: ComfyChunk[]): ComfyLines {
  const lines = [...state.lines];
  let partial = state.partial;
  for (const c of chunks) {
    const text = c.m.replace(ANSI, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\n") { lines.push(partial); partial = ""; }
      else if (ch === "\r") partial = ""; // a progress bar rewrites its own line
      else partial += ch;
    }
  }
  return { lines: lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines, partial };
}

export type Tone = "error" | "warn" | "run" | "progress" | "plain";

/** How a line should look: errors red, warnings amber, a job starting or finishing cyan, progress bars green. */
export function toneOf(line: string): Tone {
  if (/traceback|\berror\b|exception|failed|out of memory|cuda error/i.test(line)) return "error";
  if (/warn(ing)?\b/i.test(line)) return "warn";
  if (/got prompt|prompt executed|execution_start|requested to load|loaded completely|unload/i.test(line)) return "run";
  if (/\d+%\||\bit\/s\b|\bs\/it\b/.test(line)) return "progress";
  return "plain";
}
