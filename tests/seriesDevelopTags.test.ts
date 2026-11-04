import { describe, it, expect } from "vitest";
import { tagList, tagString, toggleTag, formatOf, projectFormat, voiceParts, setVoiceMode } from "../seriesTool/formats";
import { goProduceBlockedWhy } from "../src/components/tools/series/developSteps";
import { renameRef, newRef, replaceName } from "../src/components/tools/series/refRename";

describe("look and voice tags", () => {
  it("an old single value is a list of one and behaves as before", () => {
    expect(tagList("ugc")).toEqual(["ugc"]);
    expect(formatOf("ugc").id).toBe("ugc");
    expect(projectFormat({ format: "ugc", voice: "off" }).speech).toBe("none");
    expect(projectFormat({ voice: undefined }).id).toBe(formatOf(undefined).id);
  });
  it("toggles, de-duplicates and clears", () => {
    expect(toggleTag("ugc", "vlog")).toBe("ugc,vlog");
    expect(toggleTag("ugc,vlog", "ugc")).toBe("vlog");
    expect(toggleTag("vlog", "vlog")).toBe("");
    expect(tagString(["a", "a", "b"])).toBe("a,b");
  });
  it("first look tag is the main style, the others add their look", () => {
    const f = projectFormat({ format: "ugc,travel" });
    expect(f.id).toBe("ugc");
    expect(f.look).toContain(formatOf("travel").look);
    expect(f.label).toContain("+");
  });
  it("voice mode and descriptor tags combine", () => {
    expect(voiceParts("on")).toEqual({ mode: "on", tags: [] });
    expect(voiceParts("on,warm,calm")).toEqual({ mode: "on", tags: ["warm", "calm"] });
    expect(voiceParts(undefined).mode).toBe("auto");
    expect(setVoiceMode("on,warm", "off")).toBe("off,warm");
    expect(setVoiceMode("on,warm", "auto")).toBe("warm");
    expect(projectFormat({ format: "ugc", voice: "warm,calm" }).voice).toMatch(/warm, calm$/);
  });
});

describe("step gating", () => {
  it("Produce needs a plan", () => {
    expect(goProduceBlockedWhy(0)).not.toBe("");
    expect(goProduceBlockedWhy(2)).toBe("");
  });
});

const sc = (id: string, o: any = {}) => ({ id, number: 1, vo: "", shot: "", textCard: "", refIds: [], seed: 1, promptText: "", promptEdited: false, status: "pending", clipPath: null, durationS: null, promptId: null, error: null, ...o });
const ref = (id: string, name: string, o: any = {}) => ({ id, name, role: "character", kind: "person", prompt: "", negative: "", seed: 1, file: "/a.png", status: "done", error: null, ...o });
const eps = (): any[] => [
  { id: "e1", refs: [ref("r1", "Ann", { person: "Ann" }), ref("r2", "Cafe", { kind: "location", prompt: "a cafe", file: null })], scenes: [sc("s1", { shot: "Ann enters the Cafe. Anna waves.", vo: "ann smiles", cast: ["Ann"], refIds: ["r1", "r2"], promptText: "Ann in Cafe" })] },
  { id: "e2", refs: [ref("r3", "Ann", { person: "Ann" })], scenes: [sc("s2", { shot: "Ann sits", cast: ["Ann"], refIds: ["r3"] })] },
];

describe("renaming placeholders", () => {
  it("whole-name replace only", () => { expect(replaceName("Ann and Anna", "Ann", "Bea")).toBe("Bea and Anna"); });
  it("a person is renamed in every episode, photo and ids kept", () => {
    const out = renameRef(eps(), "e1", "r1", "Bea");
    expect(out[0].refs[0]).toMatchObject({ id: "r1", name: "Bea", person: "Bea", file: "/a.png" });
    expect(out[1].refs[0]).toMatchObject({ id: "r3", name: "Bea", person: "Bea" });
    expect(out[0].scenes[0]).toMatchObject({ shot: "Bea enters the Cafe. Anna waves.", vo: "Bea smiles", cast: ["Bea"], promptText: "Bea in Cafe", refIds: ["r1", "r2"] });
    expect(out[1].scenes[0].cast).toEqual(["Bea"]);
  });
  it("a place is renamed in its episode only", () => {
    const out = renameRef(eps(), "e1", "r2", "Bakery");
    expect(out[0].refs[1].name).toBe("Bakery");
    expect(out[0].scenes[0].shot).toContain("the Bakery");
    expect(out[0].refs[0].name).toBe("Ann");
  });
  it("blank or unchanged name is a no-op", () => {
    const e = eps();
    expect(renameRef(e, "e1", "r1", "  ")).toBe(e);
    expect(renameRef(e, "e1", "r1", "Ann")).toBe(e);
  });
  it("new placeholder gets a unique name", () => {
    const e = eps()[0];
    const a = newRef(e, "location", "Cafe", "x");
    expect(a.name).toBe("Cafe 2");
    expect(a).toMatchObject({ kind: "location", status: "pending", file: null });
  });
});
