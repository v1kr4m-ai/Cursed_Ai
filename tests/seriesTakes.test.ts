import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { takesIn } from "../seriesTool/takes";

describe("takesIn", () => {
  it("lists every render of one scene, oldest first, and nothing else", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "takes-"));
    const files = ["ep01_scene02.mp4", "ep01_scene02_20261025_154230.mp4", "ep01_scene02_20261025_154230_2.mp4", "ep01_scene12.mp4", "ep02_scene02.mp4", "ep01_scene02.png"];
    files.forEach((f, i) => { const p = path.join(dir, f); fs.writeFileSync(p, ""); fs.utimesSync(p, 1000 + i, 1000 + i); });
    expect(takesIn(dir, 1, 2).map(t => path.basename(t.path))).toEqual(files.slice(0, 3));
    expect(takesIn(path.join(dir, "missing"), 1, 2)).toEqual([]);
    fs.rmSync(dir, { recursive: true });
  });
});
