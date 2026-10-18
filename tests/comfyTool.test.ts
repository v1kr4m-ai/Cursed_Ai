import { describe, it, expect } from "vitest";
import { findPrompt } from "../comfyTool/promptFinder";
import { pruneToOutput, autoOutputName } from "../comfyTool/runner";
import { convertUiWorkflow } from "../comfyTool/convert";

describe("findPrompt", () => {
  it("takes the text after a Prompt marker", () => {
    const r = findPrompt({ kind: "text", text: "Title\nPrompt: a red fox in snow\n\nNotes: ignore" });
    expect(r.matched).toBe(true);
    expect(r.prompt.startsWith("a red fox in snow")).toBe(true);
    expect(r.prompt).not.toContain("Title");
  });
  it("falls back to the whole text when there is no marker", () => {
    const r = findPrompt({ kind: "text", text: "just a sentence" });
    expect(r.matched).toBe(false);
    expect(r.prompt).toBe("just a sentence");
  });
  it("picks the prompt column of a spreadsheet and lists every row", () => {
    const cells = [
      { sheet: "S", row: 0, col: 0, text: "Id" }, { sheet: "S", row: 0, col: 1, text: "Prompt" },
      { sheet: "S", row: 1, col: 0, text: "1" }, { sheet: "S", row: 1, col: 1, text: "a castle at dusk" },
      { sheet: "S", row: 2, col: 0, text: "2" }, { sheet: "S", row: 2, col: 1, text: "a dragon over the sea" },
    ];
    const r = findPrompt({ kind: "cells", cells });
    expect(r.candidates.map(c => c.text)).toEqual(["a castle at dusk", "a dragon over the sea"]);
    expect(r.prompt).toBe("a castle at dusk");
  });
});

describe("pruneToOutput", () => {
  it("drops nodes the chosen output does not depend on", () => {
    const g = { "1": { class_type: "A", inputs: {} }, "2": { class_type: "B", inputs: { x: ["1", 0] } }, "3": { class_type: "C", inputs: {} } };
    expect(Object.keys(pruneToOutput(g, "2")).sort()).toEqual(["1", "2"]);
  });
  it("keeps everything when no output is known", () => {
    const g = { "1": { class_type: "A", inputs: {} } };
    expect(pruneToOutput(g, null)).toBe(g);
  });
});

describe("autoOutputName", () => {
  it("is based on the first reference, or the workflow name", () => {
    const now = new Date(2026, 9, 19, 2, 6, 18);
    expect(autoOutputName(["C:/x/my pic.png"], "wf", now)).toBe("ComfyUI_my_pic_20261019_020618");
    expect(autoOutputName([], "Minimal_Image", now)).toBe("ComfyUI_Minimal_Image_20261019_020618");
  });
});

describe("convertUiWorkflow", () => {
  it("turns a UI graph into API format using the node list", () => {
    const oi = { KSampler: { input: { required: { seed: ["INT", {}], steps: ["INT", {}] } }, input_order: { required: ["seed", "steps"] } } };
    const ui = { nodes: [{ id: 1, type: "KSampler", mode: 0, inputs: [], widgets_values: [5, 20] }], links: [] };
    const r = convertUiWorkflow(ui as any, oi as any);
    expect(r.ok).toBe(true);
    expect(r.apiWorkflow["1"].class_type).toBe("KSampler");
    expect(r.apiWorkflow["1"].inputs.steps).toBe(20);
  });
});

describe("extractUpload", () => {
  it("reads prompts out of a csv and a pptx", async () => {
    const { extractUpload } = await import("../comfyTool/extract");
    const JSZip = (await import("jszip")).default;
    const csv = findPrompt(await extractUpload("p.csv", Buffer.from('id,prompt\n1,"a castle, at dusk"\n2,a dragon\n')));
    expect(csv.candidates.map(c => c.text)).toEqual(["a castle, at dusk", "a dragon"]);
    const z = new JSZip();
    z.file("ppt/slides/slide1.xml", "<p:sld><a:p><a:r><a:t>Prompt: a red kite</a:t></a:r></a:p></p:sld>");
    const pptx = findPrompt(await extractUpload("p.pptx", await z.generateAsync({ type: "nodebuffer" })));
    expect(pptx.prompt).toBe("a red kite");
  });
});
