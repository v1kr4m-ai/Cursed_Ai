/**
 * Splitting a long story into pieces a model can actually read.
 *
 * Planning needs the whole shape of a document, but a novel-length treatment does not fit in one
 * prompt. The document is cut into chunks, each chunk is summarised, and the summaries are
 * summarised again if they are still too long - so the planner sees the whole arc instead of the
 * first few pages.
 */

/** Longest source text handed to the planner whole. Anything above this gets digested first. */
export const DIGEST_THRESHOLD = 24_000;

/** Characters per chunk. Comfortably inside a small local model's context once the prompt is added. */
export const CHUNK_SIZE = 9_000;

/** Carried from the end of one chunk into the next so a beat split across the seam is not lost. */
export const CHUNK_OVERLAP = 400;

/**
 * Cut `text` into chunks of at most `size`, preferring paragraph breaks, then sentence breaks,
 * and only splitting mid-sentence when a single run of text is longer than a whole chunk.
 */
export function splitIntoChunks(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;

  while (start < clean.length) {
    const hardEnd = Math.min(start + size, clean.length);
    if (hardEnd === clean.length) {
      chunks.push(clean.slice(start).trim());
      break;
    }

    // Look for a break in the last third of the window, so chunks stay a sensible size.
    const windowStart = start + Math.floor(size * 0.6);
    const slice = clean.slice(windowStart, hardEnd);
    const paragraph = slice.lastIndexOf("\n\n");
    const sentence = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    const newline = slice.lastIndexOf("\n");

    let end = hardEnd;
    if (paragraph > 0) end = windowStart + paragraph;
    else if (sentence > 0) end = windowStart + sentence + 1;
    else if (newline > 0) end = windowStart + newline;

    chunks.push(clean.slice(start, end).trim());
    start = Math.max(end - overlap, end > start ? end : start + size);
  }

  return chunks.filter(Boolean);
}

export const CHUNK_INSTRUCTION =
  "Summarise this part of a story document for someone planning a video series. Keep every plot " +
  "beat, named character, place and date, in the order they appear. Drop prose style, dialogue " +
  "and repetition. Write compact notes, not an essay. No preamble.";

export const MERGE_INSTRUCTION =
  "These are notes on consecutive parts of one story document, in order. Merge them into a single " +
  "ordered outline: the arc from start to finish, the cast, the places, and the turning points. " +
  "Remove anything repeated across parts. Keep it under 1500 words. No preamble.";

/** How many model calls a digest will take, for the progress readout. */
export function digestCallCount(text: string, size = CHUNK_SIZE): number {
  const chunks = splitIntoChunks(text, size).length;
  return chunks <= 1 ? 0 : chunks + 1;
}

export interface DigestProgress { done: number; total: number; stage: "chunks" | "merge" }

/**
 * Map-reduce a long document down to something the planner can read: summarise each chunk, then
 * merge. If the merged notes are still over the threshold, merge again on the result.
 *
 * `ask` is the model call - passed in so this stays testable and provider-agnostic.
 */
export async function digestDocument(
  text: string,
  ask: (prompt: string) => Promise<string>,
  onProgress?: (p: DigestProgress) => void,
): Promise<string> {
  const chunks = splitIntoChunks(text);
  if (chunks.length <= 1) return text;

  const notes: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({ done: i, total: chunks.length + 1, stage: "chunks" });
    notes.push(await ask(`${CHUNK_INSTRUCTION}\n\nPart ${i + 1} of ${chunks.length}:\n\n${chunks[i]}`));
  }

  onProgress?.({ done: chunks.length, total: chunks.length + 1, stage: "merge" });
  let merged = await ask(`${MERGE_INSTRUCTION}\n\n${notes.map((n, i) => `Part ${i + 1} notes:\n${n}`).join("\n\n")}`);

  // A very long source can still produce long notes; one more pass settles it.
  if (merged.length > DIGEST_THRESHOLD) {
    merged = await ask(`${MERGE_INSTRUCTION}\n\n${merged.slice(0, DIGEST_THRESHOLD * 2)}`);
  }

  onProgress?.({ done: chunks.length + 1, total: chunks.length + 1, stage: "merge" });
  return merged.trim();
}
