import type { Response } from "express";

/** Streams a Gemini answer into the same SSE shape /api/chat uses for local models (`data: {"token": "..."}`). */
export async function streamGemini(
  key: string,
  model: string,
  messages: { role: string; content: string }[],
  options: { temperature?: number; maxTokens?: number } | undefined,
  res: Response,
  signal: AbortSignal,
) {
  const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const contents = messages.filter(m => m.role !== "system").map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    signal,
    body: JSON.stringify({
      contents,
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: { temperature: options?.temperature ?? 0.8, maxOutputTokens: options?.maxTokens ?? 4096 },
    }),
  });
  if (!r.ok || !r.body) throw new Error(`Gemini said no (${r.status}): ${(await r.text()).slice(0, 300)}`);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      try {
        const parts = JSON.parse(line.slice(5).trim())?.candidates?.[0]?.content?.parts || [];
        const token = parts.map((p: any) => p.text || "").join("");
        if (token) res.write(`data: ${JSON.stringify({ token })}\n\n`);
      } catch { /* keep-alive or partial line */ }
    }
  }
}
