import { describe, expect, it } from "vitest";
import { buildSttArgs, buildTtsArgs, cleanStt, cleanTts, langOf, matchClip, parseMeta, safeName } from "../trainTool/speechData";

describe("parseMeta", () => {
  it("reads a Common Voice tsv by its path and sentence columns", () => {
    const tsv = "client_id\tpath\tsentence\tup_votes\nabc\tclip1.mp3\tनमस्ते दुनिया\t2\nabc\tclip2.mp3\tشكرا\t3";
    expect(parseMeta(tsv)).toEqual([{ file: "clip1.mp3", text: "नमस्ते दुनिया" }, { file: "clip2.mp3", text: "شكرا" }]);
  });
  it("reads file|text lines, skips a header, and takes the text column of an LJSpeech sheet", () => {
    expect(parseMeta("file|text\na.wav|hello there\nb|你好")).toEqual([{ file: "a.wav", text: "hello there" }, { file: "b", text: "你好" }]);
    expect(parseMeta("id1|spoken words|normalised words")).toEqual([{ file: "id1", text: "spoken words" }]);
  });
  it("returns nothing for text it cannot read", () => { expect(parseMeta("just a sentence")).toEqual([]); expect(parseMeta("")).toEqual([]); });
});

describe("matchClip", () => {
  it("matches with or without the extension, ignoring folders and case", () => {
    const clips = ["Clip1.wav", "other.mp3"];
    expect(matchClip("clip1.mp3", clips)).toBe("Clip1.wav");
    expect(matchClip("C:/x/other", clips)).toBe("other.mp3");
    expect(matchClip("missing.wav", clips)).toBeUndefined();
  });
});

describe("settings become safe command lines", () => {
  it("clamps numbers, keeps only known languages, and picks a sensible learning rate per method", () => {
    const c = cleanStt({ baseModel: "m", datasetDir: "d", language: "zh", epochs: 9999, batchSize: -3, learningRate: "1e-3; rm -rf", method: "full" });
    expect(c).toMatchObject({ language: "zh", epochs: 100, batchSize: 1, learningRate: "1e-5", method: "full" });
    expect(cleanStt({ language: "xx" }).language).toBe("hi");
    expect(cleanStt({ method: "lora" }).learningRate).toBe("1e-3");
  });
  it("builds the Whisper and XTTS argument lists", () => {
    const a = buildSttArgs(cleanStt({ baseModel: "m", datasetDir: "d", outputDir: "o", language: "ar", maxSteps: 5 }), "train_whisper.py");
    expect(a.slice(0, 3)).toEqual(["train_whisper.py", "--base_model", "m"]);
    expect(a).toContain("--max_steps");
    const t = buildTtsArgs(cleanTts({ modelDir: "m", datasetDir: "d", outputDir: "o", language: "zh" }), "train_xtts.py");
    expect(t[t.indexOf("--language") + 1]).toBe("zh-cn");
  });
  it("names folders safely but keeps non-Latin letters", () => {
    expect(safeName("../hindi दफ्तर*?")).toBe("hindi दफ्तर");
    expect(langOf("ar").name).toBe("Arabic");
  });
});
