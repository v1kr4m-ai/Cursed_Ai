import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createLocalModels } from "../localModels";

let root: string;
const w = (p: string, data: string | Buffer = "x") => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };

beforeAll(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "cursed-models-")); });
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("local model scanning", () => {
  it("finds nested .gguf files, skips vision projectors, and prefixes other folders", () => {
    const download = path.join(root, "dl");
    const extra = path.join(root, "extra");
    w(path.join(download, "pub", "repo", "a.gguf"));
    w(path.join(download, "pub", "repo", "mmproj-a.gguf"));
    w(path.join(extra, "b.gguf"));
    const lm = createLocalModels({ getDownloadDir: () => download, getConfig: () => ({ customDirs: [extra] }) });
    const ids = lm.scan().models.map(m => m.id).filter(id => !id.startsWith("@ollama") && !id.startsWith("@lmstudio"));
    expect(ids).toContain("pub/repo/a.gguf");
    expect(ids.some(id => /mmproj/.test(id))).toBe(false);
    expect(ids.some(id => id.startsWith("@c-") && id.endsWith("/b.gguf"))).toBe(true);
  });

  it("finds a file by name in any folder (used to avoid duplicate downloads)", () => {
    const download = path.join(root, "dl");
    const lm = createLocalModels({ getDownloadDir: () => download, getConfig: () => ({}) });
    expect(lm.findByFileName("A.GGUF")?.file).toContain("a.gguf");
    expect(lm.findByFileName("nope.gguf")).toBeUndefined();
  });

  it("turning a source off hides its models", () => {
    const extra = path.join(root, "extra");
    const download = path.join(root, "dl");
    const cfg = { customDirs: [extra], disabledSources: [] as string[] };
    const lm = createLocalModels({ getDownloadDir: () => download, getConfig: () => cfg });
    const id = lm.scan().sources.find(s => s.kind === "custom")!.id;
    cfg.disabledSources = [id];
    expect(lm.scan().models.some(m => m.id.endsWith("/b.gguf"))).toBe(false);
  });
});
