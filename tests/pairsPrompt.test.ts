import { describe, expect, it } from "vitest";
import { buildPairPrompt } from "../trainTool/sources";

describe("buildPairPrompt", () => {
  it("lists existing questions so a redo asks for different ones", () => {
    const p = buildPairPrompt({ count: 1, chunk: "text", avoid: ["What is X?"] });
    expect(p).toContain("write DIFFERENT ones");
    expect(p).toContain("* What is X?");
  });
  it("adds nothing when there is nothing to avoid", () => {
    expect(buildPairPrompt({ count: 3, chunk: "text" })).not.toContain("DIFFERENT");
  });
});
