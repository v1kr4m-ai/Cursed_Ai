import { describe, expect, it } from "vitest";
import { buildLlmArgs, buildLoraArgs, cleanLlm, cleanLora, loraDatasetToml, loraMissing, promptPreview } from "../trainTool/builders";
import { resolvePaths } from "../trainTool/paths";

const P = resolvePaths({ trainRoot: "C:\\t", fluxgymRoot: "C:\\fg" }, "C:\\app");

describe("training command builders", () => {
  it("clamps and cleans the LoRA settings that reach a command line", () => {
    const c = cleanLora({ triggerWord: "rich ie;01 &", datasetDir: "C:\\d", epochs: 99999, batchSize: 0, learningRate: "8e-4; rm", resolution: 999, vramPreset: "weird" });
    expect(c.triggerWord).toBe("richie01");
    expect(c.epochs).toBe(500);
    expect(c.batchSize).toBe(1);
    expect(c.learningRate).toBe("8e-4");
    expect(c.resolution).toBe(768);
    expect(c.vramPreset).toBe("8G");
  });

  it("uses fp8 and block swap for 8 GB, nothing extra for 20 GB", () => {
    const base = cleanLora({ triggerWord: "x", datasetDir: "d", outputDir: "o" });
    const a8 = buildLoraArgs({ ...base, vramPreset: "8G" }, P, "t.toml");
    expect(a8).toContain("--fp8_base");
    expect(a8[a8.indexOf("--blocks_to_swap") + 1]).toBe("18");
    const a20 = buildLoraArgs({ ...base, vramPreset: "20G" }, P, "t.toml");
    expect(a20).not.toContain("--fp8_base");
    expect(a20).toContain("--cache_text_encoder_outputs");
    expect(a20[a20.indexOf("--output_name") + 1]).toBe("x_flux_lora");
  });

  it("writes the kohya dataset file with escaped backslashes and no caption shuffling", () => {
    const t = loraDatasetToml(cleanLora({ triggerWord: "x", datasetDir: "C:\\data\\set", outputDir: "o", numRepeats: 7 }));
    expect(t).toContain("shuffle_caption = false");
    expect(t).toContain("image_dir = 'C:\\\\data\\\\set'");
    expect(t).toContain("num_repeats = 7");
  });

  it("only passes an Ollama name when exporting", () => {
    const base = cleanLlm({ baseModelDir: "m", datasetFile: "d.jsonl", outputDir: "o", ollamaName: "my-model" });
    expect(buildLlmArgs({ ...base, exportGguf: false }, "train.py")).not.toContain("--ollama_name");
    const on = buildLlmArgs({ ...base, exportGguf: true }, "train.py");
    expect(on).toContain("--export_gguf");
    expect(on[on.indexOf("--ollama_name") + 1]).toBe("my-model");
  });

  it("previews the exact prompt template the trainer uses", () => {
    expect(promptPreview({ instruction: "Say hi", output: "Hi" })).toBe("### Instruction:\nSay hi\n\n### Response:\nHi");
    expect(promptPreview({ instruction: "Sum", input: "1+1", output: "2" })).toContain("### Input:\n1+1");
  });

  it("builds the SDXL command: unet-only, cached encoders, 8-bit AdamW with bitsandbytes, Adafactor without", () => {
    const base = cleanLora({ base: "sdxl", triggerWord: "x", datasetDir: "d", outputDir: "o" });
    expect(base.learningRate).toBe("1e-4");
    const p = { ...P, sdxlBases: ["C:\c\sd_xl_base_1.0.safetensors"], hasBnb: true };
    const a = buildLoraArgs(base, p, "t.toml");
    expect(a[a.indexOf("--pretrained_model_name_or_path") + 1]).toBe("C:\c\sd_xl_base_1.0.safetensors");
    expect(a.some(x => x.endsWith("sdxl_train_network.py"))).toBe(true);
    expect(a).toEqual(expect.arrayContaining(["--network_train_unet_only", "--cache_text_encoder_outputs", "--gradient_checkpointing", "--sdpa"]));
    expect(a[a.indexOf("--optimizer_type") + 1]).toBe("AdamW8bit");
    expect(a[a.indexOf("--output_name") + 1]).toBe("x_sdxl_lora");
    expect(a).not.toContain("--fp8_base");
    const b = buildLoraArgs({ ...base, baseModelPath: "C:\c\juggernaut.safetensors" }, { ...p, hasBnb: false }, "t.toml");
    expect(b[b.indexOf("--optimizer_type") + 1]).toBe("Adafactor");
    expect(b[b.indexOf("--pretrained_model_name_or_path") + 1]).toBe("C:\c\juggernaut.safetensors");
  });

  it("builds the SD 1.5 command with train_network.py and no text-encoder caching", () => {
    const a = buildLoraArgs(cleanLora({ base: "sd15", triggerWord: "x", datasetDir: "d", outputDir: "o", resolution: 512 }), { ...P, sd15Bases: ["C:\c\dreamshaper_8.safetensors"], hasBnb: true }, "t.toml");
    expect(a.some(x => x.endsWith("train_network.py") && !x.endsWith("sdxl_train_network.py"))).toBe(true);
    expect(a).not.toContain("--cache_text_encoder_outputs");
    expect(a[a.indexOf("--output_name") + 1]).toBe("x_sd15_lora");
    expect(a[a.indexOf("--pretrained_model_name_or_path") + 1]).toBe("C:\c\dreamshaper_8.safetensors");
  });

  it("keeps the Flux command as it was (no base given means Flux)", () => {
    const c = cleanLora({ triggerWord: "x", datasetDir: "d", outputDir: "o" });
    expect(c.base).toBeUndefined();
    expect(c.learningRate).toBe("8e-4");
    const a = buildLoraArgs(c, P, "t.toml");
    expect(a.some(x => x.endsWith("flux_train_network.py"))).toBe(true);
    expect(a).toContain("--t5xxl");
  });

  it("checks readiness per base model", () => {
    const has = (ok: string[]) => (f: string) => ok.includes(f) || f === P.sdScripts || f === P.fluxAccelerate;
    expect(loraMissing("flux", P, has([P.fluxUnet, P.fluxClipL, P.fluxVae]))).toEqual(["t5xxl_fp16.safetensors"]);
    expect(loraMissing("flux", P, has([P.fluxUnet, P.fluxClipL, P.fluxT5, P.fluxVae]))).toEqual([]);
    expect(loraMissing("sdxl", { ...P, sdxlBases: ["a"] }, has([]))).toEqual([]);
    expect(loraMissing("sd15", P, has([]))).toHaveLength(1);
    expect(loraMissing("sdxl", { ...P, sdxlBases: ["a"] }, () => false)).toEqual(["kohya sd-scripts", "accelerate"]);
  });
});
