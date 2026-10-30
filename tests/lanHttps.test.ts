import { describe, it, expect } from "vitest";
import { certNames, certScript } from "../lanHttps";

describe("lanHttps", () => {
  it("covers localhost and this PC's addresses, IPs as IP entries", () => {
    const names = certNames();
    expect(names).toContain("localhost");
    expect(names).toContain("127.0.0.1");
    const s = certScript(["localhost", "192.168.1.5"]);
    expect(s).toContain("2.5.29.17={text}DNS=localhost&IPAddress=192.168.1.5");
    expect(s).not.toContain("PFX_PASS=");
  });
});
