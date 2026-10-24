import React from "react";
import { notify } from "../../lib/notify";

export type JobKind = "lora" | "llm" | "caption" | "sketch" | "pairs" | "download" | "stt" | "tts" | "speechprep" | "speechenv";

export interface JobState {
  kind: JobKind; label: string; running: boolean; startedAt: number | null; endedAt: number | null; code: number | null;
  stopped: boolean; failed: boolean; progress: { pct: number; text: string } | null; result: any;
}

export interface TrainStatus {
  paths: Record<string, string>;
  jobs: Record<string, JobState | null>;
  lora: { ready: boolean; missing: string[]; baseModels: { name: string; path: string; bytes: number }[]; datasets: { name: string; path: string; images: number }[]; outputDir: string };
  llm: {
    ready: boolean; pythonFound: boolean; baseModels: { name: string; path: string }[];
    datasets: { name: string; path: string; bytes: number; examples: number }[]; outputDir: string;
    outputs: { name: string; path: string; hasAdapter: boolean; gguf: { name: string; path: string; bytes: number }[] }[];
  };
  comfy: { running: boolean; url: string };
  ollama: { running: boolean; models: string[]; vision: string[] };
  gemini: boolean;
  comfyRoot: string | null;
}

export async function api<T = any>(url: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

/** The training status: paths, what is installed, which jobs are running. Refreshes now and then, and on demand. */
export function useTrainStatus(): [TrainStatus | null, () => Promise<void>] {
  const [status, setStatus] = React.useState<TrainStatus | null>(null);
  const load = React.useCallback(async () => { try { setStatus(await api<TrainStatus>("/api/train/status")); } catch { /* server restarting */ } }, []);
  React.useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  return [status, load];
}

interface JobView { state: JobState | null; lines: string[]; progress: { pct: number; text: string } | null }
const views = new Map<JobKind, JobView>();
const subs = new Set<() => void>();
let source: EventSource | null = null;
const viewOf = (k: JobKind): JobView => views.get(k) || { state: null, lines: [], progress: null };
const put = (k: JobKind, v: Partial<JobView>) => { views.set(k, { ...viewOf(k), ...v }); subs.forEach(f => f()); };

/** Friendly names and the tab each job belongs to, for the popups when a job ends. */
const JOB_INFO: Record<JobKind, { name: string; tab: string }> = {
  lora: { name: "LoRA training", tab: "trainlora" },
  llm: { name: "Fine-tune", tab: "finetune" },
  caption: { name: "Captioning", tab: "trainlora" },
  sketch: { name: "Character sketch", tab: "trainlora" },
  pairs: { name: "Writing pairs", tab: "finetune" },
  download: { name: "Download", tab: "finetune" },
  stt: { name: "Speech-to-text training", tab: "trainspeech" },
  tts: { name: "Text-to-speech training", tab: "trainspeech" },
  speechprep: { name: "Clip preparation", tab: "trainspeech" },
  speechenv: { name: "Speech setup, download or conversion", tab: "trainspeech" },
};
const took = (ms: number) => { const s = Math.round(ms / 1000); return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`; };
/** The line that best explains a failure: the last error-looking line of the log. */
const whyFailed = (lines: string[]) => {
  const tail = lines.slice(-60).map(l => l.trim()).filter(l => l && !/^\[(exited|finished|stopped)/.test(l));
  const hit = [...tail].reverse().find(l => /(error|exception|failed|could not|not found|out of memory)/i.test(l)) || tail[tail.length - 1] || "";
  return hit.replace(/^\[[a-z.]+\]\s*/i, "").slice(0, 180);
};
/** A popup when a job that was running ends: done (with how long it took and any score), or failed (with the reason). A job you stopped yourself says nothing. */
function announce(k: JobKind, next: JobState, lines: string[]) {
  const { name, tab } = JOB_INFO[k] || { name: k, tab: "finetune" };
  if (next.stopped) return;
  const failed = next.failed || (next.code != null && next.code !== 0);
  if (failed) { notify({ kind: "error", tab, message: `${name} failed: ${whyFailed(lines) || "see the log"}` }); return; }
  if (k === "pairs") return; // the Fine-tune page already says how many pairs were added
  const score = [...lines].reverse().find(l => l.startsWith("[speech] RESULT"))?.replace("[speech] RESULT", "").trim();
  notify({ kind: "success", tab, message: `${name} finished${next.startedAt && next.endedAt ? ` in ${took(next.endedAt - next.startedAt)}` : ""}${score ? `. ${score}` : ""}` });
}

/** One shared stream for every job on the page (a stream per job used up the browser's connections). */
function connect() {
  if (source) return;
  source = new EventSource("/api/train/events");
  source.onmessage = e => {
    let m: any;
    try { m = JSON.parse(e.data); } catch { return; }
    const k = m.kind as JobKind;
    if (m.type === "replay") put(k, { lines: m.lines.slice(-1500), state: m.state, progress: m.state?.progress ?? null });
    else if (m.type === "line") { const l = viewOf(k).lines; put(k, { lines: l.length > 1500 ? [...l.slice(-1200), m.text] : [...l, m.text] }); }
    else if (m.type === "progress") put(k, { progress: { pct: m.pct, text: m.text } });
    else if (m.type === "state") {
      const before = viewOf(k);
      put(k, { state: m.state, progress: m.state?.progress ?? before.progress });
      if (before.state?.running && m.state && !m.state.running) announce(k, m.state, before.lines);
    }
  };
}

/** One background job: its log (replayed when the page opens), progress and state. */
export function useJob(kind: JobKind) {
  const [, tick] = React.useReducer((n: number) => n + 1, 0);
  React.useEffect(() => { connect(); subs.add(tick); return () => { subs.delete(tick); }; }, []);
  const { state, lines, progress } = viewOf(kind);
  const stop = () => fetch(`/api/train/${kind}/stop`, { method: "POST" }).catch(() => {});
  const clear = () => put(kind, { lines: [] });
  return { state, lines, progress, running: !!state?.running, stop, clear };
}

export type Job = ReturnType<typeof useJob>;

export const fmtBytes = (n: number) => (n > 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n > 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.round(n / 1024)} KB`);
export const imgUrl = (p: string) => `/api/train/image?path=${encodeURIComponent(p)}`;
