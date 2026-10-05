import { describe, it, expect } from "vitest";
import { inferFlags } from "../src/lib/modelTags";

describe("inferFlags", () => {
  it("flags reasoning, coding, vision from names", () => {
    expect(inferFlags("deepseek-r1:8b")).toContain("Reasoning");
    expect(inferFlags("qwen3-coder:30b")).toContain("Coding");
    expect(inferFlags("llava:latest")).toContain("Vision");
    expect(inferFlags("qwen2.5vl:7b")).toContain("Vision");
  });
  it("trusts the host's own capability list", () => {
    expect(inferFlags("mystery", [], ["vision", "tools"]).sort()).toEqual(["Tools", "Vision"]);
    expect(inferFlags("mystery", [], ["thinking"])).toContain("Reasoning");
  });
  it("returns nothing for a plain model", () => {
    expect(inferFlags("phi-3-mini")).toEqual([]);
  });
});
