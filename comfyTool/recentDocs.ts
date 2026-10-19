/** The documents prompts were last read from (local files, Drive files, links), kept with what was found in them so one click reopens them. */
import fs from "fs";
import path from "path";

export interface RecentDoc { id: string; name: string; source: "file" | "drive" | "link"; at: number; count: number; result?: any }
const MAX_DOCS = 12;
const MAX_BYTES = 3 * 1024 * 1024; // a huge sheet is not worth keeping a copy of

export function createRecentDocs(dir: string) {
  const file = path.join(dir, "recent-documents.json");
  const read = (): RecentDoc[] => { try { const d = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(d) ? d : []; } catch { return []; } };
  const write = (docs: RecentDoc[]) => { const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(docs)); fs.renameSync(tmp, file); };
  return {
    list: () => read().map(({ result, ...d }) => d),
    get: (id: string) => read().find(d => d.id === id) || null,
    latest: () => read()[0] || null,
    add(name: string, source: RecentDoc["source"], result: any) {
      const json = JSON.stringify(result);
      if (json.length > MAX_BYTES) return;
      const count = (result.columns?.[0]?.candidates?.length ?? result.candidates?.length) || 0;
      const docs = read().filter(d => !(d.name === name && d.source === source));
      docs.unshift({ id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, name, source, at: Date.now(), count, result });
      write(docs.slice(0, MAX_DOCS));
    },
    remove(id: string) { write(read().filter(d => d.id !== id)); },
  };
}
