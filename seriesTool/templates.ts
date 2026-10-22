/**
 * Series templates: a saved set of choices (video style, voice, look, workflows, size) a new series can start from,
 * so a second or tenth series does not need the same setup again. Saved ones live in `.templates.json` next to the
 * project folders; a few built-in ones cover the common kinds.
 *
 * A template holds no story, episodes, pictures or people: only how the series is made.
 */
import type express from "express";
import fs from "fs";
import path from "path";
import { createSeriesStore } from "./store";
import { DEFAULT_SETTINGS, DEFAULT_STYLE_LOCK, DEFAULT_VOICE_LOCK, newId, type Project, type ProjectSettings } from "./model";
import type { VoiceMode } from "./formats";

export interface SeriesTemplate {
  id: string;
  name: string;
  note: string;
  builtin: boolean;
  savedAt: string;
  format: string;
  voice: VoiceMode;
  allowTextCards: boolean;
  styleLock: string;
  voiceLock: string;
  /** Workflows, size and length; empty workflow paths mean "choose in Settings". */
  settings: ProjectSettings;
  tone: string;
  audience: string;
  niche: string;
}

const BUILTIN: Omit<SeriesTemplate, "savedAt">[] = [
  {
    id: "builtin-ugc", name: "UGC creator", builtin: true, note: "Selfie-style clips of one person talking to the camera: vlogs, reviews, outfits.",
    format: "ugc", voice: "auto", allowTextCards: false,
    styleLock: "high quality, natural lighting, in-camera shots, close-ups", voiceLock: "a young woman with a sweet, warm, natural, conversational voice (S1)",
    settings: { ...DEFAULT_SETTINGS, seconds: 5 }, tone: "calm, honest, approachable", audience: "", niche: "social media creator",
  },
  {
    id: "builtin-outfit-change", name: "Outfit change / fashion", builtin: true, note: "A person keeps moving while her outfit changes; no voice, clean for your own music.",
    format: "outfit-change", voice: "off", allowTextCards: false,
    styleLock: "high quality, natural daylight, smooth tracking shots, fashion video", voiceLock: DEFAULT_VOICE_LOCK,
    settings: { ...DEFAULT_SETTINGS, seconds: 5 }, tone: "stylish, upbeat", audience: "", niche: "fashion",
  },
  {
    id: "builtin-documentary", name: "Narrated documentary", builtin: true, note: "A narrator over cinematic pictures: history, science, true stories.",
    format: "narration", voice: "auto", allowTextCards: false,
    styleLock: DEFAULT_STYLE_LOCK, voiceLock: DEFAULT_VOICE_LOCK,
    settings: { ...DEFAULT_SETTINGS }, tone: "cold documentary", audience: "", niche: "",
  },
];

export const builtinTemplates = (): SeriesTemplate[] => BUILTIN.map(t => ({ ...t, savedAt: "" }));

/** The template a project would make: how it is made, none of what is in it. */
export function templateFrom(p: Project, name: string): SeriesTemplate {
  return {
    id: "t-" + newId(), name: name.trim().slice(0, 60), note: "", builtin: false, savedAt: new Date().toISOString(),
    format: p.format || "narration", voice: p.voice || "auto", allowTextCards: !!p.allowTextCards,
    styleLock: p.styleLock, voiceLock: p.voiceLock, settings: { ...p.settings },
    tone: p.idea?.tone || "", audience: p.idea?.audience || "", niche: (p.idea as any)?.niche || "",
  };
}

/** The changes a new project takes from a template (a body for the project PATCH). */
export function templatePatch(t: SeriesTemplate): Partial<Project> {
  return {
    format: t.format, voice: t.voice, allowTextCards: t.allowTextCards, styleLock: t.styleLock, voiceLock: t.voiceLock, settings: { ...t.settings },
    idea: { logline: "", audience: t.audience, tone: t.tone, notes: "", niche: t.niche } as any,
  };
}

export function registerTemplates(app: express.Express, opts: { projectsRoot: string }) {
  const file = path.join(opts.projectsRoot, ".templates.json");
  const store = createSeriesStore(opts.projectsRoot);
  const load = (): SeriesTemplate[] => { try { const v = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(v) ? v : []; } catch { return []; } };
  const save = (list: SeriesTemplate[]) => { fs.mkdirSync(opts.projectsRoot, { recursive: true }); fs.writeFileSync(file, JSON.stringify(list, null, 2)); };
  const all = () => [...builtinTemplates(), ...load()].map(t => ({ ...t, patch: templatePatch(t) }));

  app.get("/api/series/templates", (_req, res) => res.json({ templates: all() }));

  /** Save a project's way of working as a template. */
  app.post("/api/series/templates", (req, res) => {
    const name = String(req.body?.name || "").trim();
    const p = store.get(String(req.body?.projectId || ""));
    if (!name) return res.status(400).json({ error: "Give the template a name." });
    if (!p) return res.status(404).json({ error: "No such project." });
    if (all().some(t => t.name.toLowerCase() === name.toLowerCase())) return res.status(400).json({ error: "A template with that name already exists." });
    const t = templateFrom(p, name);
    save([...load(), t]);
    res.json({ template: { ...t, patch: templatePatch(t) } });
  });

  app.delete("/api/series/templates/:id", (req, res) => {
    const list = load();
    if (!list.some(t => t.id === req.params.id)) return res.status(404).json({ error: "No such saved template (the built-in ones cannot be removed)." });
    save(list.filter(t => t.id !== req.params.id));
    res.json({ ok: true });
  });
}
