/**
 * Turns source material (PDF, Word, image, URL, pasted text) into instruction/response training pairs: extract the text, cut it into
 * chunks, ask a model to write pairs from each chunk, and throw away answers that only describe the source instead of using it.
 */
import { spawn } from "child_process";
import fs from "fs";
import type { TrainPaths } from "./paths";

export interface Source { type: "pdf" | "docx" | "image" | "url" | "text"; value: string; label: string }
export interface Pair { instruction: string; input: string; output: string }

export function runPython(exe: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(exe, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    let out = "", err = "";
    proc.stdout.on("data", c => { out += c.toString(); });
    proc.stderr.on("data", c => { err += c.toString(); });
    proc.on("error", reject);
    proc.on("close", code => (code === 0 ? resolve(out) : reject(new Error(err.trim().split(/\r?\n/).slice(-3).join(" ") || `exited with code ${code}`))));
  });
}

export function htmlToText(html: string): string {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|p|div|li|h[1-6]|tr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  t = t.split("\n").map(l => l.trim()).filter(Boolean).join("\n");
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/** Greedy paragraph packing up to maxChars per chunk. */
export function chunkText(text: string, maxChars = 3000): string[] {
  const paras = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > maxChars) { chunks.push(cur); cur = ""; }
    cur = cur ? `${cur}\n\n${p}` : p;
    while (cur.length > maxChars) { chunks.push(cur.slice(0, maxChars)); cur = cur.slice(maxChars); }
  }
  if (cur) chunks.push(cur);
  return chunks.length ? chunks : [text.slice(0, maxChars)];
}

export function extractJsonArray(text: string): any[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error("No JSON array found in the model's answer.");
  const v = JSON.parse(m[0]);
  if (!Array.isArray(v)) throw new Error("The model's answer was not a list.");
  return v;
}

// Small models will happily invent a plausible answer rather than admit the source was too thin: real-shaped JSON, no content.
const META = [/as (mentioned|discussed|described|stated) (in|above|earlier)/i, /the (document|text|source|pdf|passage|paragraph) (discusses|mentions|describes|covers|explains)/i, /(this|the) (document|text|source|pdf)'?s? content/i];
export const looksLikeFiller = (p: Pair) => p.output.length < 15 || META.some(re => re.test(`${p.instruction} ${p.output}`));

export function finishPairs(raw: any[]): { kept: Pair[]; rejected: number } {
  const cleaned: Pair[] = raw.filter(p => p && p.instruction && p.output).map(p => ({ instruction: String(p.instruction).trim(), input: p.input ? String(p.input).trim() : "", output: String(p.output).trim() }));
  const kept = cleaned.filter(p => !looksLikeFiller(p));
  return { kept, rejected: cleaned.length - kept.length };
}

export function buildPairPrompt(o: { count: number; topic?: string; chunk: string; avoid?: string[] }): string {
  const avoid = (o.avoid || []).filter(Boolean).slice(0, 30);
  return `You are building a fine-tuning dataset from a real source document. Read the SOURCE TEXT below and write up to ${o.count} distinct instruction/response training pairs using ONLY facts, figures, steps, or explanations actually present in it${o.topic ? ` (topic: ${o.topic})` : ""}.

Rules:${avoid.length ? `\n- These questions already exist, so write DIFFERENT ones (other facts or other wording):\n${avoid.map(a => `  * ${a}`).join("\n")}` : ""}
- Every answer must contain the actual information (numbers, names, steps, definitions) from the source - never describe the source itself (never write things like "as mentioned in the document" or "the text discusses X" as the answer).
- If the source text below is too short, garbled, or lacking real content to write genuine pairs from, respond with an empty array [] instead of inventing filler.
- Respond with ONLY a JSON array, no commentary, no markdown fences, in this exact shape:
[{"instruction": "...", "output": "..."}, ...]

SOURCE TEXT:
${o.chunk}`;
}

export interface Providers { ollamaUrl: string; geminiKey?: string }

export async function pairsFromChunk(provider: string, model: string, chunk: string, count: number, topic: string, env: Providers, avoid?: string[]): Promise<{ kept: Pair[]; rejected: number }> {
  const prompt = buildPairPrompt({ count, topic, chunk, avoid });
  if (provider === "gemini") {
    if (!env.geminiKey) throw new Error("No Gemini key - add one in Settings > Integrations.");
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-2.5-flash")}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.geminiKey }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }), signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) throw new Error(`Gemini said no (${r.status}): ${(await r.text()).slice(0, 200)}`);
    const d: any = await r.json();
    return finishPairs(extractJsonArray((d.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("")));
  }
  const r = await fetch(`${env.ollamaUrl}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, prompt, stream: false, options: { num_ctx: 8192 } }), signal: AbortSignal.timeout(300000) });
  if (!r.ok) throw new Error(`Ollama returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d: any = await r.json();
  return finishPairs(extractJsonArray(d.response || ""));
}

/** Describes an image with an Ollama vision model (llava, moondream, llama3.2-vision...), so no Python environment is needed. */
export async function describeWithOllama(ollamaUrl: string, model: string, file: string, prompt: string): Promise<string> {
  const img = fs.readFileSync(file).toString("base64");
  const r = await fetch(`${ollamaUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: prompt, images: [img] }] }), signal: AbortSignal.timeout(240000) });
  if (!r.ok) throw new Error(`Ollama returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return String(((await r.json()) as any).message?.content || "").trim();
}

export const VISION_HINT = /llava|moondream|vision|vl\b|qwen2\.5vl|gemma3|minicpm|bakllava/i;

/** Text of one source. Images use an Ollama vision model when one is given, otherwise Florence-2 through the FluxGym environment. */
export async function sourceText(s: Source, p: TrainPaths, o: { ollamaUrl: string; visionModel?: string }): Promise<string> {
  if (s.type === "text") return s.value;
  if (s.type === "pdf") return (await runPython(p.llmPython, [`${p.scriptsDir}/extract_pdf.py`, "--file", s.value])).trim();
  if (s.type === "docx") return (await runPython(p.llmPython, [`${p.scriptsDir}/extract_docx.py`, "--file", s.value])).trim();
  if (s.type === "url") {
    if (!/^https?:\/\//i.test(s.value)) throw new Error("Only http(s) addresses can be fetched.");
    const r = await fetch(s.value, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
    return htmlToText(await r.text());
  }
  if (s.type === "image") {
    if (o.visionModel) return describeWithOllama(o.ollamaUrl, o.visionModel, s.value, "Describe this image in detail: what it shows, any text in it, and anything notable. Be factual.");
    const out = await runPython(p.fluxPython, [`${p.scriptsDir}/describe_image.py`, "--file", s.value]);
    return String(JSON.parse(out.trim().split("\n").pop() || "[]")[0]?.description || "");
  }
  return "";
}
