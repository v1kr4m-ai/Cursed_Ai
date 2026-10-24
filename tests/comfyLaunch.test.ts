import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { directLaunch, splitCommand, tailLines } from "../comfyLaunch";
import { parseComfyCommand } from "../src/services/comfyIntent";

describe("starting ComfyUI without a window", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-"));
  fs.mkdirSync(path.join(dir, "python_embeded"));
  fs.writeFileSync(path.join(dir, "python_embeded", "python.exe"), "");
  const bat = (text: string) => { const f = path.join(dir, "run.bat"); fs.writeFileSync(f, text); return f; };

  it("splits a command line, keeping quoted words together", () => {
    expect(splitCommand('a "b c" d')).toEqual(["a", "b c", "d"]);
  });

  it("reads the python command out of a start file, with its options", () => {
    const d = directLaunch(bat(".\\python_embeded\\python.exe -s ComfyUI\\main.py --windows-standalone-build\r\necho hello\r\npause\r\n"))!;
    expect(d.cmd).toBe(path.join(dir, "python_embeded", "python.exe"));
    expect(d.args).toEqual(["-s", "ComfyUI\\main.py", "--windows-standalone-build"]);
    expect(d.cwd).toBe(dir);
  });

  it("ignores comments and echo lines, and gives up when the python is not there", () => {
    expect(directLaunch(bat("rem python main.py\r\necho python main.py\r\n"))).toBeNull();
    expect(directLaunch(bat(".\\nope\\python.exe main.py\r\n"))).toBeNull();
  });

  it("returns the last lines of a log, or nothing when there is none", () => {
    const f = path.join(dir, "log.txt");
    fs.writeFileSync(f, ["one", "two", "three"].join("\n"));
    expect(tailLines(f, 2)).toEqual(["two", "three"]);
    expect(tailLines(path.join(dir, "missing.txt"))).toEqual([]);
  });
});

describe("telling the assistant to start ComfyUI", () => {
  it("understands the ways people ask", () => {
    for (const t of ["start ComfyUI", "Please start comfy UI", "can you launch comfyui", "turn on ComfyUI for me", "run Comfy UI", "open comfyui"]) expect(parseComfyCommand(t), t).toBe("start");
  });
  it("understands a question about it", () => {
    for (const t of ["is ComfyUI running?", "is comfy ui on", "check if ComfyUI is running"]) expect(parseComfyCommand(t), t).toBe("status");
  });
  it("leaves other talk to the model", () => {
    for (const t of ["what is ComfyUI", "create an image of a fox", "start the video", "tell me a story about comfy chairs"]) expect(parseComfyCommand(t), t).toBeNull();
  });
});
