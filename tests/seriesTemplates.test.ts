import { describe, expect, it } from "vitest";
import { builtinTemplates, templateFrom, templatePatch } from "../seriesTool/templates";
import { DEFAULT_SETTINGS, type Project } from "../seriesTool/model";

const project = (): Project => ({
  id: "p1", title: "My show", dir: "D:/x", createdAt: "", updatedAt: "",
  idea: { logline: "A story about dragons", audience: "teens", tone: "dark", notes: "secret notes" } as any,
  discussion: [{ role: "user", content: "hello", at: "" }], styleLock: "STYLE", voiceLock: "VOICE",
  settings: { ...DEFAULT_SETTINGS, imageWorkflow: "C:\w\img.json", videoWorkflow: "C:\w\vid.json", seconds: 5 },
  episodes: [{ id: "e1" } as any], sources: [{ id: "s1" } as any], format: "outfit-change", voice: "off", allowTextCards: true,
} as Project);

describe("series templates", () => {
  it("keeps how a series is made and none of what is in it", () => {
    const t = templateFrom(project(), "  Fashion setup  ");
    expect(t.name).toBe("Fashion setup");
    expect(t).toMatchObject({ format: "outfit-change", voice: "off", allowTextCards: true, styleLock: "STYLE", voiceLock: "VOICE", tone: "dark", audience: "teens" });
    expect(t.settings.imageWorkflow).toBe("C:\w\img.json");
    const text = JSON.stringify(t);
    expect(text).not.toContain("dragons");
    expect(text).not.toContain("secret notes");
    expect(text).not.toContain("hello");
    expect(text).not.toContain("e1");
  });

  it("gives a new project the format, voice, look, workflows and size, with an empty story", () => {
    const patch: any = templatePatch(templateFrom(project(), "T"));
    expect(patch.format).toBe("outfit-change");
    expect(patch.voice).toBe("off");
    expect(patch.settings.seconds).toBe(5);
    expect(patch.idea.logline).toBe("");
    expect(patch.idea.tone).toBe("dark");
    expect(patch.episodes).toBeUndefined();
    expect(patch.discussion).toBeUndefined();
  });

  it("ships built-in templates that name real styles", () => {
    const list = builtinTemplates();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.every(t => t.builtin && t.id.startsWith("builtin-"))).toBe(true);
    expect(list.find(t => t.id === "builtin-outfit-change")!.voice).toBe("off");
  });
});
