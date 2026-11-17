import { describe, it, expect } from "vitest";
import { convertUiWorkflow } from "../comfyTool/convert";

// SaveVideo.codec is a COMFY_DYNAMICCOMBO_V3: an older save has no value for it, so the default must be the option's key.
const oi = { SaveVideo: {
  input: { required: { video: ["VIDEO", {}], format: ["COMBO", { options: ["auto", "mp4"] }], codec: ["COMFY_DYNAMICCOMBO_V3", { options: [{ key: "auto", inputs: { required: {} } }, { key: "h264", inputs: { required: {} } }] }] } },
  input_order: { required: ["video", "format", "codec"] },
} };

describe("convertUiWorkflow dynamic combo", () => {
  it("fills a missing dynamic combo with its first option's key, not the option object", () => {
    const ui = { nodes: [{ id: 1, type: "SaveVideo", inputs: [], widgets_values: ["auto"] }], links: [] };
    expect(convertUiWorkflow(ui, oi).apiWorkflow["1"].inputs.codec).toBe("auto");
  });
});
