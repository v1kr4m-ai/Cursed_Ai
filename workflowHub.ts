/**
 * ComfyUI workflows from the internet: the official template library (Comfy-Org/workflow_templates on GitHub),
 * Civitai's workflow listings, or any link (a .json or .zip file, a GitHub page, a Civitai model page).
 *
 * A download is saved in ComfyUI's own workflow folder in its own (browser) format, and an API-format copy with
 * the same name goes into API_FORMAT for apps and scripts. A workflow that only comes in API format is kept in
 * API_FORMAT (ComfyUI opens it when it is dragged onto the canvas).
 */
import type express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { convertUiWorkflow } from "./comfyTool/convert";

type Json = any;
const TEMPLATES = "https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates";
const UA = { "User-Agent": "Cursed_Ai workflow downloader" };

export interface HubItem {
  source: "official" | "civitai"; id: string; title: string; description: string; category: string;
  thumb: string | null; tags: string[]; online?: boolean; downloads?: number; files?: { name: string; url: string; sizeKB: number }[];
}

/** File-name safe: no characters Windows refuses, no leading dots, not too long. */
export const safeName = (s: string) => s.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " - ").replace(/\s+/g, " ").replace(/^[.\s-]+|[.\s-]+$/g, "").slice(0, 120) || "workflow";

/** ComfyUI's own (browser) format has nodes and links; the API format is a map of nodes with class_type. */
export function formatOf(d: Json): "ui" | "api" | null {
  if (d && typeof d === "object" && !Array.isArray(d) && Array.isArray(d.nodes) && Array.isArray(d.links)) return d.nodes.length ? "ui" : null;
  if (d && typeof d === "object" && !Array.isArray(d)) { const v = Object.values(d); if (v.length && v.every((n: any) => n && typeof n === "object" && typeof n.class_type === "string")) return "api"; }
  return null;
}

/** A GitHub page link becomes the raw file link; other links are used as they are. */
export function rawUrl(url: string): string {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.trim());
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url.trim();
}

const strip = (html: string) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

let officialCache: { at: number; items: HubItem[] } | null = null;
async function officialList(): Promise<HubItem[]> {
  if (officialCache && Date.now() - officialCache.at < 3600_000) return officialCache.items;
  const r = await fetch(`${TEMPLATES}/index.json`, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`The template library answered ${r.status}.`);
  const cats: Json[] = await r.json();
  const items: HubItem[] = [];
  for (const c of cats) for (const t of c.templates || []) {
    items.push({
      source: "official", id: t.name, title: t.title || t.name, description: t.description || "", category: c.title || c.type || "",
      thumb: t.mediaType === "image" || t.mediaSubtype ? `${TEMPLATES}/${t.name}-1.${t.mediaSubtype || "webp"}` : null,
      tags: [...(t.tags || []), ...(t.models || [])], online: /^api_/.test(t.name) || (t.tags || []).includes("API"),
    });
  }
  officialCache = { at: Date.now(), items };
  return items;
}

async function civitaiSearch(q: string): Promise<HubItem[]> {
  const u = new URL("https://civitai.com/api/v1/models");
  u.searchParams.set("types", "Workflows"); u.searchParams.set("limit", "30"); u.searchParams.set("nsfw", "false");
  u.searchParams.set("sort", "Most Downloaded");
  if (q) u.searchParams.set("query", q);
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`Civitai answered ${r.status}.`);
  const d: Json = await r.json();
  return (d.items || []).map((m: Json): HubItem => {
    const v = (m.modelVersions || [])[0] || {};
    const img = (v.images || []).find((i: Json) => !i.nsfw || i.nsfw === "None") || null;
    return {
      source: "civitai", id: String(m.id), title: m.name, description: strip(m.description).slice(0, 400), category: v.baseModel || "Workflow",
      thumb: img?.url || null, tags: m.tags || [], downloads: m.stats?.downloadCount,
      files: (v.files || []).map((f: Json) => ({ name: f.name, url: f.downloadUrl, sizeKB: Math.round(f.sizeKB || 0) })),
    };
  });
}

function unzip(zip: string, dest: string): Promise<void> {
  return new Promise((ok, bad) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Expand-Archive -LiteralPath $env:Z -DestinationPath $env:D -Force"],
    { env: { ...process.env, Z: zip, D: dest }, windowsHide: true, timeout: 120000 }, e => (e ? bad(new Error("Could not open the zip: " + e.message)) : ok())));
}

/** Every workflow inside a downloaded file: one .json, or all the workflow .json files in a .zip. */
async function workflowsIn(buf: Buffer, name: string): Promise<{ name: string; data: Json }[]> {
  if (buf.subarray(0, 2).toString() === "PK") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfzip-"));
    try {
      const zip = path.join(dir, "file.zip");
      fs.writeFileSync(zip, buf);
      await unzip(zip, path.join(dir, "x"));
      const out: { name: string; data: Json }[] = [];
      const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.json$/i.test(e.name)) { try { const data = JSON.parse(fs.readFileSync(p, "utf8")); if (formatOf(data)) out.push({ name: path.basename(e.name, ".json"), data }); } catch { /* not JSON */ } } } };
      walk(path.join(dir, "x"));
      return out;
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  try { const data = JSON.parse(buf.toString("utf8")); return formatOf(data) ? [{ name, data }] : []; } catch { return []; }
}

const unique = (dir: string, name: string) => { let n = name, i = 2; while (fs.existsSync(path.join(dir, n + ".json"))) n = `${name} (${i++})`; return n; };

export interface Saved { name: string; ui: string | null; api: string | null; note: string }

/** Saves one workflow: its own format in the folder, an API copy in API_FORMAT (made from it when needed). */
export function saveWorkflow(folder: string, rawName: string, data: Json, objectInfo: Json | null): Saved {
  const apiDir = path.join(folder, "API_FORMAT");
  fs.mkdirSync(apiDir, { recursive: true });
  const kind = formatOf(data);
  const name = unique(folder, unique(apiDir, safeName(rawName)));
  if (kind === "api") {
    const api = path.join(apiDir, name + ".json");
    fs.writeFileSync(api, JSON.stringify(data, null, 2));
    return { name, ui: null, api, note: "Only an API version was offered; drag it onto ComfyUI's canvas to open it there." };
  }
  const ui = path.join(folder, name + ".json");
  fs.writeFileSync(ui, JSON.stringify(data, null, 2));
  if (!objectInfo) return { name, ui, api: null, note: "Start ComfyUI once to make the API copy (its node list is needed)." };
  try {
    const r = convertUiWorkflow(data, objectInfo);
    const api = path.join(apiDir, name + ".json");
    fs.writeFileSync(api, JSON.stringify(r.apiWorkflow, null, 2));
    const missing = [...new Set(r.unknownTypes.map((u: any) => (Array.isArray(u) ? u[1] : u)))];
    return { name, ui, api, note: missing.length ? `Needs custom nodes that are not installed: ${missing.slice(0, 6).join(", ")}${missing.length > 6 ? "..." : ""}` : "" };
  } catch (e: any) { return { name, ui, api: null, note: "The API copy could not be made: " + (e?.message || e) }; }
}

/** ComfyUI's workflow folder, from its install folder. */
export function workflowFolder(root: string | null | undefined): string {
  if (!root) return "";
  return [path.join(root, "ComfyUI", "user", "default", "workflows"), path.join(root, "user", "default", "workflows")].find(p => fs.existsSync(p)) || "";
}

/** ComfyUI's node list: live when it runs, else the copy saved the last time it did (comfy-object-info.json). */
export async function nodeList(comfyUrl: string): Promise<Json | null> {
  try { const r = await fetch(`${comfyUrl}/object_info`, { signal: AbortSignal.timeout(15000) }); if (r.ok) return await r.json(); } catch { /* not running */ }
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "comfy-object-info.json"), "utf8")); } catch { return null; }
}

export function registerWorkflowHub(app: express.Express, opts: { folder: () => string; objectInfo: () => Promise<Json | null>; civitaiKey: () => string; setCivitaiKey: (k: string) => void }) {
  /** Civitai asks for a (free) API key before it lets files be downloaded; it is kept in config.json, never sent back. */
  app.get("/api/workflow-hub/civitai-key", (_req, res) => res.json({ set: !!opts.civitaiKey() }));
  app.post("/api/workflow-hub/civitai-key", (req, res) => { opts.setCivitaiKey(String(req.body?.key || "").trim()); res.json({ set: !!opts.civitaiKey() }); });

  app.get("/api/workflow-hub/search", async (req, res) => {
    const source = String(req.query.source || "official"), q = String(req.query.q || "").trim().toLowerCase();
    try {
      if (source === "civitai") return res.json({ items: await civitaiSearch(q) });
      const all = await officialList();
      const items = q ? all.filter(t => `${t.title} ${t.description} ${t.category} ${t.tags.join(" ")}`.toLowerCase().includes(q)) : all;
      res.json({ items: items.slice(0, 200), total: items.length });
    } catch (e: any) { res.status(502).json({ error: e?.message || String(e) }); }
  });

  /** Download: { source: "official", id } | { source: "civitai", id, url? } | { url }. */
  app.post("/api/workflow-hub/download", async (req, res) => {
    const folder = opts.folder();
    if (!folder) return res.status(400).json({ error: "Set your ComfyUI folder first (Image tab, ComfyUI status)." });
    const b = req.body || {};
    try {
      let files: { name: string; data: Json }[] = [];
      let base = String(b.name || "");
      const grab = async (url: string) => {
        const civ = /(^|\.)civitai\.com$/i.test(new URL(url).hostname);
        const key = civ ? opts.civitaiKey() : "";
        const r = await fetch(url, { headers: { ...UA, ...(key ? { Authorization: `Bearer ${key}` } : {}) }, redirect: "follow", signal: AbortSignal.timeout(120000) });
        if ((r.status === 401 || r.status === 403) && civ) throw new Error(key ? "Civitai refused the key - check it in the Civitai box above." : "Civitai needs a free API key to download: make one at civitai.com (Account settings > API keys) and paste it in the Civitai box above.");
        if (!r.ok) throw new Error(`The download answered ${r.status}.`);
        return Buffer.from(await r.arrayBuffer());
      };
      if (b.source === "official") {
        const t = (await officialList()).find(x => x.id === b.id);
        if (!t) return res.status(404).json({ error: "That template is not in the library." });
        base = base || `${t.category} - ${t.title}`;
        files = await workflowsIn(await grab(`${TEMPLATES}/${encodeURIComponent(t.id)}.json`), base);
      } else {
        let url = String(b.url || "");
        const page = /civitai\.com\/models\/(\d+)/.exec(url) || (b.source === "civitai" && b.id ? [null, b.id] : null);
        if (page && !/\/api\/download\//.test(url)) {
          const m: Json = await (await fetch(`https://civitai.com/api/v1/models/${page[1]}`, { headers: UA, signal: AbortSignal.timeout(25000) })).json();
          const f = ((m.modelVersions || [])[0]?.files || [])[0];
          if (!f) return res.status(404).json({ error: "That Civitai page has no file to download." });
          url = f.downloadUrl; base = base || m.name;
        }
        if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "Paste a link that starts with http." });
        url = rawUrl(url);
        base = base || decodeURIComponent(url.split("?")[0].split("/").pop() || "workflow").replace(/\.(json|zip)$/i, "");
        files = await workflowsIn(await grab(url), base);
      }
      if (!files.length) return res.status(422).json({ error: "No ComfyUI workflow was found in that download." });
      const oi = await opts.objectInfo();
      const saved = files.map(f => saveWorkflow(folder, files.length > 1 ? `${base} - ${f.name}` : base, f.data, oi));
      res.json({ ok: true, folder, saved });
    } catch (e: any) { res.status(502).json({ error: e?.message || String(e) }); }
  });
}
