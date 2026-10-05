import { describe, it, expect, afterEach, vi } from "vitest";
import { resolveEngine } from "../src/services/voiceEngine";

function env(opts: { speech: boolean; online: boolean }) {
  vi.stubGlobal("window", opts.speech ? { SpeechRecognition: class {} } : {});
  vi.stubGlobal("navigator", { onLine: opts.online });
}
afterEach(() => vi.unstubAllGlobals());

describe("resolveEngine", () => {
  it("uses the online browser recognizer when it exists and there is internet", () => {
    env({ speech: true, online: true });
    expect(resolveEngine("auto")).toBe("browser");
    expect(resolveEngine("browser")).toBe("browser");
  });
  it("falls back to offline Whisper without internet or without a recognizer", () => {
    env({ speech: true, online: false });
    expect(resolveEngine("auto")).toBe("whisper");
    env({ speech: false, online: true });
    expect(resolveEngine("auto")).toBe("whisper");
    expect(resolveEngine("browser")).toBe("whisper");
  });
  it("falls back after a browser failure, and honours an explicit Whisper choice", () => {
    env({ speech: true, online: true });
    expect(resolveEngine("auto", true)).toBe("whisper");
    expect(resolveEngine("whisper")).toBe("whisper");
  });
});
