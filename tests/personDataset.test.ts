import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { buildDataset, triggerFor } from "../trainTool/personDataset";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "persondata-"));
const photo = (dir: string, name: string, content: string) => { const f = path.join(dir, name); fs.writeFileSync(f, content); return f; };

describe("a LoRA dataset from a person's photos", () => {
  it("makes a rare trigger word from the name", () => {
    expect(triggerFor("Ann")).toBe("ann01");
    expect(triggerFor("Mary Jane O'Neil")).toBe("maryjaneoneil01");
    expect(triggerFor("???")).toBe("person01");
  });

  it("copies each photo with a caption holding the trigger word", () => {
    const src = tmp(), dir = path.join(tmp(), "ann01");
    const r = buildDataset({ dir, trigger: "ann01", photos: [photo(src, "a.png", "one"), photo(src, "b.JPG", "two")] });
    expect(r).toMatchObject({ added: 2, skipped: 0, total: 2 });
    expect(fs.readdirSync(dir).sort()).toEqual(["ann01_01.png", "ann01_01.txt", "ann01_02.jpg", "ann01_02.txt"]);
    expect(fs.readFileSync(path.join(dir, "ann01_01.txt"), "utf8")).toBe("ann01");
  });

  it("tops up later without adding the same picture twice", () => {
    const src = tmp(), dir = path.join(tmp(), "ann01");
    const a = photo(src, "a.png", "one");
    buildDataset({ dir, trigger: "ann01", photos: [a] });
    const r = buildDataset({ dir, trigger: "ann01", photos: [a, photo(src, "copy-of-a.png", "one"), photo(src, "c.png", "three"), path.join(src, "missing.png"), photo(src, "notes.txt", "x")] });
    expect(r).toMatchObject({ added: 1, skipped: 4, total: 2 });
    expect(fs.existsSync(path.join(dir, "ann01_02.png"))).toBe(true);
  });
});
