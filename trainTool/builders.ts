/** Command lines for the two training backends: kohya sd-scripts (Flux LoRA) and the Unsloth QLoRA script. Pure, so they can be tested. */
import fs from "fs";
import os from "os";
import path from "path";
import type { TrainPaths } from "./paths";

export type LoraBase = "flux" | "sdxl" | "sd15";
export const LORA_BASES: LoraBase[] = ["flux", "sdxl", "sd15"];

export interface LoraConfig {
  /** Which base model to train on; missing means flux. */
  base?: LoraBase;
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

/** SDXL and SD 1.5 LoRAs (kohya train_network.py family). Same memory savers for both; SDXL also caches the text-encoder outputs. */
function buildSdArgs(cfg: LoraConfig, p: TrainPaths, tomlPath: string): string[] {
  const xl = cfg.base === "sdxl";
  const bases = xl ? p.sdxlBases : p.sd15Bases;
  const args = [
    "launch", "--mixed_precision", "bf16", "--num_cpu_threads_per_process", "1",
    path.join(p.sdScripts, xl ? "sdxl_train_network.py" : "train_network.py"),
    "--pretrained_model_name_or_path", cfg.baseModelPath || bases[0] || "",
    "--dataset_config", tomlPath,
    "--output_dir", cfg.outputDir,
    "--output_name", `${cfg.triggerWord}_${xl ? "sdxl" : "sd15"}_lora`,
    "--save_model_as", "safetensors", "--save_precision", "fp16", "--mixed_precision", "bf16",
    "--network_module", "networks.lora", "--network_train_unet_only",
    "--network_dim", String(cfg.networkDim), "--network_alpha", String(cfg.networkAlpha),
    "--learning_rate", String(cfg.learningRate),
    "--max_train_epochs", String(cfg.epochs), "--save_every_n_epochs", "1",
    "--seed", String(cfg.seed ?? 42),
    "--gradient_checkpointing", "--cache_latents", "--cache_latents_to_disk", "--sdpa",
    "--max_data_loader_n_workers", "0",
  ];
  if (xl) args.push("--cache_text_encoder_outputs", "--cache_text_encoder_outputs_to_disk");
  // 8-bit AdamW needs bitsandbytes; Adafactor (fixed rate) is the fallback without it.
  if (p.hasBnb) args.push("--optimizer_type", "AdamW8bit");
  else args.push("--optimizer_type", "Adafactor", "--optimizer_args", "scale_parameter=False", "relative_step=False", "warmup_init=False");
  return args;
}

/** What is missing for the chosen base model (labels for the page). Flux needs its four weight files; SDXL / SD 1.5 only a checkpoint. */
export function loraMissing(base: LoraBase, p: TrainPaths, has: (f: string) => boolean = fs.existsSync): string[] {
  const m: string[] = [];
  if (base === "flux") {
    for (const [label, f] of [["Flux checkpoint (flux1-dev.sft)", p.fluxUnet], ["clip_l", p.fluxClipL], ["t5xxl_fp16.safetensors", p.fluxT5], ["VAE (ae.sft)", p.fluxVae]] as const) if (!has(f)) m.push(label);
  } else if (!(base === "sdxl" ? p.sdxlBases : p.sd15Bases).length) m.push(base === "sdxl" ? "an SDXL checkpoint (sd_xl_base_1.0.safetensors) in ComfyUI's checkpoints folder" : "an SD 1.5 checkpoint (dreamshaper_8 or sd15.safetensors) in ComfyUI's checkpoints folder");
  for (const [label, f] of [["kohya sd-scripts", p.sdScripts], ["accelerate", p.fluxAccelerate]] as const) if (!has(f)) m.push(label);
  return m;
}

export function buildLoraArgs(cfg: LoraConfig, p: TrainPaths, tomlPath: string): string[] {
  if (cfg.base === "sdxl" || cfg.base === "sd15") return buildSdArgs(cfg, p, tomlPath);
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
  const base: LoraBase = LORA_BASES.includes(raw?.base) ? raw.base : "flux";
  const dLr = base === "flux" ? "8e-4" : "1e-4";
  const lr = String(raw?.learningRate ?? dLr);
  return {
    ...(base === "flux" ? {} : { base }),
    triggerWord: String(raw?.triggerWord || "").replace(/[^\w-]/g, "").slice(0, 40),
    datasetDir: String(raw?.datasetDir || ""), outputDir: String(raw?.outputDir || ""), baseModelPath: raw?.baseModelPath ? String(raw.baseModelPath) : undefined,
    resolution: [512, 768, 1024].includes(Number(raw?.resolution)) ? Number(raw.resolution) : 768,
    batchSize: n(raw?.batchSize, 1, 1, 8), numRepeats: n(raw?.numRepeats, 10, 1, 100), networkDim: n(raw?.networkDim, 16, 1, 256), networkAlpha: n(raw?.networkAlpha, 16, 1, 256),
    learningRate: /^[0-9.]+(e-?[0-9]+)?$/i.test(lr) ? lr : dLr, epochs: n(raw?.epochs, 16, 1, 500),
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
