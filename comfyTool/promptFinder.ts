/**
 * Finds "the prompt" inside whatever file the person dropped in.
 *  - Text (txt / md / docx / pdf / OCR'd image): a "Prompt" marker line (several markers = several prompts,
 *    each labelled by the heading above it); with no marker the whole text is shown, with a warning.
 *  - Spreadsheets: every column is scored on what it contains (long prose, not numbers or links, mostly
 *    distinct) plus what its header says (Prompt, Image Prompt, Description, Caption...), the best column wins
 *    and the others are offered as alternatives; rows are labelled from a Name/Title column.
 *
 * Ported from the original Python "From Prompt" tool (backend/prompt_finder.py).
 */

export interface CellValue { sheet: string; row: number; col: number; text: string }
export type ExtractedContent = { kind: "text"; text: string } | { kind: "cells"; cells: CellValue[] };

export interface PromptCandidate { row: number; label: string; text: string }
/** One spreadsheet column that could be "the prompts", with every row it holds. */
export interface PromptColumn { sheet: string; col: number; header: string; score: number; candidates: PromptCandidate[] }
export interface PromptResult { prompt: string; matched: boolean; candidates: PromptCandidate[]; alternatives: PromptColumn[] }

export function findPrompt(content: ExtractedContent): PromptResult {
  return content.kind === "text" ? findInText(content.text || "") : findInCells(content.cells || []);
}

function findInText(text: string): PromptResult {
  const lines = text.split(/\r\n|\r|\n/);
  // Every marker line, with its inline remainder if it was "Prompt: ...".
  const markers: [number, string | null][] = [];
  lines.forEach((line, i) => {
    const stripped = line.trim();
    const lowered = stripped.toLowerCase();
    if (lowered === "prompt" || lowered === "prompt:") markers.push([i, null]);
    else if (lowered.startsWith("prompt:") && stripped.length > "prompt:".length) markers.push([i, stripped.slice("prompt:".length).trim()]);
  });
  if (!markers.length) return { prompt: text.trim(), matched: false, candidates: [], alternatives: [] };

  // One marker: the whole rest of the file.
  if (markers.length === 1) {
    const [lineI, inline] = markers[0];
    const body = [...(inline ? [inline] : []), ...lines.slice(lineI + 1)];
    return { prompt: body.join("\n").trim(), matched: true, candidates: [], alternatives: [] };
  }

  // Several markers: this document holds several prompts (e.g. a "Prompt" heading repeated per scene). Each ends
  // where the next marker's heading starts (if it has one) or otherwise where the next marker itself starts.
  const labels = markers.map(([lineI]) => labelAbove(lines, lineI));
  const candidates: PromptCandidate[] = markers.map(([lineI, inline], idx) => {
    let endLine: number;
    if (idx + 1 < markers.length) endLine = labels[idx + 1][1] !== null ? (labels[idx + 1][1] as number) : markers[idx + 1][0];
    else endLine = lines.length;
    const body = [...(inline ? [inline] : []), ...lines.slice(lineI + 1, endLine)];
    return { row: lineI + 1, label: labels[idx][0] || `Prompt ${idx + 1}`, text: body.join("\n").trim() };
  });
  return { prompt: candidates[0].text, matched: true, candidates, alternatives: [] };
}

/**
 * The line directly above a text marker, used as that prompt's label - but only when it reads as a standalone
 * heading (separated from what came before by a blank line or the start of the file). Returns [label, lineIndex].
 */
function labelAbove(lines: string[], markerLine: number): [string, number | null] {
  let j = markerLine - 1;
  while (j >= 0 && !lines[j].trim()) j--;
  if (j < 0) return ["", null];
  const isolated = j === 0 || !lines[j - 1].trim();
  if (!isolated) return ["", null];
  return [lines[j].trim().slice(0, 60), j];
}

function findInCells(cells: CellValue[]): PromptResult {
  const table = findPromptColumn(cells);
  if (table) return table;

  const ordered = [...cells].sort((a, b) => (a.sheet < b.sheet ? -1 : a.sheet > b.sheet ? 1 : a.row - b.row || a.col - b.col));
  const marker = ordered.find(c => c.text.trim().replace(/:+$/, "").toLowerCase() === "prompt");
  if (!marker) return { prompt: ordered.map(c => c.text).join(" "), matched: false, candidates: [], alternatives: [] };

  const byPos = new Map(ordered.map(c => [`${c.sheet}|${c.row}|${c.col}`, c]));
  const at = (sheet: string, row: number, col: number) => byPos.get(`${sheet}|${row}|${col}`);

  // Table mode: if the row right below the marker has data in OTHER columns too, the marker is a table header over
  // many independent prompt records - take those, not one glued-together blob.
  const hasSibling = ordered.some(c => c.sheet === marker.sheet && c.row === marker.row + 1 && c.col !== marker.col);
  if (hasSibling) {
    const candidates: PromptCandidate[] = [];
    let row = marker.row + 1;
    while (at(marker.sheet, row, marker.col)) {
      const text = at(marker.sheet, row, marker.col)!.text.trim();
      const left = at(marker.sheet, row, marker.col - 1);
      candidates.push({ row, label: left && left.text.trim() ? left.text.trim() : `Row ${row}`, text });
      row++;
    }
    if (candidates.length) return { prompt: candidates[0].text, matched: true, candidates, alternatives: [] };
  }

  if (at(marker.sheet, marker.row, marker.col + 1)) {
    const parts: string[] = [];
    let col = marker.col + 1;
    while (at(marker.sheet, marker.row, col)) { parts.push(at(marker.sheet, marker.row, col)!.text); col++; }
    return { prompt: parts.join(" ").trim(), matched: true, candidates: [], alternatives: [] };
  }
  if (at(marker.sheet, marker.row + 1, marker.col)) {
    const parts: string[] = [];
    let row = marker.row + 1;
    while (at(marker.sheet, row, marker.col)) { parts.push(at(marker.sheet, row, marker.col)!.text); row++; }
    return { prompt: parts.join("\n").trim(), matched: true, candidates: [], alternatives: [] };
  }
  return { prompt: "", matched: true, candidates: [], alternatives: [] };
}

// --- Spreadsheet tables: work out which column holds the prompts ---

const WEAK_HEADER_WORDS = new Set(["description", "caption", "scene", "text", "idea", "script", "content", "positive", "instruction", "instructions", "concept", "brief", "generation"]);
const LABEL_HEADER_WORDS = new Set(["name", "title", "shot", "character", "subject", "label", "theme", "style", "scene"]);
const META_HEADER_WORDS = new Set(["ser", "sr", "sno", "no", "id", "serial", "index", "output", "status", "notes", "note", "remarks", "link", "url", "seed", "file", "filename", "path", "date", "time", "result", "rating", "done", "count"]);
const MAX_ALTERNATIVES = 4;
const WORD = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)?/gu;

const words = (text: string) => text.match(WORD) || [];
const isNumber = (text: string) => {
  const t = text.replace(/,/g, "").trim();
  if (t !== "" && !Number.isNaN(Number(t))) return true;
  return text.startsWith("#") && (text.endsWith("?") || text.endsWith("!")); // spreadsheet error cell
};
const isUrl = (text: string) => /^(https?:\/\/|www\.)/i.test(text);
const headerWords = (text: string) => new Set(text.toLowerCase().replace(/[^a-z0-9# ]+/g, " ").split(/\s+/).filter(Boolean));
const intersects = (a: Set<string>, b: Set<string>) => [...a].some(x => b.has(x));
const union = (...sets: Set<string>[]) => new Set(sets.flatMap(s => [...s]));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function looksLikeHeader(first: string, rest: string[]): boolean {
  const hw = headerWords(first);
  if (first.toLowerCase().includes("prompt") || intersects(hw, union(WEAK_HEADER_WORDS, LABEL_HEADER_WORDS, META_HEADER_WORDS))) return true;
  const avgRest = avg(rest.map(t => words(t).length));
  const firstLen = words(first).length;
  return firstLen <= 3 && first.length <= 40 && avgRest >= Math.max(2 * firstLen, 3);
}

export function columnLetter(col: number): string {
  let letters = "";
  while (col) { const rem = (col - 1) % 26; col = Math.floor((col - 1) / 26); letters = String.fromCharCode(65 + rem) + letters; }
  return letters;
}

/** Higher = more likely to be the prompt column. null = can't be. */
function scoreColumn(header: string, data: string[]): number | null {
  if (data.length < 2) return null;
  const numeric = data.filter(isNumber).length / data.length;
  const urls = data.filter(isUrl).length / data.length;
  if (numeric > 0.5 || urls > 0.5) return null;
  const avgWords = avg(data.map(t => words(t).length));
  const unique = new Set(data).size / data.length;

  let score = Math.min(Math.log1p(avgWords), 4.5) + Math.min(data.length, 20) / 20;
  if (unique < 0.5) score -= 1.5;

  const lowered = header.toLowerCase();
  const hw = headerWords(header);
  if (lowered.includes("prompt")) {
    score += 6;
    if (hw.has("negative") || hw.has("neg")) score -= 9; // a negative-prompt column must never win over the real one
  } else if (intersects(hw, WEAK_HEADER_WORDS)) score += 2.5;
  if (intersects(hw, META_HEADER_WORDS)) score -= 3;
  const labelOnly = new Set([...LABEL_HEADER_WORDS].filter(w => !WEAK_HEADER_WORDS.has(w)));
  if (intersects(hw, labelOnly)) score -= 1.5;

  const strong = lowered.includes("prompt") && !hw.has("negative");
  if (score < 2.0 || (avgWords < 3 && !strong)) return null;
  return score;
}

/** The column whose value best names each prompt row: headed Name/Title/Shot..., else the left neighbour, else any short-text column. */
function labelColumn(promptCol: number, columns: Map<number, [string, Map<number, string>]>): number | null {
  let best: number | null = null;
  let bestRank: [number, number] | null = null;
  for (const [col, [header, rows]] of columns) {
    if (col === promptCol) continue;
    const texts = [...rows.values()];
    if (!texts.length) continue;
    const numeric = texts.filter(isNumber).length / texts.length;
    const short = texts.filter(t => t.length <= 60).length / texts.length;
    const hw = headerWords(header);
    let rank: number;
    // Decided by content as well as header: a "Scene" column of short names labels the rows, one of paragraphs is the prompt.
    if (intersects(hw, LABEL_HEADER_WORDS) && short >= 0.8) rank = 0;
    else if (numeric < 0.5 && short >= 0.8 && !intersects(hw, META_HEADER_WORDS)) rank = col === promptCol - 1 ? 1 : 2;
    else if (numeric >= 0.5) rank = 4;
    else continue;
    const r: [number, number] = [rank, Math.abs(col - promptCol)];
    if (!bestRank || r[0] < bestRank[0] || (r[0] === bestRank[0] && r[1] < bestRank[1])) { best = col; bestRank = r; }
  }
  return best;
}

const rowLabel = (labelRows: Map<number, string>, row: number) => {
  const v = labelRows.get(row);
  return !v ? `Row ${row}` : isNumber(v) ? `#${v}` : v;
};

function findPromptColumn(cells: CellValue[]): PromptResult | null {
  const byCol = new Map<string, Map<number, string>>(); // "sheet\0col" -> row -> text
  for (const c of cells) {
    const text = c.text.trim();
    if (!text) continue;
    const k = `${c.sheet}\0${c.col}`;
    if (!byCol.has(k)) byCol.set(k, new Map());
    byCol.get(k)!.set(c.row, text);
  }

  const sheets = new Map<string, Map<number, [string, Map<number, string>]>>();
  const scored: [number, string, number, string][] = [];
  for (const [k, rows] of byCol) {
    const [sheet, colStr] = k.split("\0");
    const col = Number(colStr);
    const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0]);
    const rest = ordered.slice(1);
    let header: string, dataRows: Map<number, string>;
    if (looksLikeHeader(ordered[0][1], rest.map(r => r[1]))) { header = ordered[0][1]; dataRows = new Map(rest); }
    else { header = ""; dataRows = new Map(ordered); }
    if (!sheets.has(sheet)) sheets.set(sheet, new Map());
    sheets.get(sheet)!.set(col, [header, dataRows]);
    const score = scoreColumn(header, [...dataRows.values()]);
    if (score !== null) scored.push([score, sheet, col, header]);
  }

  const totalCols = [...sheets.values()].reduce((n, cols) => n + cols.size, 0);
  if (!scored.length || totalCols < 2) return null; // not table-shaped: fall back to the marker / free-text rules

  scored.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || a[2] - b[2]);
  const alternatives: PromptColumn[] = [];
  for (const [score, sheet, col, header] of scored.slice(0, MAX_ALTERNATIVES)) {
    const columns = sheets.get(sheet)!;
    const labelCol = labelColumn(col, columns);
    const labelRows = labelCol !== null ? columns.get(labelCol)![1] : new Map<number, string>();
    const candidates = [...columns.get(col)![1].entries()].sort((a, b) => a[0] - b[0]).map(([row, text]) => ({ row, label: rowLabel(labelRows, row), text }));
    alternatives.push({ sheet, col, header: header || `Column ${columnLetter(col)}`, score: Math.round(score * 100) / 100, candidates });
  }
  const best = alternatives[0];
  return { prompt: best.candidates[0].text, matched: true, candidates: best.candidates, alternatives };
}
