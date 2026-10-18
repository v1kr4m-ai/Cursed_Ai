/** Reads text (or spreadsheet cells) out of a prompt file: txt / md / docx / xlsx / pdf, or an image via Tesseract OCR if installed. */
import fs from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import JSZip from "jszip";
import { CellValue, ExtractedContent } from "./promptFinder";

const TEXT_EXTENSIONS = new Set([".txt", ".md"]);
const DELIMITED: Record<string, string> = { ".csv": ",", ".tsv": "	" };
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff"]);
export const PROMPT_FILE_EXTENSIONS = [".txt", ".md", ".csv", ".tsv", ".rtf", ".doc", ".docx", ".docm", ".odt", ".xlsx", ".xlsm", ".pptx", ".pptm", ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp"];

const xmlDecode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, "&");

/** Joins every paragraph's text with a single newline, in document order (what python-docx's paragraph.text does). */
async function extractDocx(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new Error("not a valid .docx file");
  const paragraphs = xml.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) || [];
  return paragraphs.map(p =>
    [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)]
      .map(m => (m[0] === "<w:tab/>" ? "\t" : m[0] === "<w:br/>" || m[0] === "<w:cr/>" ? "\n" : xmlDecode(m[1] ?? "")))
      .join("")).join("\n");
}

/** Slides in order; every paragraph of every shape on its own line, a blank line between slides. */
async function extractPptx(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  if (!slides.length) throw new Error("not a valid .pptx file");
  const out: string[] = [];
  for (const name of slides) {
    const xml = await zip.file(name)!.async("string");
    const paras = (xml.match(/<a:p>[\s\S]*?<\/a:p>|<a:p [^>]*>[\s\S]*?<\/a:p>/g) || [])
      .map(p => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => xmlDecode(m[1])).join("")).filter(t => t.trim());
    if (paras.length) out.push(paras.join("\n"));
  }
  return out.join("\n\n");
}

/** OpenDocument text: the paragraphs and headings of content.xml. */
async function extractOdt(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const xml = await zip.file("content.xml")?.async("string");
  if (!xml) throw new Error("not a valid .odt file");
  return (xml.match(/<text:[ph][ >][\s\S]*?<\/text:[ph]>/g) || [])
    .map(p => xmlDecode(p.replace(/<text:s\/>/g, " ").replace(/<text:line-break\/>/g, "\n").replace(/<[^>]+>/g, ""))).join("\n");
}

/** Old Word (.doc) through word-extractor. */
async function extractDoc(file: string): Promise<string> {
  const WordExtractor = (await import("word-extractor")).default as any;
  const doc = await new WordExtractor().extract(file);
  return String(doc.getBody());
}

/** RTF: drop control words and groups, keep the text (good enough for prompts). */
function extractRtf(file: string): string {
  const raw = fs.readFileSync(file, "latin1");
  return raw
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(par|line)\b ?/g, "\n").replace(/\\tab\b ?/g, "\t")
    .replace(/\{\\\*[^{}]*\}/g, "").replace(/\{\\(fonttbl|colortbl|stylesheet|info)[\s\S]*?\}\s*\}/g, "")
    .replace(/\\[a-z]+-?\d* ?/gi, "").replace(/[{}]/g, "").replace(/\r/g, "").trim();
}

/** CSV / TSV as cells so the prompt column is found the same way as in a spreadsheet. */
function extractDelimited(file: string, delimiter: string): CellValue[] {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const cells: CellValue[] = [];
  let row = 1, col = 1, cur = "", quoted = false;
  const push = () => { const t = cur.trim(); if (t) cells.push({ sheet: "", row, col, text: t }); cur = ""; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false; } else cur += ch; }
    else if (ch === '"') quoted = true;
    else if (ch === delimiter) { push(); col++; }
    else if (ch === "\n") { push(); row++; col = 1; }
    else if (ch !== "\r") cur += ch;
  }
  push();
  return cells;
}

async function extractPdf(file: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
  const { text } = await extractText(pdf, { mergePages: false });
  return (text as string[]).join("\n\n");
}

/** Every non-empty cell across every sheet, in sheet/row/col order. */
async function extractXlsx(file: string): Promise<CellValue[]> {
  const readXlsx = (await import("read-excel-file/node")).default as (input: string) => Promise<{ sheet: string; data: any[][] }[]>;
  const sheets = await readXlsx(file);
  const cells: CellValue[] = [];
  for (const { sheet, data } of sheets) {
    data.forEach((row, r) => row.forEach((value, c) => {
      if (value === null || value === undefined) return;
      const text = (value instanceof Date ? value.toISOString().slice(0, 10) : String(value)).trim();
      if (text) cells.push({ sheet, row: r + 1, col: c + 1, text });
    }));
  }
  return cells;
}

function findTesseract(): Promise<string | null> {
  const candidates = [
    "tesseract",
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Tesseract-OCR", "tesseract.exe"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Tesseract-OCR", "tesseract.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Tesseract-OCR", "tesseract.exe"),
  ];
  return new Promise(resolve => {
    const next = (i: number) => {
      if (i >= candidates.length) return resolve(null);
      execFile(candidates[i], ["--version"], { timeout: 5000, windowsHide: true }, err => (err ? next(i + 1) : resolve(candidates[i])));
    };
    next(0);
  });
}

async function extractImageOcr(file: string): Promise<string> {
  const exe = await findTesseract();
  if (!exe) {
    throw new Error("Tesseract OCR is not installed - it is needed to read text out of an image. Install it from https://github.com/UB-Mannheim/tesseract/wiki and restart the app.");
  }
  return new Promise((resolve, reject) =>
    execFile(exe, [file, "stdout"], { timeout: 60000, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout))));
}

export async function extractPromptFile(file: string): Promise<ExtractedContent> {
  const ext = path.extname(file).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return { kind: "text", text: fs.readFileSync(file, "utf8") };
  if (ext === ".pdf") return { kind: "text", text: await extractPdf(file) };
  if (ext === ".docx" || ext === ".docm") return { kind: "text", text: await extractDocx(file) };
  if (ext === ".doc") return { kind: "text", text: await extractDoc(file) };
  if (ext === ".odt") return { kind: "text", text: await extractOdt(file) };
  if (ext === ".rtf") return { kind: "text", text: extractRtf(file) };
  if (ext === ".pptx" || ext === ".pptm") return { kind: "text", text: await extractPptx(file) };
  if (ext === ".xlsx" || ext === ".xlsm") return { kind: "cells", cells: await extractXlsx(file) };
  if (ext === ".xls") throw new Error("Old .xls workbooks are not supported - save it as .xlsx (or .csv) first.");
  if (DELIMITED[ext]) return { kind: "cells", cells: extractDelimited(file, DELIMITED[ext]) };
  if (IMAGE_EXTENSIONS.has(ext)) return { kind: "text", text: await extractImageOcr(file) };
  throw new Error(`unsupported file extension: ${ext}`);
}

/** Bytes uploaded from the browser -> a temp file with the right extension, extracted, then removed. */
export async function extractUpload(name: string, bytes: Buffer): Promise<ExtractedContent> {
  const tmp = path.join(os.tmpdir(), `cursed-prompt-${Date.now()}-${Math.floor(Math.random() * 1e6)}${path.extname(name)}`);
  fs.writeFileSync(tmp, bytes);
  try { return await extractPromptFile(tmp); } finally { try { fs.unlinkSync(tmp); } catch { /* already gone */ } }
}
