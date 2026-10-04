import fs from "fs";
import path from "path";
import { modelDirs } from "./hub";

/**
 * Finds models where they already live, so nothing is copied or downloaded twice:
 *  - the download folder (where Hugging Face downloads are saved),
 *  - LM Studio's models folder (plain .gguf files),
 *  - Ollama's models folder (its manifests point at blob files that ARE gguf files),
 *  - any extra folders the user adds.
 * Everything except the download folder is treated as read-only.
 */

export type SourceKind = "download" | "lmstudio" | "ollama" | "custom";

export interface ModelSource {
  id: string;
  kind: SourceKind;
  label: string;
  path: string;
  enabled: boolean;
  detected: boolean; // found automatically (vs. added by the user)
  exists: boolean;
  count: number;
}

export interface LocalModel {
  id: string;     // what the chat API receives as the model name
  name: string;   // friendly name
  file: string;   // absolute path of the .gguf
  size: number;
  origin: SourceKind;
  label: string;
}

export interface SourceConfig { customDirs?: string[]; disabledSources?: string[] }

const MAX_DEPTH = 5;

// Stable short id for a user-added folder (used in model ids and the disabled list).
export function shortHash(text: string): string {
  let h = 0;
  for (const ch of text.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

function walkGguf(dir: string, rel = "", depth = 0): { rel: string; file: string; size: number }[] {
  if (depth > MAX_DEPTH) return [];
  let out: { rel: string; file: string; size: number }[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out = out.concat(walkGguf(full, r, depth + 1));
    else if (/\.gguf$/i.test(e.name) && !/mmproj/i.test(e.name)) { // mmproj = vision projector, not a chat model
      try { out.push({ rel: r, file: full, size: fs.statSync(full).size }); } catch { /* vanished */ }
    }
  }
  return out;
}

// Ollama keeps manifests (JSON) that list content-addressed blobs; the "model" layer is a plain GGUF.
function ollamaModels(root: string): { name: string; file: string; size: number }[] {
  const manifests = path.join(root, "manifests");
  const out: { name: string; file: string; size: number }[] = [];
  const walk = (dir: string, parts: string[]) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) { walk(path.join(dir, e.name), [...parts, e.name]); continue; }
      // parts = [registry, namespace, name]; e.name = tag
      if (parts.length < 3) continue;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, e.name), "utf8"));
        const layer = (m.layers || []).find((l: any) => l.mediaType === "application/vnd.ollama.image.model");
        if (!layer?.digest) continue;
        const blob = path.join(root, "blobs", String(layer.digest).replace(":", "-"));
        if (!fs.existsSync(blob)) continue;
        const [, ns, ...nm] = parts;
        const base = nm.join("/");
        out.push({ name: `${ns === "library" ? "" : ns + "/"}${base}:${e.name}`, file: blob, size: layer.size || fs.statSync(blob).size });
      } catch { /* not a manifest */ }
    }
  };
  walk(manifests, []);
  return out;
}

export function createLocalModels(opts: { getDownloadDir: () => string; getConfig: () => SourceConfig }) {
  function sourceList(): Omit<ModelSource, "count">[] {
    const cfg = opts.getConfig();
    const disabled = new Set(cfg.disabledSources || []);
    const dirs = modelDirs();
    const list: Omit<ModelSource, "count">[] = [];
    const seen = new Set<string>();
    const add = (id: string, kind: SourceKind, label: string, p: string | null, detected: boolean) => {
      if (!p) return;
      const key = path.resolve(p).toLowerCase();
      if (seen.has(key)) return; // same folder listed twice
      seen.add(key);
      list.push({ id, kind, label, path: p, enabled: !disabled.has(id), detected, exists: fs.existsSync(p) });
    };
    add("download", "download", "Download folder", opts.getDownloadDir(), false);
    add("lmstudio", "lmstudio", "LM Studio", dirs.lmstudioDir, true);
    add("ollama", "ollama", "Ollama", dirs.ollamaDir, true);
    (cfg.customDirs || []).forEach((p) => add(`c-${shortHash(p)}`, "custom", path.basename(p) || p, p, false));
    return list;
  }

  function scan(): { models: LocalModel[]; sources: ModelSource[] } {
    const models: LocalModel[] = [];
    const sources: ModelSource[] = [];
    const downloadDir = path.resolve(opts.getDownloadDir()).toLowerCase();
    // The same file can show up in several folders (LM Studio often holds links to Ollama's blobs): list it once.
    const seenFiles = new Set<string>();
    const real = (f: string) => { try { return fs.realpathSync(f).toLowerCase(); } catch { return f.toLowerCase(); } };
    const ordered = sourceList().sort((a, b) => Number(b.kind === "ollama") - Number(a.kind === "ollama"));
    for (const s of ordered) {
      let found = 0;
      if (s.enabled && s.exists) {
        if (s.kind === "ollama") {
          for (const m of ollamaModels(s.path)) {
            seenFiles.add(real(m.file));
            models.push({ id: `@ollama/${m.name}`, name: m.name, file: m.file, size: m.size, origin: "ollama", label: s.label });
            found++;
          }
        } else {
          for (const f of walkGguf(s.path)) {
            const key = real(f.file);
            if (seenFiles.has(key)) continue;
            seenFiles.add(key);
            // The download folder keeps plain relative ids (as before); other folders are prefixed so ids never collide.
            const id = s.kind === "download" || path.resolve(s.path).toLowerCase() === downloadDir ? f.rel : `@${s.id}/${f.rel}`;
            models.push({ id, name: f.rel.split("/").pop()!.replace(/\.gguf$/i, ""), file: f.file, size: f.size, origin: s.kind, label: s.label });
            found++;
          }
        }
      }
      sources.push({ ...s, count: found });
    }
    const order = sourceList().map(x => x.id);
    sources.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { models, sources };
  }

  /** Is a file with this name already available somewhere (any enabled folder)? */
  function findByFileName(fileName: string): LocalModel | undefined {
    const want = fileName.toLowerCase();
    return scan().models.find(m => path.basename(m.file).toLowerCase() === want);
  }

  return { scan, findByFileName };
}
