/**
 * Pure helpers for the Mobile side of FineTune LLM: what a phone can hold, the training settings turned into a safe command line,
 * and a check of a chat-format dataset (.jsonl with {"messages":[...]} rows, or instruction/output rows).
 */

export interface PhonePreset {
  id: string;
  label: string;
  /** Base model names (parts of the folder name) that fit this class of phone, best first. */
  suggest: string[];
  quant: string;
  maxLength: number;
  note: string;
}

export const PHONE_PRESETS: PhonePreset[] = [
  { id: "budget", label: "Budget phone (3-4 GB RAM)", suggest: ["SmolLM2-135M", "SmolLM2-360M"], quant: "q8_0", maxLength: 512, note: "Keep the model under about 400 MB so the phone has room for Android and the app." },
  { id: "mid", label: "Mid-range phone (6-8 GB RAM)", suggest: ["Qwen2.5-0.5B", "SmolLM2-360M"], quant: "q8_0", maxLength: 768, note: "Up to about 1 GB of model is comfortable." },
  { id: "flagship", label: "Flagship phone (12 GB or more RAM)", suggest: ["Qwen2.5-1.5B", "Qwen2.5-0.5B"], quant: "q4_k_m", maxLength: 1024, note: "A 1.5B model fits, but replies are slower; test the speed on the real phone." },
];

export const QUANTS = [
  { id: "f16", label: "f16 - best quality, largest (2 bytes per parameter)", bytesPerParam: 2.0 },
  { id: "q8_0", label: "q8_0 - almost f16 quality, half the size (about 1 byte per parameter)", bytesPerParam: 1.07 },
  { id: "q4_k_m", label: "q4_k_m - smallest (about 0.6 byte per parameter), loses most on tiny models", bytesPerParam: 0.6 },
];

/** Models offered for download for phones (Hugging Face names). */
export const MOBILE_MODELS = [
  { repo: "HuggingFaceTB/SmolLM2-135M-Instruct", note: "135M parameters, about 270 MB - fits any phone" },
  { repo: "HuggingFaceTB/SmolLM2-360M-Instruct", note: "360M parameters, about 720 MB" },
  { repo: "unsloth/Qwen2.5-0.5B-Instruct", note: "0.5B parameters, about 1 GB - multilingual" },
  { repo: "unsloth/Qwen2.5-1.5B-Instruct", note: "1.5B parameters, about 3 GB - trained with LoRA on 8 GB" },
];

/** Rough size of the finished GGUF in MB, from the parameter count (millions). */
export const ggufSizeMB = (paramsM: number, quant: string) => Math.round(paramsM * (QUANTS.find(q => q.id === quant)?.bytesPerParam ?? 2));

const clamp = (v: unknown, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
const lrOf = (v: unknown, d: string) => (/^[0-9.]+(e-?[0-9]+)?$/i.test(String(v ?? "")) ? String(v) : d);

export interface MobileConfig {
  baseModelDir: string; trainFile: string; testFile: string; outputDir: string; name: string;
  method: "auto" | "full" | "lora"; epochs: number; learningRate: string; batchSize: number; gradAccum: number; maxLength: number;
  evalPercent: number; match: "first_line" | "full"; maxSteps: number; rank: number; quant: "none" | "f16" | "q8_0" | "q4_k_m";
}

export function cleanMobile(raw: any): MobileConfig {
  const method = ["full", "lora"].includes(raw?.method) ? raw.method : "auto";
  const quant = ["f16", "q8_0", "q4_k_m"].includes(raw?.quant) ? raw.quant : "none";
  return {
    baseModelDir: String(raw?.baseModelDir || ""), trainFile: String(raw?.trainFile || ""), testFile: String(raw?.testFile || ""),
    outputDir: String(raw?.outputDir || ""), name: String(raw?.name || "").replace(/[^\w.-]/g, "").slice(0, 60),
    method, epochs: clamp(raw?.epochs, 3, 1, 50), learningRate: lrOf(raw?.learningRate, "1e-4"), batchSize: clamp(raw?.batchSize, 4, 1, 32),
    gradAccum: clamp(raw?.gradAccum, 1, 1, 32), maxLength: clamp(raw?.maxLength, 512, 64, 4096), evalPercent: clamp(raw?.evalPercent, 10, 0, 30),
    match: raw?.match === "full" ? "full" : "first_line", maxSteps: clamp(raw?.maxSteps, 0, 0, 100000), rank: clamp(raw?.rank, 32, 4, 128), quant,
  };
}

export function buildMobileArgs(c: MobileConfig, script: string): string[] {
  const a = [script, "--base", c.baseModelDir, "--train", c.trainFile, "--out", c.outputDir, "--name", c.name || "model",
    "--method", c.method, "--epochs", String(c.epochs), "--lr", c.learningRate, "--batch", String(c.batchSize), "--accum", String(c.gradAccum),
    "--max_length", String(c.maxLength), "--eval_percent", String(c.evalPercent), "--match", c.match, "--rank", String(c.rank), "--quant", c.quant];
  if (c.testFile) a.push("--test", c.testFile);
  if (c.maxSteps) a.push("--max_steps", String(c.maxSteps));
  return a;
}

export interface ChatCheck { rows: number; usable: number; skipped: number; longestChars: number; avgChars: number; problems: string[] }

/** Looks over a .jsonl: how many rows can be trained on, how long they are, and what is wrong with the rest. */
export function checkChat(text: string): ChatCheck {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  let usable = 0, longest = 0, total = 0;
  const problems: string[] = [];
  lines.forEach((l, i) => {
    let row: any;
    try { row = JSON.parse(l); } catch { if (problems.length < 5) problems.push(`line ${i + 1}: not valid JSON`); return; }
    let msgs: { role?: string; content?: any }[] | null = null;
    if (Array.isArray(row?.messages)) msgs = row.messages;
    else if (row?.instruction && row?.output) msgs = [{ role: "user", content: `${row.instruction}${row.input ? "\n" + row.input : ""}` }, { role: "assistant", content: row.output }];
    if (!msgs || msgs.length < 2) { if (problems.length < 5) problems.push(`line ${i + 1}: needs "messages" (user then assistant) or instruction and output`); return; }
    const last = msgs[msgs.length - 1];
    if (last.role !== "assistant" || !String(last.content ?? "").trim()) { if (problems.length < 5) problems.push(`line ${i + 1}: the last message must be the assistant's reply, and not empty`); return; }
    const chars = msgs.reduce((n, m) => n + String(m.content ?? "").length, 0);
    usable++; total += chars; longest = Math.max(longest, chars);
  });
  return { rows: lines.length, usable, skipped: lines.length - usable, longestChars: longest, avgChars: usable ? Math.round(total / usable) : 0, problems };
}
