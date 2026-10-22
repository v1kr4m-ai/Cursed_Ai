/** Types and fetch helpers for Series Studio. Mirrors seriesTool/model.ts. */

export type Status = "pending" | "queued" | "running" | "done" | "failed";

export interface Ref {
  id: string; name: string; role: "style" | "character";
  prompt: string; negative: string; seed: number;
  /** Uploaded photos this still is made from (image-to-image). Empty means the episode's attached photos. */
  fromRefIds?: string[];
  file: string | null; status: Status; error: string | null;
}

export interface Scene {
  id: string; number: number; vo: string; shot: string; textCard: string;
  refIds: string[]; seed: number; promptText: string; promptEdited: boolean;
  status: Status; clipPath: string | null; durationS: number | null;
  promptId: string | null; error: string | null;
}

export interface Cue { id: string; start: number; end: number; text: string }
export interface SubStyle {
  font: string; size: number; color: string; outlineColor: string; outlineWidth: number; bold: boolean; italic: boolean; uppercase: boolean;
  position: "bottom" | "middle" | "top"; box: boolean; boxOpacity: number; maxWords: number;
}
export interface Subtitles { cues: Cue[]; style: SubStyle; source: string; outPath?: string; updatedAt: string }

export interface AudioTrack { id: string; name: string; file: string; duration: number; offset: number; gain: number; fadeIn: number; fadeOut: number }
export interface AudioMix { tracks: AudioTrack[]; keepOriginal: boolean; originalGain: number; updatedAt: string }
export type ExportKind = "joined" | "subtitled" | "audio" | "final" | "best";
export type OutputKind = "joined" | "subtitled" | "audio" | "final";
export interface Output { kind: OutputKind; path: string; at: string }

export interface Episode {
  id: string; number: number; title: string; era: string; hookOut: string;
  refs: Ref[]; scenes: Scene[]; exportPath: string | null; subtitles?: Subtitles; exportedAt?: string; audio?: AudioMix; outputs?: Output[]; finalKind?: string;
}

export interface ProjectSettings {
  comfyUrl: string; videoWorkflow: string; imageWorkflow: string;
  width: number; height: number; seconds: number; steps: number; fps: number;
}

export interface Source { id: string; name: string; text: string; addedAt: string; digest?: string; digestedAt?: string }

export interface Project {
  id: string; title: string; dir: string; createdAt: string; updatedAt: string;
  idea: { logline: string; audience: string; tone: string; notes: string; niche?: string };
  discussion: { role: "user" | "assistant"; content: string; at: string }[];
  styleLock: string; voiceLock: string;
  settings: ProjectSettings; episodes: Episode[]; sources?: Source[];
  /** What kind of video this is: narration, vlog, ugc, singing, dancing... (seriesTool/formats.ts). */
  format?: string;
  /** Burn each scene's text card into the picture. Off by default. */
  allowTextCards?: boolean;
  running?: { targetId: string; label: string; progress: [number, number] | null } | null;
}

export interface ProjectSummary {
  id: string; title: string; dir: string; updatedAt: string;
  episodes: number; scenes: number; scenesDone: number; exports: number;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init?.headers || {}) } : init?.headers,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  list: () => call<{ projects: ProjectSummary[]; root: string }>("/api/series/projects"),
  create: (title: string) => call<Project>("/api/series/projects", { method: "POST", body: JSON.stringify({ title }) }),
  get: (id: string) => call<Project>(`/api/series/projects/${id}`),
  patch: (id: string, changes: Partial<Project>) => call<Project>(`/api/series/projects/${id}`, { method: "PATCH", body: JSON.stringify(changes) }),
  remove: (id: string) => call<{ ok: true }>(`/api/series/projects/${id}`, { method: "DELETE" }),
  savePlan: (id: string, episodes: any[], keepRendered = true) =>
    call<Project>(`/api/series/projects/${id}/plan`, { method: "POST", body: JSON.stringify({ episodes, keepRendered }) }),
  generateRef: (id: string, refId: string) => call(`/api/series/projects/${id}/refs/${refId}/generate`, { method: "POST" }),
  generateScene: (id: string, sceneId: string) => call(`/api/series/projects/${id}/scenes/${sceneId}/generate`, { method: "POST" }),
  generateEpisode: (id: string, episodeId: string, redo = false) =>
    call<{ queued: number }>(`/api/series/projects/${id}/episodes/${episodeId}/generate`, { method: "POST", body: JSON.stringify({ redo }) }),
  cancel: (id: string) => call(`/api/series/projects/${id}/cancel`, { method: "POST" }),
  stitch: (id: string, episodeId: string) => call<{ file: string }>(`/api/series/projects/${id}/episodes/${episodeId}/stitch`, { method: "POST" }),
  generateSubtitles: (id: string, episodeId: string, source: string) =>
    call<Project>(`/api/series/projects/${id}/episodes/${episodeId}/subtitles/generate`, { method: "POST", body: JSON.stringify({ source }) }),
  saveSubtitles: (id: string, episodeId: string, body: { cues?: Cue[]; style?: SubStyle }) =>
    call<Project>(`/api/series/projects/${id}/episodes/${episodeId}/subtitles`, { method: "PUT", body: JSON.stringify(body) }),
  burnSubtitles: (id: string, episodeId: string) =>
    call<Project>(`/api/series/projects/${id}/episodes/${episodeId}/subtitles/burn`, { method: "POST" }),
  redoSceneSubtitles: (id: string, episodeId: string, sceneId: string, source: string) =>
    call<Project>(`/api/series/projects/${id}/episodes/${episodeId}/subtitles/scene`, { method: "POST", body: JSON.stringify({ sceneId, source }) }),
  async uploadAudio(id: string, episodeId: string, file: File, offset = 0) {
    const res = await fetch(`/api/series/projects/${id}/episodes/${episodeId}/audio/upload?name=${encodeURIComponent(file.name)}&offset=${offset}`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not add that file.");
    return data as Project;
  },
  saveAudio: (id: string, episodeId: string, body: { tracks?: AudioTrack[]; keepOriginal?: boolean; originalGain?: number }) =>
    call<Project>(`/api/series/projects/${id}/episodes/${episodeId}/audio`, { method: "PUT", body: JSON.stringify(body) }),
  deleteAudio: (id: string, episodeId: string, trackId: string) => call<Project>(`/api/series/projects/${id}/episodes/${episodeId}/audio/${trackId}`, { method: "DELETE" }),
  renderEpisode: (id: string, episodeId: string, what: { subtitles: boolean; audio: boolean }) =>
    call<Project>(`/api/series/projects/${id}/episodes/${episodeId}/render`, { method: "POST", body: JSON.stringify(what) }),
  pinFinal: (id: string, episodeId: string, kind: OutputKind | null) => call<Project>(`/api/series/projects/${id}/episodes/${episodeId}/final`, { method: "PUT", body: JSON.stringify({ kind }) }),
  exportEpisodes: (id: string, dir: string, opts: { kind: ExportKind; episodeIds?: string[] }) => call<{ dir: string; files: string[]; episodes: number; skipped: { number: number; title: string }[] }>(`/api/series/projects/${id}/export`, { method: "POST", body: JSON.stringify({ dir, ...opts }) }),
  masterVideo: (id: string, dir: string, kind: ExportKind) => call<{ file: string; dir: string; episodes: number; skipped: { number: number; title: string }[] }>(`/api/series/projects/${id}/master`, { method: "POST", body: JSON.stringify({ dir, kind }) }),
  comfyStatus: () => call<{ comfyUp: boolean; comfyUrl: string }>("/api/series/workflows"),
  async uploadSource(id: string, file: File) {
    const res = await fetch(`/api/series/projects/${id}/sources?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not read that file.");
    return data as { source: Source; chars: number };
  },
  addSourceText: (id: string, text: string, name: string) =>
    call<{ source: Source; chars: number }>(`/api/series/projects/${id}/sources/text`, { method: "POST", body: JSON.stringify({ text, name }) }),
  setSourceDigest: (id: string, sourceId: string, digest: string) =>
    call<{ ok: true; chars: number }>(`/api/series/projects/${id}/sources/${sourceId}`, { method: "PATCH", body: JSON.stringify({ digest }) }),
  deleteSource: (id: string, sourceId: string) =>
    call<{ ok: true }>(`/api/series/projects/${id}/sources/${sourceId}`, { method: "DELETE" }),
  deleteRef: (id: string, refId: string) => call<{ ok: true }>(`/api/series/projects/${id}/refs/${refId}`, { method: "DELETE" }),
  async uploadRef(id: string, episodeId: string, file: File, label: string, role: "style" | "character") {
    const query = new URLSearchParams({ name: file.name, label, role });
    const res = await fetch(`/api/series/projects/${id}/episodes/${episodeId}/upload?${query}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed.");
    return data as { ref: Ref };
  },
};

export const fileUrl = (p: string) => `/api/series/file?path=${encodeURIComponent(p)}`;

/** Ask the chat endpoint for one complete answer (no UI streaming needed beyond a token callback). */
export async function askModel(
  messages: { role: string; content: string }[],
  model: string | undefined,
  onToken?: (t: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ messages, model, options: { temperature: 0.8, maxTokens: 8192 } }),
  });
  if (!res.ok || !res.body) throw new Error((await res.text()) || "The model did not answer.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const data = JSON.parse(payload);
        if (data.error) throw new Error(data.error);
        if (data.token) { answer += data.token; onToken?.(data.token); }
      } catch { /* a partial frame - the next chunk completes it */ }
    }
  }
  if (!answer.trim()) throw new Error("The model sent back an empty answer. It may have run out of memory while loading - try again, or pick a smaller model.");
  return answer;
}

/**
 * Pull the first JSON object or array out of a model answer that may be wrapped in prose, fences or a
 * <think> block. An answer that was cut off mid-way (a small model running out of room) is repaired by
 * keeping every complete item and closing the rest.
 */
export function extractJson(text: string): any {
  const clean = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "");
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)(```|$)/i);
  const candidates = [fenced?.[1], clean].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const start = candidate.search(/[[{]/);
    if (start < 0) continue;
    const stack: string[] = [];
    let inString = false, escaped = false;
    // The last point where an item had just been closed, and which brackets were still open there.
    let safe: { end: number; open: string[] } | null = null;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "[" || ch === "{") stack.push(ch === "[" ? "]" : "}");
      else if (ch === "]" || ch === "}") {
        stack.pop();
        if (!stack.length) {
          try { return JSON.parse(candidate.slice(start, i + 1)); } catch { break; }
        }
        safe = { end: i + 1, open: [...stack] };
      }
    }
    if (safe) {
      try { return JSON.parse(candidate.slice(start, safe.end).replace(/,\s*$/, "") + [...safe.open].reverse().join("")); } catch { /* not repairable */ }
    }
  }
  const seen = text.trim().slice(0, 140).replace(/\s+/g, " ");
  throw new Error(`The model's answer did not contain a usable plan${seen ? ` (it said: "${seen}${text.trim().length > 140 ? "..." : ""}")` : " (it answered nothing)"}. Try again, pick a bigger model, or paste the plan JSON by hand.`);
}

export const STATUS_STYLE: Record<Status, string> = {
  pending: "bg-neutral-700/40 text-neutral-300",
  queued: "bg-amber-500/20 text-amber-300",
  running: "bg-sky-500/20 text-sky-300 animate-pulse",
  done: "bg-emerald-500/20 text-emerald-300",
  failed: "bg-rose-500/20 text-rose-300",
};
