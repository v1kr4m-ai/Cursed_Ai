import { describe, expect, it } from "vitest";
import { backupName, rebasePaths, unsafeEntries } from "../seriesTool/backup";

describe("series backup", () => {
  it("names the file after the series and the time", () => {
    expect(backupName("Richie's Daily Life!", new Date(2026, 9, 24, 8, 5))).toBe("richie-s-daily-life-20261024-0805.zip");
    expect(backupName("???", new Date(2026, 0, 2, 3, 4))).toBe("series-20260102-0304.zip");
    expect(backupName("Show", new Date(2026, 0, 2, 3, 4), true)).toBe("show-20260102-0304-no-clips.zip");
  });

  it("refuses zip entries that would leave the folder", () => {
    expect(unsafeEntries(["project.json", "refs/a.png", "clips/ep01.mp4"])).toEqual([]);
    expect(unsafeEntries(["../evil.txt", "refs/../../x", "/abs/y", "C:\\Windows\\z", "ok/a.png"])).toEqual(["../evil.txt", "refs/../../x", "/abs/y", "C:\\Windows\\z"]);
  });

  it("points every path in the old folder at the new one, and leaves other paths alone", () => {
    const old = "D:\\Claude\\Cursed_Ai\\series\\ugc";
    const moved: any = rebasePaths({
      dir: old,
      refs: [{ file: old + "\\refs\\a.png" }, { file: "C:\\other\\keep.png" }],
      clip: "d:/claude/cursed_ai/series/ugc/clips/e.mp4",
      nested: { list: [old + "\\exports\\x.mp4", 5, null] },
      near: "D:\\Claude\\Cursed_Ai\\series\\ugc-two\\a.png",
    }, old, "E:\\Phone\\series\\ugc-2");
    expect(moved.dir).toBe("E:\\Phone\\series\\ugc-2");
    expect(moved.refs[0].file).toBe("E:\\Phone\\series\\ugc-2\\refs\\a.png");
    expect(moved.refs[1].file).toBe("C:\\other\\keep.png");
    expect(moved.clip).toBe("E:\\Phone\\series\\ugc-2\\clips\\e.mp4");
    expect(moved.nested.list).toEqual(["E:\\Phone\\series\\ugc-2\\exports\\x.mp4", 5, null]);
    expect(moved.near).toBe("D:\\Claude\\Cursed_Ai\\series\\ugc-two\\a.png");
  });
});
