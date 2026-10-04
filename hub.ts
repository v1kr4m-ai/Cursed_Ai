import express from "express";
import fs from "fs";
import path from "path";
import os from "os";
import { inferFlags } from "./src/lib/modelTags";

/**
 * Online model catalog: search Hugging Face (GGUF repos) and the Ollama
 * library, and download models. Hugging Face files are saved into the models
 * folder in LM Studio's "publisher/repo/file.gguf" layout; Ollama models are
 * pulled by the local Ollama app itself, so they land in Ollama's own folder.
 */

interface Job {
  id: string;
  source: "hf" | "ollama";
  label: string;
  status: "running" | "done" | "error" | "cancelled";
  progress: number;
  received: number;
  total: number;
  message: string;
  error?: string;
  dest?: string;
}
type LiveJob = Job & { abort?: AbortController };

// Where Ollama really keeps its models: the OLLAMA_MODELS variable, else the folder the Ollama app
// printed in its own log when it started (it logs its settings), else the default.
function ollamaModelsDir(): string {
  if (process.env.OLLAMA_MODELS) return process.env.OLLAMA_MODELS;
  try {
    const log = path.join(process.env.LOCALAPPDATA || "", "Ollama", "server.log");
    if (process.env.LOCALAPPDATA && fs.existsSync(log)) {
      const size = fs.statSync(log).size;
      const fd = fs.openSync(log, "r");
      const len = Math.min(size, 400_000);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      fs.closeSync(fd);
      const hits = [...buf.toString("utf8").matchAll(/OLLAMA_MODELS:(\S+)/g)].map(m => m[1].replace(/\\\\/g, "\\")).filter(p => fs.existsSync(p)); // the log escapes backslashes
      if (hits.length) return hits[hits.length - 1];
    }
  } catch { /* fall through to the default */ }
  return path.join(os.homedir(), ".ollama", "models");
}

export function modelDirs() {
  const home = os.homedir();
  const lm = [path.join(home, ".lmstudio", "models"), path.join(home, ".cache", "lm-studio", "models")].find(p => fs.existsSync(p)) || null;
  return {
    lmstudioDir: lm,
    ollamaDir: ollamaModelsDir(),
  };
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

async function searchHF(q: string, limit: number) {
  const url = `https://huggingface.co/api/models?filter=gguf&sort=downloads&direction=-1&limit=${limit}` + (q ? `&search=${encodeURIComponent(q)}` : "");
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Hugging Face returned HTTP ${r.status}`);
  const list: any[] = await r.json();
  return list.map(m => {
    const [publisher, name] = String(m.id).split("/");
    return {
      source: "hf", id: m.id, publisher, name: name || m.id,
      description: `${(m.downloads || 0).toLocaleString("en-US")} downloads · ${m.likes || 0} likes${m.pipeline_tag ? " · " + m.pipeline_tag : ""}`,
      tags: inferFlags(m.id, m.tags || []),
    };
  });
}

async function searchOllama(q: string) {
  const r = await fetch(`https://ollama.com/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`ollama.com returned HTTP ${r.status}`);
  const html = await r.text();
  // The site has no public search API; read the result cards from the page.
  const parts = html.split('<a href="/library/').slice(1);
  return parts.map(chunk => {
    const name = chunk.slice(0, chunk.indexOf('"'));
    const desc = /<p class="max-w-lg[^>]*>([\s\S]*?)<\/p>/.exec(chunk)?.[1] || "";
    const spans = [...chunk.matchAll(/<span\s+class="inline-flex[^>]*>([^<]+)<\/span>/g)].map(m => m[1].trim());
    const caps = spans.filter(s => /^(tools|thinking|vision|embedding|cloud)$/i.test(s));
    const sizes = spans.filter(s => /^\d+(\.\d+)?[mb]$/i.test(s));
    return {
      source: "ollama", id: name, name, publisher: "ollama",
      description: decode(desc), sizes,
      tags: inferFlags(name, [], caps),
    };
  }).filter(m => m.name);
}

export function registerHub(app: express.Express, opts: { getModelsDir: () => string; ollamaUrl: string; findExisting: (fileName: string) => string | undefined }) {
  const jobs = new Map<string, LiveJob>();
  const newJob = (source: Job["source"], label: string): LiveJob => {
    const job: LiveJob = { id: `${Date.now()}${Math.floor(Math.random() * 1000)}`, source, label, status: "running", progress: 0, received: 0, total: 0, message: "Starting...", abort: new AbortController() };
    jobs.set(job.id, job);
    return job;
  };

  app.get("/api/hub/search", async (req, res) => {
    const source = req.query.source === "ollama" ? "ollama" : "hf";
    const q = String(req.query.q || "").trim();
    try {
      res.json({ results: source === "hf" ? await searchHF(q, 30) : await searchOllama(q) });
    } catch (e: any) {
      res.status(502).json({ error: `Couldn't reach ${source === "hf" ? "Hugging Face" : "ollama.com"} (${e.message}). Check your internet connection.` });
    }
  });

  // GGUF files of one Hugging Face repo, so the user can pick a quantization.
  app.get("/api/hub/hf-files", async (req, res) => {
    const repo = String(req.query.repo || "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return res.status(400).json({ error: "Bad repo id" });
    try {
      const r = await fetch(`https://huggingface.co/api/models/${repo}/tree/main?recursive=true`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const tree: any[] = await r.json();
      const files = tree.filter(f => f.type === "file" && /\.gguf$/i.test(f.path))
        .map(f => ({
          file: f.path as string,
          size: (f.lfs?.size ?? f.size ?? 0) as number,
          quant: /(TQ\d[\w]*?|IQ\d[\w]*?|Q\d[\w]*?|BF16|F16|F32)(?=[-.]|$)/i.exec(path.basename(f.path).replace(/\.gguf$/i, ""))?.[1]?.toUpperCase() || "",
          split: /-\d{5}-of-\d{5}\.gguf$/i.test(f.path),
          vision: /mmproj/i.test(f.path),
        }))
        .sort((a, b) => a.size - b.size);
      res.json({ files });
    } catch (e: any) {
      res.status(502).json({ error: `Couldn't list files for ${repo}: ${e.message}` });
    }
  });

  app.post("/api/hub/download", (req, res) => {
    const { source, repo, file, name } = req.body || {};
    if (source === "hf") {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "") || !file || /\.\./.test(file)) return res.status(400).json({ error: "repo and file are required" });
      // Never download a second copy of a file that is already in LM Studio / Ollama / any model folder.
      const existing = req.body.force ? undefined : opts.findExisting(path.basename(file));
      if (existing) return res.status(409).json({ error: `You already have this file, so it was not downloaded again: ${existing}` });
      const [publisher, repoName] = repo.split("/");
      const dest = path.join(opts.getModelsDir(), publisher, repoName, path.basename(file));
      const job = newJob("hf", `${repoName} / ${path.basename(file)}`);
      job.dest = dest;
      downloadHF(job, repo, file, dest);
      return res.json({ id: job.id });
    }
    if (source === "ollama") {
      if (!/^[\w.:/-]+$/.test(name || "")) return res.status(400).json({ error: "name is required" });
      const job = newJob("ollama", name);
      pullOllama(job, name);
      return res.json({ id: job.id });
    }
    res.status(400).json({ error: "source must be hf or ollama" });
  });

  app.get("/api/hub/downloads", (req, res) => {
    res.json({ downloads: [...jobs.values()].map(({ abort, ...j }) => j).reverse() });
  });

  app.post("/api/hub/downloads/:id/cancel", (req, res) => {
    const job = jobs.get(req.params.id);
    if (job?.status === "running") { job.abort?.abort(); job.status = "cancelled"; job.message = "Cancelled"; }
    res.json({ status: "success" });
  });

  app.get("/api/hub/dirs", (req, res) => {
    res.json({ modelsDir: opts.getModelsDir(), ...modelDirs() });
  });

  async function downloadHF(job: LiveJob, repo: string, file: string, dest: string) {
    const tmp = `${dest}.part`;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const headers: Record<string, string> = process.env.HF_TOKEN ? { Authorization: `Bearer ${process.env.HF_TOKEN}` } : {};
      const r = await fetch(`https://huggingface.co/${repo}/resolve/main/${file.split("/").map(encodeURIComponent).join("/")}`, { headers, signal: job.abort!.signal });
      if (r.status === 401 || r.status === 403) throw new Error("This model is gated - accept its licence on huggingface.co and set an HF_TOKEN in .env.local.");
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      job.total = Number(r.headers.get("content-length") || 0);
      job.message = "Downloading...";
      const out = fs.createWriteStream(tmp);
      const reader = r.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        job.received += value.byteLength;
        if (!out.write(Buffer.from(value))) await new Promise<void>(ok => out.once("drain", () => ok()));
        if (job.total) job.progress = Math.min(99, Math.floor((job.received / job.total) * 100));
      }
      await new Promise<void>((ok, bad) => { out.on("finish", () => ok()); out.on("error", bad); out.end(); });
      fs.renameSync(tmp, dest);
      job.progress = 100; job.status = "done"; job.message = "Saved";
    } catch (e: any) {
      try { fs.unlinkSync(tmp); } catch {}
      if (job.status === "cancelled") return;
      job.status = "error"; job.error = e.message; job.message = "Failed";
    }
  }

  async function pullOllama(job: LiveJob, name: string) {
    try {
      const r = await fetch(`${opts.ollamaUrl}/api/pull`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name, stream: true }), signal: job.abort!.signal,
      }).catch(() => { throw new Error("Ollama isn't running - start the Ollama app first."); });
      if (!r.ok || !r.body) throw new Error(`Ollama returned HTTP ${r.status}: ${(await r.text().catch(() => "")).slice(0, 150)}`);
      const layers = new Map<string, { total: number; done: number }>();
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let j: any; try { j = JSON.parse(line); } catch { continue; }
          if (j.error) throw new Error(j.error);
          job.message = j.status || job.message;
          if (j.digest && j.total) layers.set(j.digest, { total: j.total, done: j.completed || 0 });
          const tot = [...layers.values()].reduce((a, l) => a + l.total, 0);
          const got = [...layers.values()].reduce((a, l) => a + l.done, 0);
          job.total = tot; job.received = got;
          if (tot) job.progress = Math.min(99, Math.floor((got / tot) * 100));
          if (j.status === "success") { job.progress = 100; job.status = "done"; job.message = "Installed in Ollama"; }
        }
      }
      if (job.status === "running") { job.status = "done"; job.progress = 100; job.message = "Installed in Ollama"; }
    } catch (e: any) {
      if (job.status === "cancelled") return;
      job.status = "error"; job.error = e.message; job.message = "Failed";
    }
  }
}
