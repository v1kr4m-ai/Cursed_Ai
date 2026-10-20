import { describe, expect, it, vi } from "vitest";
import { CHUNK_SIZE, DIGEST_THRESHOLD, digestCallCount, digestDocument, splitIntoChunks } from "../src/components/tools/series/chunk";

const paragraphs = (n: number, words = 60) =>
  Array.from({ length: n }, (_, i) => `Paragraph ${i + 1}. ` + "word ".repeat(words)).join("\n\n");

describe("splitIntoChunks", () => {
  it("leaves a short document alone", () => {
    expect(splitIntoChunks("a short treatment")).toEqual(["a short treatment"]);
  });

  it("returns nothing for empty input", () => {
    expect(splitIntoChunks("   \n\n  ")).toEqual([]);
  });

  it("covers the whole document", () => {
    const text = paragraphs(120);
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    // Every paragraph marker survives somewhere, so nothing was dropped between chunks.
    for (const marker of ["Paragraph 1.", "Paragraph 60.", "Paragraph 120."]) {
      expect(chunks.some(c => c.includes(marker))).toBe(true);
    }
  });

  it("keeps chunks within the size limit", () => {
    for (const chunk of splitIntoChunks(paragraphs(200))) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_SIZE);
    }
  });

  it("always makes progress, even with no break characters", () => {
    const chunks = splitIntoChunks("x".repeat(CHUNK_SIZE * 3));
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    expect(chunks.every(c => c.length > 0)).toBe(true);
  });

  it("prefers a paragraph break over cutting mid-sentence", () => {
    const text = "A".repeat(6000) + "\n\n" + "B".repeat(6000);
    const [first] = splitIntoChunks(text, 7000, 0);
    expect(first.endsWith("A")).toBe(true);
    expect(first.includes("B")).toBe(false);
  });
});

describe("digestCallCount", () => {
  it("is zero when the document fits in one prompt", () => {
    expect(digestCallCount("short")).toBe(0);
  });

  it("counts a call per chunk plus the merge", () => {
    const text = paragraphs(200);
    expect(digestCallCount(text)).toBe(splitIntoChunks(text).length + 1);
  });
});

describe("digestDocument", () => {
  it("passes a short document straight through without calling the model", async () => {
    const ask = vi.fn();
    expect(await digestDocument("a short outline", ask)).toBe("a short outline");
    expect(ask).not.toHaveBeenCalled();
  });

  it("summarises each chunk then merges, reporting progress", async () => {
    const text = paragraphs(150);
    const expected = splitIntoChunks(text).length;
    const ask = vi.fn(async (prompt: string) => (prompt.includes("consecutive parts") ? "MERGED" : "notes"));
    const seen: number[] = [];

    const digest = await digestDocument(text, ask, p => seen.push(p.done));

    expect(digest).toBe("MERGED");
    expect(ask).toHaveBeenCalledTimes(expected + 1);
    expect(seen.at(-1)).toBe(expected + 1);
  });

  it("merges a second time when the first merge is still too long", async () => {
    const text = paragraphs(150);
    const ask = vi.fn()
      .mockImplementation(async (prompt: string) => (prompt.includes("consecutive parts") ? "x".repeat(DIGEST_THRESHOLD + 10) : "notes"))
      .mockImplementationOnce(async () => "notes");
    const digest = await digestDocument(text, ask);
    const merges = ask.mock.calls.filter(([p]) => String(p).includes("consecutive parts")).length;
    expect(merges).toBe(2);
    expect(digest.length).toBeGreaterThan(0);
  });
});
