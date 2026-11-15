import { describe, expect, it } from "vitest";
import { describeFields } from "../comfyTool/titler";
import { injectWorkflow } from "../comfyTool/runner";

const objectInfo = {
  SaveVideo: { input: { required: { video: ["VIDEO", {}], filename_prefix: ["STRING", {}], format: ["COMBO", { options: ["auto", "mp4"] }], codec: ["COMFY_DYNAMICCOMBO_V3", { options: [{ key: "auto", inputs: { required: {} } }, { key: "h264", inputs: { required: {} } }] }] } } },
};
const graph = { "20": { class_type: "SaveVideo", inputs: { video: ["19", 0], filename_prefix: "video/x", format: "auto", codec: "auto" } } };

describe("dynamic combo fields (SaveVideo codec)", () => {
  it("are offered as a choice of their keys, not free text", () => {
    const f = describeFields(graph, null, null, null, objectInfo).find((x: any) => x.id === "20.codec") as any;
    expect(f.kind).toBe("select");
    expect(f.options).toEqual(["auto", "h264"]);
  });
  it("an emptied choice keeps the workflow's own value instead of dropping the input", () => {
    const fields = describeFields(graph, null, null, null, objectInfo);
    const info: any = { promptNodeId: null, promptKeys: [], refImageNodeIds: [], refVideoNodeIds: [], refAudioNodeIds: [], refKeys: {}, fields };
    const out: any = injectWorkflow({ workflow: graph, info, promptText: "", refImageFilenames: [], refVideoFilenames: [], refAudioFilenames: [], fieldValues: { "20.codec": "" }, randomizeSeed: false } as any);
    expect(out["20"].inputs.codec).toBe("auto");
  });
});
