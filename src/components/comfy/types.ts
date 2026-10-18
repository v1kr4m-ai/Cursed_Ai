export type Kind = "image" | "video";

export interface WorkflowField { id: string; node: string; input: string; label: string; kind: string; value: any; options?: string[] }
export interface NodeChoice { id: string; label: string }

/** What the server works out about one workflow file (see comfyTool/registry.ts). */
export interface WorkflowInfo {
  name: string;
  path: string;
  isRunnable: boolean;
  missing: string[];
  warnings: string[];
  needsAssignment: string[];
  needsPrompt: boolean;
  outputKind: "image" | "video" | "audio" | "3d";
  refImageCount: number; refVideoCount: number; refAudioCount: number;
  refImageLabels: string[]; refVideoLabels: string[]; refAudioLabels: string[];
  refImageBypassable: boolean[]; refVideoBypassable: boolean[]; refAudioBypassable: boolean[];
  fields: WorkflowField[];
  promptNodeId: string | null;
  outputNodeId: string | null;
  promptCandidates: NodeChoice[];
  outputCandidates: NodeChoice[];
}

export interface PromptCandidate { row: number; label: string; text: string }
export interface PromptColumnInfo { sheet: string; header: string; candidates: PromptCandidate[] }
export interface PromptFileResult { rawText: string; extractedPrompt: string; matched: boolean; candidates: PromptCandidate[]; columns: PromptColumnInfo[] }

export interface MediaItem { name: string; path: string; type: "image" | "video" | "audio" }
export interface HistoryItem { path: string; workflow: string; prompt: string; kind: Kind; createdAt: string }

export interface RunRow {
  runId: string; kind: Kind; workflow: string; prompt: string; status: string; ahead: number | null; created: number;
  progress: [number, number] | null; result: string | null; error: string | null; cancellable: boolean;
}

/** Colours per tab: Image is pink, Video is orange (same palette as the rest of the Image / Video pages). */
export const ACCENT = {
  image: { solid: "bg-pink-600 hover:bg-pink-500", ring: "focus:ring-pink-500", text: "text-pink-400", soft: "bg-pink-500/10 border-pink-500/25", bar: "bg-pink-500", chip: "bg-pink-600 text-white", border: "border-pink-500/40" },
  video: { solid: "bg-orange-600 hover:bg-orange-500", ring: "focus:ring-orange-500", text: "text-orange-400", soft: "bg-orange-500/10 border-orange-500/25", bar: "bg-orange-500", chip: "bg-orange-600 text-white", border: "border-orange-500/40" },
} as const;

export const fileUrl = (path: string) => `/api/tool/file?path=${encodeURIComponent(path)}`;

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, init);
  const text = await resp.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!resp.ok) throw new Error(data?.error || `Request failed (HTTP ${resp.status}). If you just updated the app, restart it.`);
  return data as T;
}

export const postJson = (url: string, body: unknown) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
