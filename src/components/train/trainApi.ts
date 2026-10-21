import React from "react";

export type JobKind = "lora" | "llm" | "caption" | "sketch" | "pairs" | "download";

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
    else if (m.type === "state") put(k, { state: m.state, progress: m.state?.progress ?? viewOf(k).progress });
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
