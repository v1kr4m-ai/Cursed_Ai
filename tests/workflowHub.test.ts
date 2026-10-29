import { describe, expect, it } from "vitest";
import { formatOf, rawUrl, safeName } from "../workflowHub";

describe("workflow downloads", () => {
  it("makes a safe file name from a title", () => {
    expect(safeName("Nano Banana 2.1: Text to Image")).toBe("Nano Banana 2.1 - Text to Image");
    expect(safeName("  ../../evil?*  ")).toBe("evil");
    expect(safeName("")).toBe("workflow");
  });

  it("tells ComfyUI's own format from the API format", () => {
    expect(formatOf({ nodes: [{ id: 1 }], links: [] })).toBe("ui");
    expect(formatOf({ nodes: [], links: [] })).toBeNull();
    expect(formatOf({ "3": { class_type: "KSampler", inputs: {} } })).toBe("api");
    expect(formatOf({ hello: "world" })).toBeNull();
    expect(formatOf([1, 2])).toBeNull();
  });

  it("turns a GitHub page link into the raw file link", () => {
    expect(rawUrl("https://github.com/Comfy-Org/workflow_templates/blob/main/templates/a.json")).toBe("https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/templates/a.json");
    expect(rawUrl("https://example.com/x.json")).toBe("https://example.com/x.json");
  });
});
