import { describe, expect, it } from "vitest";
import { MAX_CONTEXT, MIN_CONTEXT, ollamaExeCandidates, restartSteps, validContext } from "../ollamaRestart";

describe("Ollama restart with a bigger context", () => {
  it("accepts only whole token counts in Ollama's range", () => {
    expect(validContext(32768)).toBe(32768);
    expect(validContext("16384")).toBe(16384);
    expect(validContext(MIN_CONTEXT - 1)).toBeNull();
    expect(validContext(MAX_CONTEXT + 1)).toBeNull();
    expect(validContext("lots")).toBeNull();
    expect(validContext(undefined)).toBeNull();
  });

  it("looks in the usual install folders, then the PATH", () => {
    const list = ollamaExeCandidates({ LOCALAPPDATA: "C:\Users\me\AppData\Local", ProgramFiles: "C:\Program Files" } as any);
    expect(list[0]).toMatch(/Programs.Ollama.ollama\.exe$/);
    expect(list.at(-1)).toBe("ollama");
    expect(ollamaExeCandidates({} as any)).toEqual(["ollama"]);
  });

  it("lists what a restart does, in order, ending with the new window size", () => {
    const steps = restartSteps(32768, "ollama.exe");
    expect(steps.map(s => s.command.split(" ")[0])).toEqual(["taskkill", "taskkill", "setx", "ollama.exe"]);
    expect(steps[2].command).toContain("OLLAMA_CONTEXT_LENGTH 32768");
    expect(steps[3].command).toContain("OLLAMA_CONTEXT_LENGTH=32768");
  });
});
