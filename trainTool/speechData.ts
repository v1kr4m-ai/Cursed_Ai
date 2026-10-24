/**
 * Pure helpers for the Train Speech page: the languages, reading a transcript list (a Common Voice .tsv or a "file|text" sheet),
 * and turning page settings into safe command lines for the Whisper and XTTS training scripts.
 */
import path from "path";

export interface SpeechLang {
  code: string;
  name: string;
  /** Whisper language code. */
  whisper: string;
  /** XTTS-v2 language code. */
  xtts: string;
  /** How a transcript is scored: words for spaced languages, characters for Chinese. */
  metric: "wer" | "cer";
}

export const LANGS: SpeechLang[] = [
  { code: "hi", name: "Hindi", whisper: "hi", xtts: "hi", metric: "wer" },
  { code: "ar", name: "Arabic", whisper: "ar", xtts: "ar", metric: "wer" },
  { code: "zh", name: "Chinese (Mandarin)", whisper: "zh", xtts: "zh-cn", metric: "cer" },
  { code: "en", name: "English", whisper: "en", xtts: "en", metric: "wer" },
];
export const langOf = (code: unknown): SpeechLang => LANGS.find(l => l.code === String(code)) || LANGS[0];

export const AUDIO_RE = /\.(wav|mp3|flac|m4a|ogg|opus|webm|aac)$/i;

/** Whisper sizes offered for download (with the memory they need to train on a small card). */
export const WHISPER_MODELS = [
  { repo: "openai/whisper-tiny", note: "39M parameters, about 150 MB - fastest, least accurate" },
  { repo: "openai/whisper-base", note: "74M parameters, about 290 MB" },
  { repo: "openai/whisper-small", note: "244M parameters, about 970 MB - a good balance on 8 GB" },
  { repo: "openai/whisper-medium", note: "769M parameters, about 3 GB - best, needs LoRA on 8 GB" },
];
export const XTTS_REPO = "coqui/XTTS-v2";

const stripBom = (s: string) => s.replace(/^﻿/, "");

/**
 * Transcripts from a sheet. Accepts a Common Voice style .tsv (columns "path" and "sentence"), or plain lines of
 * `file|text` or `file<TAB>text`. A header row is skipped. The file may be given with or without its extension.
 */
export function parseMeta(raw: string): { file: string; text: string }[] {
  const lines = stripBom(raw).split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const first = lines[0].split("\t").map(c => c.trim().toLowerCase());
  const pi = first.indexOf("path"), si = first.indexOf("sentence");
  const out: { file: string; text: string }[] = [];
  if (pi >= 0 && si >= 0) {
    for (const l of lines.slice(1)) { const c = l.split("\t"); if (c[pi]?.trim() && c[si]?.trim()) out.push({ file: c[pi].trim(), text: c[si].trim() }); }
    return out;
  }
  const sep = lines[0].includes("|") ? "|" : "\t";
  const header = new Set(["path", "file", "filename", "audio", "audio_file", "wav_filename", "id", "audio_id"]);
  lines.forEach((l, i) => {
    const c = l.split(sep);
    if (c.length < 2) return;
    if (i === 0 && header.has(c[0].trim().toLowerCase())) return;
    // an LJSpeech sheet has "id|text|normalized text": the middle column is the text
    const text = (c[1] || "").trim();
    if (c[0].trim() && text) out.push({ file: c[0].trim(), text });
  });
  return out;
}

/** The clip a sheet row names: by full name, or by name without extension. */
export function matchClip(file: string, clips: string[]): string | undefined {
  const base = path.basename(file.replace(/\\/g, "/"));
  const stem = (n: string) => n.replace(/\.[^.]+$/, "").toLowerCase();
  return clips.find(c => c === base) || clips.find(c => c.toLowerCase() === base.toLowerCase()) || clips.find(c => stem(c) === stem(base));
}

const clamp = (v: unknown, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
const lrOf = (v: unknown, d: string) => (/^[0-9.]+(e-?[0-9]+)?$/i.test(String(v ?? "")) ? String(v) : d);

export interface SttConfig { baseModel: string; datasetDir: string; outputDir: string; language: string; method: "lora" | "full"; epochs: number; learningRate: string; batchSize: number; gradAccum: number; rank: number; evalPercent: number; maxSteps: number }
export function cleanStt(raw: any): SttConfig {
  const method = raw?.method === "full" ? "full" : "lora";
  return {
    baseModel: String(raw?.baseModel || ""), datasetDir: String(raw?.datasetDir || ""), outputDir: String(raw?.outputDir || ""),
    language: langOf(raw?.language).whisper, method,
    epochs: clamp(raw?.epochs, 5, 1, 100), learningRate: lrOf(raw?.learningRate, method === "lora" ? "1e-3" : "1e-5"),
    batchSize: clamp(raw?.batchSize, 8, 1, 32), gradAccum: clamp(raw?.gradAccum, 2, 1, 64), rank: clamp(raw?.rank, 32, 4, 128),
    evalPercent: clamp(raw?.evalPercent, 10, 0, 30), maxSteps: clamp(raw?.maxSteps, 0, 0, 100000),
  };
}
export function buildSttArgs(c: SttConfig, script: string): string[] {
  const a = [script, "--base_model", c.baseModel, "--dataset", c.datasetDir, "--output_dir", c.outputDir, "--language", c.language, "--method", c.method,
    "--epochs", String(c.epochs), "--learning_rate", c.learningRate, "--batch_size", String(c.batchSize), "--grad_accum", String(c.gradAccum), "--rank", String(c.rank), "--eval_percent", String(c.evalPercent)];
  if (c.maxSteps) a.push("--max_steps", String(c.maxSteps));
  return a;
}

export interface TtsConfig { modelDir: string; datasetDir: string; outputDir: string; language: string; epochs: number; batchSize: number; gradAccum: number; learningRate: string }
export function cleanTts(raw: any): TtsConfig {
  return {
    modelDir: String(raw?.modelDir || ""), datasetDir: String(raw?.datasetDir || ""), outputDir: String(raw?.outputDir || ""),
    language: langOf(raw?.language).xtts,
    epochs: clamp(raw?.epochs, 6, 1, 100), batchSize: clamp(raw?.batchSize, 2, 1, 8), gradAccum: clamp(raw?.gradAccum, 8, 1, 128), learningRate: lrOf(raw?.learningRate, "5e-6"),
  };
}
export function buildTtsArgs(c: TtsConfig, script: string): string[] {
  return [script, "--model_dir", c.modelDir, "--dataset", c.datasetDir, "--output_dir", c.outputDir, "--language", c.language,
    "--epochs", String(c.epochs), "--batch_size", String(c.batchSize), "--grad_accum", String(c.gradAccum), "--learning_rate", c.learningRate];
}

/** A safe folder or file name: letters (any script), digits, space, dash, underscore. */
export const safeName = (s: unknown) => String(s ?? "").replace(/[^\p{L}\p{M}\p{N} _-]/gu, "").trim().slice(0, 60);
