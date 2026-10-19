import { describe, it, expect } from "vitest";
import { parseStudioCommand } from "../src/services/studioIntent";

describe("parseStudioCommand", () => {
  it("creates an image from a spoken request", () => {
    const r = parseStudioCommand("Create an image of a red fox in the snow")!;
    expect(r.request).toEqual({ kind: "image", prompt: "a red fox in the snow", generate: false });
  });
  it("understands videos, fillers and 'generate it now'", () => {
    const r = parseStudioCommand("can you make me a short video about waves on a beach and generate it")!;
    expect(r.request.kind).toBe("video");
    expect(r.request.prompt).toBe("waves on a beach");
    expect(r.request.generate).toBe(true);
  });
  it("draw / animate without a noun", () => {
    expect(parseStudioCommand("draw a castle at dusk")!.request).toMatchObject({ kind: "image", prompt: "a castle at dusk" });
    expect(parseStudioCommand("animate a paper boat on a puddle")!.request.kind).toBe("video");
  });
  it("opens the tool without a prompt", () => {
    expect(parseStudioCommand("open the video generator")!.request).toEqual({ kind: "video" });
    expect(parseStudioCommand("go to image studio")!.request).toEqual({ kind: "image" });
    expect(parseStudioCommand("create an image")!.request).toEqual({ kind: "image" });
  });
  it("'generate it' only works right after a studio was opened", () => {
    expect(parseStudioCommand("go ahead", null)).toBeNull();
    expect(parseStudioCommand("go ahead", { kind: "video", at: Date.now() })!.request).toEqual({ kind: "video", generate: true });
    expect(parseStudioCommand("go ahead", { kind: "video", at: Date.now() - 10 * 60_000 })).toBeNull();
  });
  it("leaves normal chat alone", () => {
    expect(parseStudioCommand("what is the capital of France")).toBeNull();
    expect(parseStudioCommand("tell me about video codecs")).toBeNull();
    expect(parseStudioCommand("explain how an image is stored")).toBeNull();
  });
});
