import { describe, expect, it } from "vitest";
import { buildLlmArgs, buildLoraArgs, cleanLlm, cleanLora, loraDatasetToml, promptPreview } from "../trainTool/builders";
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
});
