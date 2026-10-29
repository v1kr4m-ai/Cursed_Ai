import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { remakeApiCopy, syncApiCopies } from "../comfyTool/apiSync";

const oi = { SaveImage: { input: { required: { filename_prefix: ["STRING", {}] } }, input_order: { required: ["filename_prefix"] } } };
const ui = (prefix: string) => JSON.stringify({ nodes: [{ id: 1, type: "SaveImage", inputs: [], widgets_values: [prefix] }], links: [] });
const touch = (f: string, t: number) => fs.utimesSync(f, new Date(t), new Date(t));

describe("API copies follow the editor's version", () => {
  it("makes missing copies, leaves existing ones alone at first, and follows later edits", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-"));
    fs.mkdirSync(path.join(dir, "API_FORMAT"));
    fs.writeFileSync(path.join(dir, "new.json"), ui("a"));
    fs.writeFileSync(path.join(dir, "old.json"), ui("b"));
    fs.writeFileSync(path.join(dir, "API_FORMAT", "old.json"), '{"hand":"made"}');
    touch(path.join(dir, "API_FORMAT", "old.json"), 1_000_000_000_000);
    const first = syncApiCopies(dir, oi);
    expect(first.made).toEqual(["new"]);
    expect(fs.readFileSync(path.join(dir, "API_FORMAT", "old.json"), "utf8")).toBe('{"hand":"made"}');
    expect(JSON.parse(fs.readFileSync(path.join(dir, "API_FORMAT", "new.json"), "utf8"))["1"].inputs.filename_prefix).toBe("a");
    // the editor saves old.json again: now its copy follows
    fs.writeFileSync(path.join(dir, "old.json"), ui("c"));
    touch(path.join(dir, "old.json"), Date.now() + 5000);
    expect(syncApiCopies(dir, oi).updated).toEqual(["old"]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "API_FORMAT", "old.json"), "utf8"))["1"].inputs.filename_prefix).toBe("c");
    expect(syncApiCopies(dir, null).made).toEqual([]);
  });

  it("remakes one copy on request, from either file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wf-"));
    fs.mkdirSync(path.join(dir, "API_FORMAT"));
    fs.writeFileSync(path.join(dir, "w.json"), ui("z"));
    fs.writeFileSync(path.join(dir, "API_FORMAT", "w.json"), "{}");
    remakeApiCopy(path.join(dir, "API_FORMAT", "w.json"), oi);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "API_FORMAT", "w.json"), "utf8"))["1"].inputs.filename_prefix).toBe("z");
    expect(() => remakeApiCopy(path.join(dir, "API_FORMAT", "nope.json"), oi)).toThrow();
  });
});
