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

describe("voiceOfflineNotice", () => {
  it("shows one short popup, however many times voice drops to offline", async () => {
    const sent: any[] = [];
    vi.stubGlobal("window", { dispatchEvent: (e: any) => sent.push(e.detail) });
    vi.stubGlobal("CustomEvent", class { detail: any; constructor(_t: string, o: any) { this.detail = o.detail; } });
    const { voiceOfflineNotice } = await import("../src/services/voiceEngine");
    voiceOfflineNotice(); voiceOfflineNotice(); voiceOfflineNotice();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ message: "No internet - using offline voice.", kind: "warning" });
  });
});
