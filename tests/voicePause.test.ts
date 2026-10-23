import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampPause, holdOpen, PAUSE_DEFAULT_MS, PAUSE_MAX_MS, PAUSE_MIN_MS } from "../src/services/voicePause";

describe("voice pause", () => {
  it("keeps the chosen pause inside a sensible range", () => {
    expect(clampPause(100)).toBe(PAUSE_MIN_MS);
    expect(clampPause(60_000)).toBe(PAUSE_MAX_MS);
    expect(clampPause(3000)).toBe(3000);
    expect(clampPause(NaN)).toBe(PAUSE_DEFAULT_MS);
    expect(PAUSE_DEFAULT_MS).toBeGreaterThan(650);
  });

  describe("keeping the browser recognizer open through pauses", () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });
    const fake = () => { const r: any = { continuous: false, stops: 0, results: [] as any[], stop() { this.stops++; } }; r.onresult = (e: any) => r.results.push(e); r.onend = vi.fn(); return r; };

    it("listens continuously and passes results on", () => {
      const r = fake();
      holdOpen(r, () => 2000);
      expect(r.continuous).toBe(true);
      r.onresult({ n: 1 });
      expect(r.results).toEqual([{ n: 1 }]);
    });

    it("stops only after the pause with no new words, and each new word restarts the wait", () => {
      const r = fake();
      holdOpen(r, () => 2000);
      r.onresult({}); vi.advanceTimersByTime(1500);
      expect(r.stops).toBe(0);
      r.onresult({}); vi.advanceTimersByTime(1500);   // a second phrase arrives before the 2 s are up
      expect(r.stops).toBe(0);
      vi.advanceTimersByTime(600);
      expect(r.stops).toBe(1);
    });

    it("reads the pause each time, so a Settings change applies to the next sentence", () => {
      const r = fake(); let pause = 1000;
      holdOpen(r, () => pause);
      r.onresult({}); vi.advanceTimersByTime(1100);
      expect(r.stops).toBe(1);
      pause = 4000;
      r.onresult({}); vi.advanceTimersByTime(3000);
      expect(r.stops).toBe(1);
      vi.advanceTimersByTime(1100);
      expect(r.stops).toBe(2);
    });

    it("does not stop a recognizer that already ended", () => {
      const r = fake();
      holdOpen(r, () => 2000);
      r.onresult({});
      r.onend();
      vi.advanceTimersByTime(5000);
      expect(r.stops).toBe(0);
    });
  });
});
