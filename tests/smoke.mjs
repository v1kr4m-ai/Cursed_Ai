// Quick end-to-end check against a RUNNING server:  npm run smoke   (set BASE=http://127.0.0.1:3000 to change)
const BASE = process.env.BASE || "http://127.0.0.1:3000";
let failed = 0;

async function check(name, fn) {
  try { await fn(); console.log("  ok  ", name); }
  catch (e) { failed++; console.log("  FAIL", name, "-", e.message); }
}
const json = async (path, init) => {
  const r = await fetch(BASE + path, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log(`Smoke test against ${BASE}`);
await check("health", async () => expect((await json("/api/health")).ok, "not ok"));
await check("live system readings", async () => { const d = await json("/api/system/live"); expect(typeof d.cpu === "number" && typeof d.ram === "number", "bad shape"); });
await check("memory totals", async () => { const d = await json("/api/system"); expect(d.totalBytes > 0, "no RAM total"); });
await check("model list + sources", async () => { const d = await json("/api/models"); expect(Array.isArray(d.available), "no list"); const c = await json("/api/config"); expect(Array.isArray(c.sources), "no sources"); });
await check("gpu backend", async () => expect((await json("/api/engine/gpu")).backend, "no backend"));
await check("gallery list", async () => expect(Array.isArray((await json("/api/gallery?kind=image")).items), "no items"));
await check("external models (Ollama/LM Studio)", async () => expect("ollama" in (await json("/api/external-models")), "no ollama key"));
await check("attachment text extraction", async () => {
  const d = await json("/api/attachments/extract?name=a.txt", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: "hello smoke" });
  expect(d.text === "hello smoke", "wrong text");
});
await check("delete protection for other apps' models", async () => {
  const r = await fetch(`${BASE}/api/models/${encodeURIComponent("@ollama/x")}`, { method: "DELETE" });
  expect(r.status === 403, `expected 403, got ${r.status}`);
});
await check("progress endpoint", async () => expect("percent" in (await json("/api/progress/none")), "no percent"));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
