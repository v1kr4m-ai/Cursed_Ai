import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resetInterruptedJobs } from "../seriesTool/reconcile";

describe("resetInterruptedJobs", () => {
  it("puts queued / running work back to pending, keeps clips that exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "series-"));
    const dir = path.join(root, "demo"); fs.mkdirSync(dir);
    const clip = path.join(dir, "clip.mp4"); fs.writeFileSync(clip, "x");
    const project = { episodes: [{ refs: [{ status: "running", file: null }], scenes: [
      { status: "queued", clipPath: null }, { status: "running", clipPath: clip }, { status: "done", clipPath: clip }, { status: "failed", clipPath: null },
    ] }] };
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(project));
    const r = resetInterruptedJobs(root);
    expect(r.reset).toBe(3);
    const after = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8"));
    expect(after.episodes[0].refs[0].status).toBe("pending");
    expect(after.episodes[0].scenes.map((s: any) => s.status)).toEqual(["pending", "done", "done", "failed"]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
