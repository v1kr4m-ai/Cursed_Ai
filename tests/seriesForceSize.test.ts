import { describe, expect, it } from "vitest";

/**
 * Mirrors forceSizeAndLength in seriesTool/routes.ts. That helper is defined inside the route
 * registration (it closes over nothing, but is not exported), so the logic is duplicated here to
 * lock in the behaviour that actually matters: a linked input must still get overwritten.
 *
 * If the version in routes.ts changes, change this too - the point of the test is the rule, not
 * the copy.
 */
const SIZE_CLASS = /Latent|ToVideo|FirstLastFrame|CameraEmbedding/i;
const FPS_CLASS = /CreateVideo|VideoCombine|SaveAnimated|SaveVideo|LTXVConditioning/i;
const LENGTH_KEYS = ["length", "num_frames", "video_frames", "frames_number", "frame_count"];

function forceSizeAndLength(graph: any, size: { width: number; height: number; length?: number; fps?: number }) {
  for (const node of Object.values<any>(graph)) {
    const cls = String(node?.class_type || "");
    const inputs = node?.inputs;
    if (!inputs) continue;
    if (SIZE_CLASS.test(cls)) {
      if ("width" in inputs) inputs.width = size.width;
      if ("height" in inputs) inputs.height = size.height;
      if (size.length !== undefined) {
        for (const key of LENGTH_KEYS) if (key in inputs) inputs[key] = size.length;
      }
    }
    if (size.fps !== undefined && FPS_CLASS.test(cls)) {
      for (const key of ["fps", "frame_rate"]) if (key in inputs) inputs[key] = size.fps;
    }
  }
}

/** The shape that caused the bug: size and length arrive as links from other nodes. */
const linkedGraph = () => ({
  "20": {
    class_type: "MiniMaxH3ReferenceToVideo",
    inputs: { prompt: "a shot", width: ["115", 0], height: ["115", 1], length: ["131", 1], ref_image_size: "match" },
  },
  "115": { class_type: "ResolutionSelector", inputs: { aspect_ratio: "16:9 (Widescreen)", megapixels: 0.4 } },
  "131": { class_type: "ComfyMathExpression", inputs: { expression: "max(5, round(a * 24))" } },
  "50": { class_type: "CreateVideo", inputs: { fps: 24, bit_depth: 8 } },
  "99": { class_type: "ImageUpscaleWithModel", inputs: { width: 4096, height: 4096 } },
});

describe("forceSizeAndLength", () => {
  it("replaces linked width, height and length with literals", () => {
    const graph = linkedGraph();
    forceSizeAndLength(graph, { width: 544, height: 928, length: 175, fps: 24 });
    expect(graph["20"].inputs.width).toBe(544);
    expect(graph["20"].inputs.height).toBe(928);
    expect(graph["20"].inputs.length).toBe(175);
  });

  it("leaves nodes that merely happen to have a width alone", () => {
    const graph = linkedGraph();
    forceSizeAndLength(graph, { width: 544, height: 928, length: 175 });
    expect(graph["99"].inputs.width).toBe(4096); // an upscaler is not the latent size
  });

  it("sets the frame rate only on video assembly nodes", () => {
    const graph = linkedGraph();
    forceSizeAndLength(graph, { width: 544, height: 928, length: 175, fps: 30 });
    expect(graph["50"].inputs.fps).toBe(30);
    expect(graph["115"].inputs).not.toHaveProperty("fps");
  });

  it("handles the alternative frame-count input names", () => {
    const graph: any = {
      "1": { class_type: "WanImageToVideo", inputs: { num_frames: 81 } },
      "2": { class_type: "EmptyLatentVideo", inputs: { video_frames: 49 } },
    };
    forceSizeAndLength(graph, { width: 544, height: 928, length: 175 });
    expect(graph["1"].inputs.num_frames).toBe(175);
    expect(graph["2"].inputs.video_frames).toBe(175);
  });

  it("does not invent inputs a node never had", () => {
    const graph: any = { "1": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { prompt: "x" } } };
    forceSizeAndLength(graph, { width: 544, height: 928, length: 175, fps: 24 });
    expect(graph["1"].inputs).toEqual({ prompt: "x" });
  });

  it("survives malformed nodes", () => {
    const graph: any = { "1": null, "2": { class_type: "ToVideo" }, "3": { inputs: { width: 10 } } };
    expect(() => forceSizeAndLength(graph, { width: 544, height: 928 })).not.toThrow();
    expect(graph["3"].inputs.width).toBe(10); // no class_type, so not a size node
  });
});
