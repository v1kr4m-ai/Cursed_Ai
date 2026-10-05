import { describe, it, expect } from "vitest";
import { friendlyError } from "../src/services/errors";

describe("friendlyError", () => {
  it("explains an unreachable server", () => {
    expect(friendlyError(new TypeError("Failed to fetch"))).toMatch(/start\.bat/);
  });
  it("adds the next step for ComfyUI / Ollama / busy model", () => {
    expect(friendlyError(new Error("Could not reach ComfyUI at x"))).toMatch(/Start ComfyUI/);
    expect(friendlyError(new Error("Could not reach Ollama - is it running?"))).toMatch(/Start the app/);
    expect(friendlyError(new Error("Inference already in progress."))).toMatch(/busy/);
  });
  it("passes unknown errors through", () => {
    expect(friendlyError(new Error("boom"))).toBe("boom");
    expect(friendlyError("plain text")).toBe("plain text");
  });
});
