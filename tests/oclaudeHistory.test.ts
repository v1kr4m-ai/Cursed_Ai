import { describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { itemsOf, listFolders, listSessions, projectDirFor, readSession, titleOf } from "../oclaudeHistory";

const line = (o: any) => JSON.stringify(o);

describe("a folder's Claude Code sessions", () => {
  it("finds the folder the way Claude Code names it", () => {
    expect(path.basename(projectDirFor("D:\\Claude\\In_Progress\\02_Web_Apps\\Cursed_Ai", "C:\\home"))).toBe("D--Claude-In-Progress-02-Web-Apps-Cursed-Ai");
  });

  it("titles a session by the first thing typed, skipping the app's own wrapper lines", () => {
    expect(titleOf([
      line({ type: "user", isMeta: true, message: { content: "<local-command-caveat>x</local-command-caveat>" } }),
      line({ type: "user", message: { content: "<command-name>/model</command-name>" } }),
      line({ type: "user", message: { content: [{ type: "text", text: "Fix the   login bug" }] } }),
    ])).toBe("Fix the login bug");
  });

  it("turns the file into what was typed, what Claude wrote and the tools it used", () => {
    const items = itemsOf([
      line({ type: "user", message: { content: "hello" } }),
      line({ type: "assistant", message: { content: [{ type: "text", text: "hi" }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }),
      line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "a.txt" }] } }),
      "not json",
    ]);
    expect(items).toEqual([{ kind: "user", text: "hello" }, { kind: "text", text: "hi" }, { kind: "tool", toolId: "t1", name: "Bash", input: { command: "ls" } }]);
  });

  it("lists and reads the sessions of one folder, newest first, and refuses odd ids", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
    const cwd = "C:\\work\\shop";
    const dir = projectDirFor(cwd, home);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "aaa-1.jsonl"), line({ type: "user", message: { content: "old one" } }));
    fs.writeFileSync(path.join(dir, "bbb-2.jsonl"), line({ type: "user", message: { content: "new one" } }));
    fs.utimesSync(path.join(dir, "aaa-1.jsonl"), new Date(2020, 1, 1), new Date(2020, 1, 1));
    expect(listSessions(cwd, home).map(s => s.title)).toEqual(["new one", "old one"]);
    expect(readSession(cwd, "bbb-2", home)).toEqual([{ kind: "user", text: "new one" }]);
    expect(readSession(cwd, "../x", home)).toBeNull();
    expect(listSessions("C:\\nowhere", home)).toEqual([]);
  });
  it("lists every folder with sessions by the real path written in its files, leaving out temporary folders", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "home-"));
    const put = (cwd: string, id: string) => { const d = projectDirFor(cwd, home); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, id + ".jsonl"), line({ type: "user", cwd, message: { content: "hi" } })); };
    put("C:/work/shop", "a"); put("C:/work/shop", "b"); put("C:/Users/me/AppData/Local/Temp/x", "c");
    expect(listFolders(home)).toEqual([expect.objectContaining({ cwd: "C:/work/shop", count: 2 })]);
  });
});
