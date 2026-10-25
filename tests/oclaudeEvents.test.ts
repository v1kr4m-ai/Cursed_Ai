import { describe, expect, it } from "vitest";
import { applyEvent, changedFiles, emptyLive, resultText, type Item } from "../src/components/oclaude/events";

describe("Ollama_Claude events", () => {
  it("takes the session id and tool list from init", () => {
    const r = applyEvent([], emptyLive, { type: "system", subtype: "init", session_id: "abc", model: "qwen3:8b", tools: ["Bash", "Read"], slash_commands: ["compact"], mcp_servers: [{ name: "git", status: "connected" }], cwd: "C:/x" });
    expect(r.patch.claudeSessionId).toBe("abc");
    expect(r.patch.init?.tools).toEqual(["Bash", "Read"]);
    expect(r.patch.init?.mcpServers[0].name).toBe("git");
  });

  it("types text live, then replaces it with the finished message", () => {
    let a = applyEvent([], emptyLive, { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } });
    a = applyEvent(a.items, a.live, { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } });
    expect(a.live.text).toBe("Hello");
    a = applyEvent(a.items, a.live, { type: "assistant", message: { content: [{ type: "text", text: "Hello there" }] } });
    expect(a.live.text).toBe("");
    expect(a.items).toHaveLength(1);
    expect((a.items[0] as any).text).toBe("Hello there");
  });

  it("matches a tool result to its call", () => {
    let a = applyEvent([], emptyLive, { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } });
    expect((a.items[0] as any).status).toBe("running");
    a = applyEvent(a.items, a.live, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "a.txt" }], is_error: false }] } });
    expect((a.items[0] as any).status).toBe("done");
    expect((a.items[0] as any).result).toBe("a.txt");
  });

  it("marks unanswered tools as ended when the run finishes, and keeps permission denials", () => {
    const items: Item[] = [{ kind: "tool", id: "x", toolId: "t9", name: "Bash", input: {}, status: "running" }];
    const r = applyEvent(items, emptyLive, { type: "result", is_error: false, num_turns: 2, duration_ms: 1234, session_id: "s1", permission_denials: [{ tool_name: "Bash", tool_input: { command: "rm x" } }] });
    expect((r.items[0] as any).status).toBe("error");
    const last = r.items[r.items.length - 1] as any;
    expect(last.kind).toBe("result");
    expect(last.denials[0].tool).toBe("Bash");
    expect(r.patch.claudeSessionId).toBe("s1");
  });

  it("shows an error when the process exits badly", () => {
    const r = applyEvent([], emptyLive, { type: "cursed_exit", code: 1, stderr: "boom" });
    expect((r.items[0] as any).text).toContain("boom");
    expect(applyEvent([], emptyLive, { type: "cursed_exit", code: 0 }).items).toHaveLength(0);
  });

  it("flattens and shortens tool output", () => {
    expect(resultText([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
    expect(resultText("x".repeat(7000))).toContain("1000 more characters");
  });

  it("remembers what a file held before Claude changed it", () => {
    const tool = (id: string, name: string): Item => ({ kind: "tool", id, toolId: id, name, input: {}, status: "running" });
    const result = (id: string, r: any) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] }, tool_use_result: r });
    let items: Item[] = [tool("a", "Write"), tool("b", "Edit"), tool("c", "Edit")];
    items = applyEvent(items, emptyLive, result("a", { type: "create", filePath: "new.txt", originalFile: null })).items;
    items = applyEvent(items, emptyLive, result("b", { filePath: "t.txt", originalFile: "one" })).items;
    items = applyEvent(items, emptyLive, result("c", { filePath: "t.txt", originalFile: "two" })).items;
    expect(changedFiles(items)).toEqual([
      { path: "new.txt", before: null, big: false, undone: false },
      { path: "t.txt", before: "one", big: false, undone: false },
    ]);
  });
  it("keeps how full the context is from each answer, for the status line", () => {
    const a = applyEvent([], emptyLive, { type: "assistant", message: { content: [{ type: "text", text: "hi" }], usage: { input_tokens: 1200, cache_read_input_tokens: 15000, cache_creation_input_tokens: 300, output_tokens: 40 } } });
    expect(a.patch.ctxTokens).toBe(16500);
    expect(applyEvent([], emptyLive, { type: "assistant", message: { content: [] } }).patch.ctxTokens).toBeUndefined();
  });
});
