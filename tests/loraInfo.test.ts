import { describe, expect, it } from "vitest";
import { loraNeeds } from "../src/components/train/loraInfo";
import { loraRunInfo } from "../trainTool/builders";
import { resolvePaths } from "../trainTool/paths";

describe("LoRA file base", () => {
  it("reads the base from the file name", () => {
    expect(loraNeeds("veer_sdxl_lora.safetensors")?.label).toBe("works with SDXL checkpoints");
    expect(loraNeeds("veer_sdxl_lora-000004.safetensors")?.base).toBe("sdxl");
    expect(loraNeeds("a_sd15_lora.safetensors")?.base).toBe("sd15");
    expect(loraNeeds("a_flux_lora.safetensors")?.base).toBe("flux");
    expect(loraNeeds("other.safetensors")).toBeNull();
  });
  it("describes the run with the resolved checkpoint and file name", () => {
    const P = resolvePaths({ trainRoot: "C:/t", fluxgymRoot: "C:/fg" }, "C:/app");
    const i = loraRunInfo({ base: "sdxl", triggerWord: "veer", datasetDir: "C:/d/veer", outputDir: "C:/o", resolution: 768, batchSize: 1, numRepeats: 5, networkDim: 32, networkAlpha: 16, learningRate: "1e-4", epochs: 10, vramPreset: "8G" }, P, 20);
    expect(i.outputName).toBe("veer_sdxl_lora.safetensors");
    expect(i.datasetName).toBe("veer");
    expect(i.baseModelName).toBe(i.baseModel.split(/[\/]/).pop());
  });
});
