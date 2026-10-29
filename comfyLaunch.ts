/**
 * Starting ComfyUI without a terminal window. The portable build starts with a .bat file, and running that opens a
 * command window that stays open. The .bat only runs its own python on ComfyUI's main.py with a few options, so we
 * read that line and run the same command directly: no window, same options, and its output goes to a log file the
 * app's Console can show.
 */
import fs from "fs";
import path from "path";

/** Splits a command line into words, keeping "quoted words" together. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2]);
  return out;
}

/** The python command a ComfyUI start file runs, or null if it does something else (then the file itself is run). */
export function directLaunch(batFile: string): { cmd: string; args: string[]; cwd: string } | null {
  let text: string;
  try { text = fs.readFileSync(batFile, "utf8"); } catch { return null; }
  const dir = path.dirname(batFile);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(rem\b|::|echo\b|pause\b|@echo\b|if\b|goto\b|set\b|cd\b)/i.test(line)) continue;
    if (!/main\.py/i.test(line) || !/python/i.test(line)) continue;
    const words = splitCommand(line.replace(/%~dp0/gi, dir + path.sep));
    const exe = path.resolve(dir, words[0].replace(/^@/, ""));
    if (!fs.existsSync(exe)) return null;
    return { cmd: exe, args: words.slice(1), cwd: dir };
  }
  return null;
}

/** The last `count` lines of a log file (empty if there is none yet). */
export function tailLines(file: string, count = 300, maxAgeMs = Infinity): string[] {
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs > maxAgeMs) return []; // an old session's output would only confuse
    const size = st.size;
    const len = Math.min(size, 200_000);
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString("utf8").split(/\r?\n|\r/).filter(l => l.length).slice(-count);
    } finally { fs.closeSync(fd); }
  } catch { return []; }
}

/** Process ids listening on a TCP port, from `netstat -ano` output (Windows). */
export function listeningPids(netstat: string, port: number): number[] {
  const pids = new Set<number>();
  for (const line of netstat.split(/\r?\n/)) {
    const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line);
    if (m && Number(m[1]) === port && Number(m[2]) > 4) pids.add(Number(m[2]));
  }
  return [...pids];
}
