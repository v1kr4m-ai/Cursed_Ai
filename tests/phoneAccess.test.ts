import { describe, expect, it } from "vitest";
import { cookieValue, decide, isLoopback, newCode, tokenFor } from "../phoneAccess";

describe("phone access gate", () => {
  const on = { enabled: true, code: "123456" };

  it("never asks this PC for a code, and recognises every loopback form", () => {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1", undefined]) expect(isLoopback(ip)).toBe(true);
    expect(isLoopback("192.168.1.20")).toBe(false);
    expect(decide({ ip: "::1", enabled: false, code: "x" })).toBe("allow");
  });

  it("blocks other devices when phone access is off, and asks for the code when it is on", () => {
    expect(decide({ ip: "192.168.1.20", enabled: false, code: "123456", header: "123456" })).toBe("off");
    expect(decide({ ip: "192.168.1.20", ...on })).toBe("needs-code");
    expect(decide({ ip: "192.168.1.20", ...on, header: "000000" })).toBe("needs-code");
  });

  it("lets a device in with the right header, query or cookie, and a new code ends old logins", () => {
    expect(decide({ ip: "192.168.1.20", ...on, header: "123456" })).toBe("allow");
    expect(decide({ ip: "192.168.1.20", ...on, query: "123456" })).toBe("allow");
    expect(decide({ ip: "192.168.1.20", ...on, cookie: tokenFor("123456") })).toBe("allow");
    expect(decide({ ip: "192.168.1.20", enabled: true, code: "654321", cookie: tokenFor("123456") })).toBe("needs-code");
    expect(tokenFor("123456")).not.toContain("123456");
  });

  it("makes six-digit codes and reads cookies", () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
    expect(cookieValue("a=1; cursed_phone=abc%20d; b=2", "cursed_phone")).toBe("abc d");
    expect(cookieValue(undefined, "x")).toBe("");
  });
});
