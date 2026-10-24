/**
 * Long-running work (a training run, captioning, generating pairs...): one job per kind, with a log that a page can join at any moment
 * (the whole log is replayed, then new lines stream in), so switching tabs or reloading never loses a run.
 */
import type { Response } from "express";
import { spawn, execFile, type ChildProcess } from "child_process";

export type JobKind = "lora" | "llm" | "caption" | "sketch" | "pairs" | "download" | "stt" | "tts" | "speechprep" | "speechenv";

export interface JobState {
  kind: JobKind;
  label: string;
  running: boolean;
  startedAt: number | null;
  endedAt: number | null;
  /** Exit code of a process job; null while running or for task jobs. */
  code: number | null;
  stopped: boolean;
  failed: boolean;
  progress: { pct: number; text: string } | null;
  result: any;
}

interface Job {
  state: JobState;
  log: string[];
  proc?: ChildProcess;
  abort?: AbortController;
  lastTqdmLog: number;
}

const jobs = new Map<JobKind, Job>();
const LOG_LIMIT = 4000;

const fresh = (kind: JobKind, label: string): Job => ({
  state: { kind, label, running: true, startedAt: Date.now(), endedAt: null, code: null, stopped: false, failed: false, progress: null, result: null },
  log: [], lastTqdmLog: 0,
});

/** Pages listen to every job on ONE connection (browsers allow only a handful per site, and a stream per job used them all up). */
const everyone = new Set<Response>();
const send = (job: Job, o: unknown) => { const p = `data: ${JSON.stringify({ ...(o as object), kind: job.state.kind })}\n\n`; for (const r of everyone) { try { r.write(p); } catch { /* closed */ } } };
function addLine(job: Job, text: string) {
  job.log.push(text);
  if (job.log.length > LOG_LIMIT) job.log.splice(0, job.log.length - LOG_LIMIT);
  send(job, { type: "line", text });
}
const setProgress = (job: Job, pct: number, text: string) => { job.state.progress = { pct, text }; send(job, { type: "progress", pct, text }); };
const pushState = (job: Job) => send(job, { type: "state", state: job.state });

/** tqdm progress bars: "  50%|#####     | 160/320 [01:02<01:03, 2.5it/s, avr_loss=0.2]". */
const TQDM = /(\d+)%\|[^|]*\|\s*(\d+)\/(\d+)\s*\[([^\]]*)\]/;
function readLine(job: Job, raw: string) {
  const line = raw.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").trim();
  if (!line) return;
  const m = TQDM.exec(line);
  if (m) {
    setProgress(job, Number(m[1]), `${m[2]}/${m[3]} - ${m[4]}`);
    // Bars redraw many times a second; keep one line in the log every few seconds.
    if (Date.now() - job.lastTqdmLog > 4000 || m[2] === m[3]) { job.lastTqdmLog = Date.now(); addLine(job, line); }
    return;
  }
  addLine(job, line);
}

function finish(job: Job, over: Partial<JobState>) {
  Object.assign(job.state, { running: false, endedAt: Date.now() }, over);
  pushState(job);
}

export function jobState(kind: JobKind): JobState | null { return jobs.get(kind)?.state ?? null; }
export const isRunning = (kind: JobKind) => !!jobs.get(kind)?.state.running;

/** Starts a program. The caller checks isRunning first. */
export function startProcess(kind: JobKind, label: string, exe: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; onExit?: (code: number | null, job: JobState) => void } = {}): JobState {
  const job = fresh(kind, label);
  jobs.set(kind, job);
  addLine(job, `> ${label}`);
  const proc = spawn(exe, args, { cwd: opts.cwd, windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8", ...opts.env } });
  job.proc = proc;
  let out = "", err = "";
  const feed = (which: "out" | "err") => (c: Buffer) => {
    const text = (which === "out" ? out : err) + c.toString();
    const parts = text.split(/[\r\n]+/);
    const rest = parts.pop() || "";
    if (which === "out") out = rest; else err = rest;
    parts.forEach(p => readLine(job, p));
  };
  proc.stdout.on("data", feed("out"));
  proc.stderr.on("data", feed("err"));
  proc.on("error", e => { addLine(job, `[could not start] ${e.message}`); finish(job, { failed: true }); });
  proc.on("close", code => {
    if (out.trim()) readLine(job, out);
    if (err.trim()) readLine(job, err);
    const stopped = job.state.stopped;
    addLine(job, stopped ? "[stopped]" : code === 0 ? "[finished]" : `[exited with code ${code}]`);
    finish(job, { code, failed: !stopped && code !== 0 });
    opts.onExit?.(code, job.state);
  });
  pushState(job);
  return job.state;
}

/** Starts work done inside this process (HTTP calls, file copies...). */
export function startTask(kind: JobKind, label: string, fn: (ctx: { log: (t: string) => void; progress: (pct: number, text: string) => void; signal: AbortSignal }) => Promise<any>): JobState {
  const job = fresh(kind, label);
  jobs.set(kind, job);
  const abort = new AbortController();
  job.abort = abort;
  addLine(job, `> ${label}`);
  pushState(job);
  fn({ log: t => addLine(job, t), progress: (p, t) => setProgress(job, p, t), signal: abort.signal })
    .then(result => { addLine(job, abort.signal.aborted ? "[stopped]" : "[finished]"); finish(job, { result, stopped: abort.signal.aborted }); })
    .catch(e => { addLine(job, abort.signal.aborted ? "[stopped]" : `[failed] ${e?.message || e}`); finish(job, { failed: !abort.signal.aborted, stopped: abort.signal.aborted }); });
  return job.state;
}

export function stopJob(kind: JobKind): boolean {
  const job = jobs.get(kind);
  if (!job || !job.state.running) return false;
  job.state.stopped = true;
  job.abort?.abort();
  const p = job.proc;
  if (p?.pid) {
    if (process.platform === "win32") execFile("taskkill", ["/pid", String(p.pid), "/T", "/F"], { windowsHide: true }, () => {});
    else p.kill("SIGTERM");
  }
  return true;
}

/** A page joins: every job's log so far, then live updates for all of them. */
export function subscribeAll(res: Response) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  for (const [kind, job] of jobs) res.write(`data: ${JSON.stringify({ type: "replay", kind, lines: job.log, state: job.state })}\n\n`);
  res.write(`data: ${JSON.stringify({ type: "ready" })}\n\n`);
  everyone.add(res);
  const keep = setInterval(() => { try { res.write(": keep-alive\n\n"); } catch { /* closed */ } }, 25000);
  res.on("close", () => { everyone.delete(res); clearInterval(keep); });
}

/** Training needs the GPU to itself: unload what ComfyUI and Ollama are holding. Best effort. */
export async function freeVram(opts: { comfyUrl: string; ollamaUrl: string }, log: (t: string) => void) {
  try {
    const r = await fetch(`${opts.comfyUrl}/free`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(6000) });
    if (r.ok) log("[setup] asked ComfyUI to release its GPU memory.");
  } catch { /* not running */ }
  try {
    const ps: any = await (await fetch(`${opts.ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(2500) })).json();
    for (const m of ps.models || []) {
      await fetch(`${opts.ollamaUrl}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: m.name, keep_alive: 0 }), signal: AbortSignal.timeout(8000) }).catch(() => {});
      log(`[setup] unloaded ${m.name} from Ollama.`);
    }
  } catch { /* not running */ }
}
