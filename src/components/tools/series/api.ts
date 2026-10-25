/** Types and fetch helpers for Series Studio. Mirrors seriesTool/model.ts. */

export type Status = "pending" | "queued" | "running" | "done" | "failed";

export interface Ref {
  id: string; name: string; role: "style" | "character";
  /** What the picture is for: person, outfit, product, location, pose, prop, palette, style, other. */
  kind?: string;
  /** Which person this picture shows; pictures of one person share the name. */
  person?: string;
  /** Left out of prompts and workflow slots without deleting it. */
  skip?: boolean;
  prompt: string; negative: string; seed: number;
  /** Uploaded photos this still is made from (image-to-image). Empty means the episode's attached photos. */
  fromRefIds?: string[];
  file: string | null; status: Status; error: string | null;
}

export interface Scene {
  id: string; number: number; vo: string; shot: string; textCard: string;
  refIds: string[]; cast?: string[]; seed: number; promptText: string; promptEdited: boolean;
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
  id: string; number: number; title: string; era: string; hookOut: string; group?: string;
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
  /** Voice in the clips: auto (the style decides), off (no talking, clean for your own music) or on (talks to the camera). */
  voice?: "auto" | "off" | "on";
  /** Burn each scene's text card into the picture. Off by default. */
  allowTextCards?: boolean;
  stillPeople?: string[];
  episodeSeconds?: number;
  bible?: { characters: string; places: string; rules: string; extra: string };
  creativity?: number;
  archived?: boolean;
  grouping?: { unit: string; item: string; size: number };
  running?: { targetId: string; label: string; progress: [number, number] | null } | null;
}

/** A saved way of making a series: style, voice, look, workflows and size, with none of the story. */
export interface SeriesTemplate {
  id: string; name: string; note: string; builtin: boolean; format: string; voice: "auto" | "off" | "on";
  /** What a new project takes from it (a body for the project patch). */
  patch: Partial<Project>;
}

/**
 * What applying a preset to a series that already exists changes: the style, voice, look and tone. The logline, notes,
 * title, episodes, pictures and the workflows and size already chosen are kept (a preset's own workflows are used only
 * when the series has none yet).
 */
export function applyPreset(project: Project, t: SeriesTemplate): Partial<Project> {
  const p: any = t.patch;
  const keep = project.settings;
  return {
    format: p.format, voice: p.voice, allowTextCards: p.allowTextCards, styleLock: p.styleLock, voiceLock: p.voiceLock,
    idea: { ...project.idea, tone: p.idea?.tone || project.idea.tone, audience: p.idea?.audience || project.idea.audience, niche: p.idea?.niche || (project.idea as any).niche } as any,
    settings: { ...keep, seconds: p.settings?.seconds ?? keep.seconds, videoWorkflow: keep.videoWorkflow || p.settings?.videoWorkflow || "", imageWorkflow: keep.imageWorkflow || p.settings?.imageWorkflow || "" },
  };
}

/** Episode lengths: the seconds an episode should run, as quick choices (0 = the old one-minute default of eight clips). */
export const LENGTH_PRESETS: { label: string; seconds: number; note: string }[] = [
  { label: "Short", seconds: 30, note: "about 30 seconds" },
  { label: "Standard", seconds: 0, note: "about a minute (8 clips)" },
  { label: "Long", seconds: 180, note: "about 3 minutes" },
  { label: "Epic", seconds: 600, note: "about 10 minutes, written in parts" },
];

/** Messages for the discussion box, one click each. */
export const CHAT_PRESETS: { label: string; text: string }[] = [
  { label: "Suggest a title", text: "Suggest five strong, short titles for this series, each with a one-line reason." },
  { label: "Give me a hook", text: "Write three opening hooks for episode 1: one line each, strong enough to stop someone scrolling in the first two seconds." },
  { label: "Outline the season", text: "Outline the whole season episode by episode: a title, what happens and the closing hook that pulls the viewer to the next one." },
  { label: "Write episode 1", text: "Write episode 1 scene by scene: for each scene the shot (what the camera sees and does) and the line that is spoken." },
  { label: "Make it punchier", text: "Tighten what we have so far: cut anything slow or repeated, and make every scene earn its seconds." },
  { label: "What's missing?", text: "What is missing or unclear in this idea? Ask me the one most important question." },
];

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
  merge: (id: string, from: string) => call<{ ok: true; episodes: number }>(`/api/series/projects/${id}/merge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from }) }),
  backup: (id: string, dest: string, includeClips: boolean) => call<{ ok: true; file: string; bytes: number; withClips: boolean }>(`/api/series/projects/${id}/backup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dest, includeClips }) }),
  pickBackup: () => call<{ path: string | null }>(`/api/series/pick-backup`, { method: "POST" }),
  importBackup: (zip: string) => call<{ ok: true; id: string; title: string; episodes: number }>(`/api/series/projects/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zip }) }),
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
  templates: () => call<{ templates: SeriesTemplate[] }>("/api/series/templates"),
  saveTemplate: (projectId: string, name: string) => call<{ template: SeriesTemplate }>("/api/series/templates", { method: "POST", body: JSON.stringify({ projectId, name }) }),
  deleteTemplate: (id: string) => call<{ ok: true }>(`/api/series/templates/${id}`, { method: "DELETE" }),
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
  async uploadRef(id: string, episodeId: string, file: File, label: string, role: "style" | "character", kind?: string, person?: string) {
    const query = new URLSearchParams({ name: file.name, label, role, ...(kind ? { kind } : {}), ...(person ? { person } : {}) });
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
  messages: { role: string; content: string; images?: string[] }[],
  model: string | undefined,
  onToken?: (t: string) => void,
  signal?: AbortSignal,
  temperature = 0.8,
): Promise<string> {
  // The model must see the whole discussion: size its context window to the conversation plus the answer (about 3 characters a token).
  const chars = messages.reduce((n, m) => n + m.content.length, 0);
  const numCtx = Math.min(32768, Math.max(4096, Math.ceil((Math.ceil(chars / 3) + 8192) / 1024) * 1024));
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ messages, model, options: { temperature, maxTokens: 8192, numCtx } }),
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
