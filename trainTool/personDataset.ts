/**
 * A LoRA training dataset made from the photos of one person in a series: every photo copied into a dataset folder
 * with a caption file holding the trigger word, ready for the Train LoRA page (which can write fuller captions).
 * Photos already in the folder are not added twice, so the dataset can be topped up later.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

const IMAGE = /\.(png|jpe?g|webp)$/i;

/** A trigger word for a person: lowercase letters and digits with a number on the end ("Ann" -> "ann01"), rare enough not to be an ordinary word. */
export function triggerFor(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (base || "person") + "01";
}

const hashOf = (file: string) => crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");

export interface DatasetResult { dir: string; trigger: string; added: number; skipped: number; total: number }

export function buildDataset(opts: { dir: string; trigger: string; photos: string[] }): DatasetResult {
  fs.mkdirSync(opts.dir, { recursive: true });
  const present = fs.readdirSync(opts.dir).filter(f => IMAGE.test(f));
  const seen = new Set(present.map(f => hashOf(path.join(opts.dir, f))));
  let index = present.length;
  let added = 0, skipped = 0;
  for (const photo of opts.photos) {
    if (!IMAGE.test(photo) || !fs.existsSync(photo)) { skipped++; continue; }
    const h = hashOf(photo);
    if (seen.has(h)) { skipped++; continue; }
    seen.add(h);
    index++;
    const name = `${opts.trigger}_${String(index).padStart(2, "0")}${path.extname(photo).toLowerCase()}`;
    fs.copyFileSync(photo, path.join(opts.dir, name));
    fs.writeFileSync(path.join(opts.dir, path.parse(name).name + ".txt"), opts.trigger);
    added++;
  }
  return { dir: opts.dir, trigger: opts.trigger, added, skipped, total: present.length + added };
}
