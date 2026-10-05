import { describe, it, expect } from "vitest";
import { fitFor, paramsToBytes, parseSize } from "../src/lib/ramFit";

const GB = 1024 ** 3;
const pc = { totalBytes: 32 * GB, freeBytes: 3 * GB }; // total decides; low free memory only adds a warning

describe("fitFor", () => {
  it("small model fits, even when free memory is low", () => {
    const f = fitFor(4 * GB, pc)!;
    expect(f.level).toBe("ok");
    expect(f.detail).toMatch(/Free memory is low/);
  });
  it("big model is tight, huge is too big", () => {
    expect(fitFor(20 * GB, pc)!.level).toBe("tight");
    expect(fitFor(40 * GB, pc)!.level).toBe("no");
  });
  it("unknown size or system gives no verdict", () => {
    expect(fitFor(undefined, pc)).toBeNull();
    expect(fitFor(4 * GB, null)).toBeNull();
  });
});

describe("size helpers", () => {
  it("parses parameter counts and file sizes", () => {
    expect(paramsToBytes("8b")).toBeCloseTo(4.8e9);
    expect(paramsToBytes("135m")).toBeCloseTo(81e6);
    expect(paramsToBytes("latest")).toBeUndefined();
    expect(parseSize("2 GB")).toBe(2 * GB);
    expect(parseSize("600 MB")).toBe(600 * 1024 ** 2);
    expect(parseSize("n/a")).toBeUndefined();
  });
});
