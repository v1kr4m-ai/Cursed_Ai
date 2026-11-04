import { describe, expect, it } from "vitest";
import { buildFaceSwapArgs } from "../trainTool/faceswap";

const base = { sources: ["a.png", "b.jpg"], target: "t.mp4", output: "out/x.mp4", model: "hyperswap_1a_256", ffDir: "ff", script: "run.py" };

describe("buildFaceSwapArgs", () => {
  it("runs headless on the GPU with every source photo and the first face only", () => {
    const a = buildFaceSwapArgs(base);
    expect(a.slice(0, 3)).toEqual(["run.py", "ff", "headless-run"]);
    expect(a.slice(a.indexOf("--source-paths") + 1, a.indexOf("--target-path"))).toEqual(["a.png", "b.jpg"]);
    expect(a[a.indexOf("--processors") + 1]).toBe("face_swapper");
    expect(a[a.indexOf("--face-selector-mode") + 1]).toBe("one");
    expect(a[a.indexOf("--execution-providers") + 1]).toBe("cuda");
    expect(a).not.toContain("face_enhancer");
  });

  it("adds the enhancer and swaps every face when asked", () => {
    const a = buildFaceSwapArgs({ ...base, enhancer: "gfpgan_1.4", allFaces: true });
    expect(a.slice(a.indexOf("--processors") + 1, a.indexOf("--processors") + 3)).toEqual(["face_swapper", "face_enhancer"]);
    expect(a[a.indexOf("--face-enhancer-model") + 1]).toBe("gfpgan_1.4");
    expect(a[a.indexOf("--face-selector-mode") + 1]).toBe("many");
  });
});
