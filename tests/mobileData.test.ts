import { describe, expect, it } from "vitest";
import { buildMobileArgs, checkChat, cleanMobile, ggufSizeMB, PHONE_PRESETS } from "../trainTool/mobileData";

describe("cleanMobile", () => {
  it("clamps numbers, keeps known choices only, and sanitises the name", () => {
    const c = cleanMobile({ baseModelDir: "m", trainFile: "t.jsonl", epochs: 9999, batchSize: 0, maxLength: 5, learningRate: "1e-4; rm", method: "weird", quant: "q9", name: "my model!/x" });
    expect(c).toMatchObject({ epochs: 50, batchSize: 1, maxLength: 64, learningRate: "1e-4", method: "auto", quant: "none", name: "mymodelx" });
  });
  it("defaults suit a tiny model", () => {
    expect(cleanMobile({})).toMatchObject({ epochs: 3, learningRate: "1e-4", batchSize: 4, maxLength: 512, evalPercent: 10, match: "first_line" });
  });
});

describe("buildMobileArgs", () => {
  it("passes the settings and only adds the optional ones when set", () => {
    const base = buildMobileArgs(cleanMobile({ baseModelDir: "m", trainFile: "t", outputDir: "o", name: "n", quant: "q8_0" }), "s.py");
    expect(base.slice(0, 3)).toEqual(["s.py", "--base", "m"]);
    expect(base[base.indexOf("--quant") + 1]).toBe("q8_0");
    expect(base).not.toContain("--test");
    expect(buildMobileArgs(cleanMobile({ testFile: "x", maxSteps: 5 }), "s.py")).toEqual(expect.arrayContaining(["--test", "x", "--max_steps", "5"]));
  });
});

describe("checkChat", () => {
  const good = JSON.stringify({ messages: [{ role: "system", content: "s" }, { role: "user", content: "hi" }, { role: "assistant", content: "hello" }] });
  it("counts usable rows, accepts instruction/output rows, and explains the bad ones", () => {
    const r = checkChat([good, JSON.stringify({ instruction: "q", output: "a" }), "not json", JSON.stringify({ messages: [{ role: "user", content: "x" }] }), JSON.stringify({ messages: [{ role: "user", content: "x" }, { role: "assistant", content: "" }] })].join("\n"));
    expect(r).toMatchObject({ rows: 5, usable: 2, skipped: 3 });
    expect(r.problems).toHaveLength(3);
    expect(r.problems[0]).toContain("line 3");
  });
});

describe("presets and sizes", () => {
  it("estimates the GGUF size and offers a model per phone class", () => {
    expect(ggufSizeMB(135, "f16")).toBe(270);
    expect(ggufSizeMB(500, "q8_0")).toBeLessThan(ggufSizeMB(500, "f16"));
    expect(PHONE_PRESETS.map(p => p.id)).toEqual(["budget", "mid", "flagship"]);
  });
});
