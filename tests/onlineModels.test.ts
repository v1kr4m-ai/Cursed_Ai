import { describe, expect, it } from "vitest";
import { resolveAll, resolveOne } from "../onlineModels";

describe("online providers", () => {
  it("lists every built-in provider with its default address and models, off until a key exists", () => {
    const all = resolveAll({});
    expect(all.map(p => p.id)).toEqual(expect.arrayContaining(["openai", "anthropic", "xai", "perplexity"]));
    const xai = all.find(p => p.id === "xai")!;
    expect(xai.baseUrl).toBe("https://api.x.ai/v1");
    expect(xai.kind).toBe("openai");
    expect(xai.enabled).toBe(false);
    expect(xai.key).toBeUndefined();
  });

  it("uses the saved key, address and model list over the defaults", () => {
    const p = resolveOne({ openai: { apiKey: "sk-test", baseUrl: "https://gateway.example.com/v1/", models: ["my-model"] } }, "openai")!;
    expect(p.key).toBe("sk-test");
    expect(p.keySource).toBe("saved");
    expect(p.baseUrl).toBe("https://gateway.example.com/v1");
    expect(p.models).toEqual(["my-model"]);
    expect(p.enabled).toBe(true);
    expect(p.defaults.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("takes custom providers as saved, and strips a pasted endpoint path from the address", () => {
    const p = resolveOne({ "custom-x": { custom: true, label: "X", baseUrl: "http://localhost:1234/v1/chat/completions", kind: "anthropic", models: ["a"] } }, "custom-x")!;
    expect(p.custom).toBe(true);
    expect(p.kind).toBe("anthropic");
    expect(p.baseUrl).toBe("http://localhost:1234/v1");
    expect(resolveOne({}, "nope")).toBeUndefined();
  });
});
