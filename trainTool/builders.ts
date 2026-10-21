/** Command lines for the two training backends: kohya sd-scripts (Flux LoRA) and the Unsloth QLoRA script. Pure, so they can be tested. */
import fs from "fs";
import os from "os";
import path from "path";
import type { TrainPaths } from "./paths";

export interface LoraConfig {
  triggerWord: string;
  datasetDir: string;
  outputDir: string;
  baseModelPath?: string;
  resolution: number;
  batchSize: number;
  numRepeats: number;
  networkDim: number;
  networkAlpha: number;
  learningRate: string | number;
  epochs: number;
  vramPreset: "8G" | "12G" | "16G" | "20G";
  seed?: number;
}

export interface LlmConfig {
  baseModelDir: string;
  datasetFile: string;
  outputDir: string;
  rank: number;
  alpha: number;
  epochs: number;
  learningRate: string | number;
  batchSize: number;
  maxSeqLength: number;
  exportGguf: boolean;
  ollamaName?: string;
}

/** kohya reads the dataset from a small TOML file. shuffle_caption must stay off: the text-encoder outputs are cached (needed for 8 GB cards). */
export function loraDatasetToml(cfg: LoraConfig): string {
  const dir = cfg.datasetDir.replace(/\\/g, "\\\\");
  return `[general]
shuffle_caption = false
caption_extension = '.txt'
keep_tokens = 1

[[datasets]]
resolution = ${cfg.resolution}
batch_size = ${cfg.batchSize}

  [[datasets.subsets]]
  image_dir = '${dir}'
  class_tokens = '${cfg.triggerWord}'
  num_repeats = ${cfg.numRepeats}
`;
}

export function buildLoraArgs(cfg: LoraConfig, p: TrainPaths, tomlPath: string): string[] {
  const args = [
    "launch", "--mixed_precision", "bf16", "--num_cpu_threads_per_process", "1",
    path.join(p.sdScripts, "flux_train_network.py"),
    "--pretrained_model_name_or_path", cfg.baseModelPath || p.fluxUnet,
    "--clip_l", p.fluxClipL, "--t5xxl", p.fluxT5, "--ae", p.fluxVae,
    "--dataset_config", tomlPath,
    "--output_dir", cfg.outputDir,
    "--output_name", `${cfg.triggerWord}_flux_lora`,
    "--save_model_as", "safetensors",
    "--network_module", "networks.lora_flux",
    "--network_dim", String(cfg.networkDim), "--network_alpha", String(cfg.networkAlpha),
    "--learning_rate", String(cfg.learningRate),
    "--max_train_epochs", String(cfg.epochs), "--save_every_n_epochs", "1",
    "--seed", String(cfg.seed ?? 42),
    "--optimizer_type", "adamw8bit",
    "--gradient_checkpointing", "--cache_latents_to_disk",
    "--cache_text_encoder_outputs", "--cache_text_encoder_outputs_to_disk",
    "--sdpa",
    // Datasets are small, and multiprocess CUDA dataloader workers are a known source of access-violation crashes on Windows.
    "--max_data_loader_n_workers", "0",
    "--timestep_sampling", "shift", "--model_prediction_type", "raw", "--guidance_scale", "1.0",
  ];
  // Low-VRAM presets: fp8 base weights, and transformer blocks swapped out to system RAM.
  if (cfg.vramPreset === "8G") args.push("--fp8_base", "--blocks_to_swap", "18");
  else if (cfg.vramPreset === "12G") args.push("--fp8_base", "--blocks_to_swap", "8");
  else if (cfg.vramPreset === "16G") args.push("--fp8_base");
  return args;
}

export function writeLoraToml(cfg: LoraConfig): string {
  const file = path.join(os.tmpdir(), `lora_dataset_${Date.now()}.toml`);
  fs.writeFileSync(file, loraDatasetToml(cfg), "utf8");
  return file;
}

export function buildLlmArgs(cfg: LlmConfig, scriptPath: string): string[] {
  const args = [
    scriptPath,
    "--base_model", cfg.baseModelDir, "--dataset", cfg.datasetFile, "--output_dir", cfg.outputDir,
    "--r", String(cfg.rank), "--alpha", String(cfg.alpha), "--epochs", String(cfg.epochs),
    "--learning_rate", String(cfg.learningRate), "--batch_size", String(cfg.batchSize), "--max_seq_length", String(cfg.maxSeqLength),
  ];
  if (cfg.exportGguf) args.push("--export_gguf");
  if (cfg.exportGguf && cfg.ollamaName?.trim()) args.push("--ollama_name", cfg.ollamaName.trim());
  return args;
}

/** The text a training example becomes - shown in the page so there is no guessing what the model sees. */
export function promptPreview(ex: { instruction?: string; input?: string; output?: string }): string {
  const inp = (ex.input || "").trim();
  return `### Instruction:\n${(ex.instruction || "").trim()}\n${inp ? `\n### Input:\n${inp}\n` : ""}\n### Response:\n${(ex.output || "").trim()}`;
}

/** Whole numbers and sensible ranges only: these end up on a command line. */
export function cleanLora(raw: any): LoraConfig {
  const n = (v: any, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
  const lr = String(raw?.learningRate ?? "8e-4");
  return {
    triggerWord: String(raw?.triggerWord || "").replace(/[^\w-]/g, "").slice(0, 40),
    datasetDir: String(raw?.datasetDir || ""), outputDir: String(raw?.outputDir || ""), baseModelPath: raw?.baseModelPath ? String(raw.baseModelPath) : undefined,
    resolution: [512, 768, 1024].includes(Number(raw?.resolution)) ? Number(raw.resolution) : 768,
    batchSize: n(raw?.batchSize, 1, 1, 8), numRepeats: n(raw?.numRepeats, 10, 1, 100), networkDim: n(raw?.networkDim, 16, 1, 256), networkAlpha: n(raw?.networkAlpha, 16, 1, 256),
    learningRate: /^[0-9.]+(e-?[0-9]+)?$/i.test(lr) ? lr : "8e-4", epochs: n(raw?.epochs, 16, 1, 500),
    vramPreset: ["8G", "12G", "16G", "20G"].includes(raw?.vramPreset) ? raw.vramPreset : "8G", seed: n(raw?.seed, 42, 0, 2 ** 31 - 1),
  };
}

export function cleanLlm(raw: any): LlmConfig {
  const n = (v: any, d: number, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d; };
  const lr = String(raw?.learningRate ?? "2e-4");
  return {
    baseModelDir: String(raw?.baseModelDir || ""), datasetFile: String(raw?.datasetFile || ""), outputDir: String(raw?.outputDir || ""),
    rank: n(raw?.rank, 16, 1, 256), alpha: n(raw?.alpha, 16, 1, 256), epochs: n(raw?.epochs, 3, 1, 100),
    learningRate: /^[0-9.]+(e-?[0-9]+)?$/i.test(lr) ? lr : "2e-4", batchSize: n(raw?.batchSize, 2, 1, 64), maxSeqLength: n(raw?.maxSeqLength, 2048, 128, 16384),
    exportGguf: !!raw?.exportGguf, ollamaName: String(raw?.ollamaName || "").replace(/[^\w.:/-]/g, "").slice(0, 80),
  };
}
