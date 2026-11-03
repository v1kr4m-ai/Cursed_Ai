import { describe, it, expect } from "vitest";
import { matchModelFiles } from "../comfyTool/registry";

const oi = { ImageOnlyCheckpointLoader: { input: { required: { ckpt_name: [["sd15.safetensors", "3D Modelling\\hunyuan_3d_v2.1.safetensors", "a\\twin.safetensors", "b\\twin.safetensors"]] } } } };

describe("matchModelFiles", () => {
  it("finds a model ComfyUI keeps in a subfolder, and leaves listed or ambiguous names alone", () => {
    const g: any = {
      1: { class_type: "ImageOnlyCheckpointLoader", inputs: { ckpt_name: "hunyuan_3d_v2.1.safetensors" } },
      2: { class_type: "ImageOnlyCheckpointLoader", inputs: { ckpt_name: "sd15.safetensors" } },
      3: { class_type: "ImageOnlyCheckpointLoader", inputs: { ckpt_name: "twin.safetensors" } },
    };
    matchModelFiles(g, oi);
    expect(g[1].inputs.ckpt_name).toBe("3D Modelling\\hunyuan_3d_v2.1.safetensors");
    expect(g[2].inputs.ckpt_name).toBe("sd15.safetensors");
    expect(g[3].inputs.ckpt_name).toBe("twin.safetensors");
  });
});
