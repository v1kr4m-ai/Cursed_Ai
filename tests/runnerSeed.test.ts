import { describe, it, expect } from "vitest";
import { injectWorkflow } from "../comfyTool/runner";

const info: any = { promptNodeId: null, promptKeys: [], refImageNodeIds: [], refVideoNodeIds: [], refAudioNodeIds: [], refKeys: {}, fields: [] };
const wf = { "1": { class_type: "KSampler", inputs: { seed: 5, steps: 20 } }, "2": { class_type: "RandomNoise", inputs: { noise_seed: 7 } } };

describe("injectWorkflow seeds", () => {
  it("sets a given seed on every seed input, and leaves seeds alone without one", () => {
    const g = injectWorkflow({ workflow: wf, info, promptText: "", refImageFilenames: [], seed: 42 });
    expect([g["1"].inputs.seed, g["2"].inputs.noise_seed, g["1"].inputs.steps]).toEqual([42, 42, 20]);
    const same = injectWorkflow({ workflow: wf, info, promptText: "", refImageFilenames: [] });
    expect([same["1"].inputs.seed, same["2"].inputs.noise_seed]).toEqual([5, 7]);
  });
});
