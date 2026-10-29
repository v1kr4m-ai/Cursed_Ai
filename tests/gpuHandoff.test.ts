import { describe, expect, it, vi } from "vitest";
import { freeComfyForLLM, freeOllamaForComfy, setHandoff } from "../gpuHandoff";

describe("sharing the GPU", () => {
  it("frees ComfyUI before a language model and Ollama before a render, once per switch, and not when turned off", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return { json: async () => ({ models: [{ name: "qwen3:8b" }] }) }; }));
    await freeComfyForLLM("http://c");
    await freeComfyForLLM("http://c");
    expect(calls).toEqual(["http://c/free"]);
    await freeOllamaForComfy("http://o");
    expect(calls.slice(1)).toEqual(["http://o/api/ps", "http://o/api/generate"]);
    await freeComfyForLLM("http://c"); // switching back frees ComfyUI again
    expect(calls.at(-1)).toBe("http://c/free");
    setHandoff(false);
    const n = calls.length;
    await freeOllamaForComfy("http://o");
    expect(calls.length).toBe(n);
    setHandoff(true);
    vi.unstubAllGlobals();
  });
});
