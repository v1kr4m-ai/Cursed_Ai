/**
 * Custom nodes a workflow needs, installed through ComfyUI-Manager (it must be installed in ComfyUI).
 * Which pack provides a node type comes from the Manager's own node map; the install is queued in the Manager,
 * and ComfyUI is restarted afterwards so the new nodes load.
 */
import type express from "express";

type Json = any;

export interface PackMatch { id: string; title: string; url: string; installed: boolean; description: string }

/** For each node type, the packs that provide it: by name in the Manager's map, else by the pack's name pattern. */
export function packsFor(types: string[], mappings: Json, packs: Json): Record<string, PackMatch[]> {
  const byUrl = new Map<string, Json>();
  for (const p of Object.values<Json>(packs || {})) for (const u of [p.repository, p.reference, ...(p.files || [])].filter(Boolean)) byUrl.set(String(u).replace(/\.git$/, "").toLowerCase(), p);
  const out: Record<string, PackMatch[]> = {};
  for (const t of types) {
    const found: PackMatch[] = [];
    for (const [url, entry] of Object.entries<Json>(mappings || {})) {
      const [names, meta] = Array.isArray(entry) ? entry : [[], {}];
      let hit = Array.isArray(names) && names.includes(t);
      if (!hit && meta?.nodename_pattern) { try { hit = new RegExp(meta.nodename_pattern).test(t); } catch { /* bad pattern */ } }
      if (!hit) continue;
      // The map is keyed by a pack id ("comfyui-reactor") or by a pack's address.
      const p = (packs || {})[url] || byUrl.get(url.replace(/\.git$/, "").toLowerCase());
      if (!p) continue;
      if (found.some(f => f.id === p.id)) continue;
      found.push({ id: p.id, title: p.title || meta?.title_aux || p.id, url, installed: p.state === "enabled" || p.state === "installed", description: String(p.description || "").slice(0, 200) });
    }
    out[t] = found;
  }
  return out;
}

export function registerComfyNodes(app: express.Express, opts: { comfyUrl: () => string; restart: () => Promise<void> }) {
  const manager = async (path: string, init?: RequestInit) => {
    const r = await fetch(opts.comfyUrl() + path, { ...init, signal: AbortSignal.timeout(120000) });
    if (r.status === 404) throw new Error("ComfyUI-Manager is not installed in ComfyUI, so nodes cannot be installed from here.");
    if (r.status === 403) throw new Error("ComfyUI-Manager refused: its security level blocks installs. Set security_level = normal in ComfyUI-Manager's config.ini.");
    if (!r.ok) throw new Error(`ComfyUI-Manager answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r;
  };
  let cache: { at: number; mappings: Json; packs: Json } | null = null;
  const lists = async () => {
    if (cache && Date.now() - cache.at < 10 * 60_000) return cache;
    const [m, l] = await Promise.all([
      manager("/customnode/getmappings?mode=cache").then(r => r.json()),
      manager("/customnode/getlist?mode=cache&skip_update=true").then(r => r.json()),
    ]);
    cache = { at: Date.now(), mappings: m, packs: l.node_packs || l };
    return cache;
  };

  /** { types: ["ReActorFaceSwap", ...] } -> which packs provide them. */
  app.post("/api/comfyui/nodes/find", async (req, res) => {
    const types: string[] = Array.isArray(req.body?.types) ? req.body.types.filter((t: any) => typeof t === "string").slice(0, 60) : [];
    try { const { mappings, packs } = await lists(); res.json({ packs: packsFor(types, mappings, packs) }); }
    catch (e: any) { res.status(503).json({ error: e?.message || String(e) }); }
  });

  /** { ids: ["comfyui-reactor", ...] } -> queued in ComfyUI-Manager and started. */
  app.post("/api/comfyui/nodes/install", async (req, res) => {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((t: any) => typeof t === "string") : [];
    if (!ids.length) return res.status(400).json({ error: "Nothing to install." });
    try {
      const { packs } = await lists();
      const queued: string[] = [];
      for (const id of ids) {
        const p = packs[id];
        if (!p) continue;
        await manager("/manager/queue/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...p, selected_version: p.version && p.version !== "unknown" ? "latest" : "unknown", channel: "default", mode: "cache", ui_id: id, skip_post_install: false }) });
        queued.push(p.title || id);
      }
      await manager("/manager/queue/start");
      cache = null;
      res.json({ ok: true, queued });
    } catch (e: any) { res.status(502).json({ error: e?.message || String(e) }); }
  });

  /** How the Manager's install queue is doing. */
  app.get("/api/comfyui/nodes/status", async (_req, res) => {
    try { res.json(await (await manager("/manager/queue/status")).json()); }
    catch (e: any) { res.status(503).json({ error: e?.message || String(e) }); }
  });

  /** Restart ComfyUI so newly installed nodes load. */
  app.post("/api/comfyui/restart", async (_req, res) => {
    try { await opts.restart(); res.json({ ok: true }); } catch (e: any) { res.status(500).json({ error: e?.message || String(e) }); }
  });
}
