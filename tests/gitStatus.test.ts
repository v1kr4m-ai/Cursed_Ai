import { describe, expect, it } from "vitest";
import { parsePorcelain } from "../gitStatus";

describe("git status", () => {
  it("reads changed, new, deleted and renamed files", () => {
    expect(parsePorcelain(" M src/a.ts\n?? notes.md\n D old.txt\nR  b.ts -> c.ts\nA  \"with space.ts\"\n")).toEqual([
      { path: "src/a.ts", status: "M" }, { path: "notes.md", status: "?" }, { path: "old.txt", status: "D" }, { path: "c.ts", status: "R" }, { path: "with space.ts", status: "A" },
    ]);
  });
});
