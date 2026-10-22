import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { describe, it, expect } from "vitest";

describe("codebuddy-cn: WAF fingerprint headers", () => {
  const exec = new CodeBuddyExecutor();
  const cred = { accessToken: "test-token" };
  const h = exec.buildHeaders(cred, true, "https://copilot.tencent.com/v2/chat/completions", "deepseek-v4.1-flash", {});

  it("stamps the real-client per-request identity headers", () => {
    expect(h["X-Agent-Intent"]).toBe("craft");
    expect(h["X-Agent-Purpose"]).toBe("conversation");
    expect(h["X-Agent-Type"]).toBe("main");
    expect(h["X-Private-Data"]).toBe("false");
    expect(h["X-Product-Version"]).toBe("2.172.1");
  });

  it("sends the whole conversation header family the gateway's channel check reads", () => {
    // A request without these is rejected with HTTP 400 / code 11-128
    // ("conversation id missing" / 这次调用没通过渠道校验).
    for (const name of [
      "X-Conversation-ID",
      "X-Conversation-Request-ID",
      "X-Root-Request-ID",
      "X-Conversation-Message-ID",
      "X-Request-ID",
    ]) {
      expect(h[name], name).toBeTruthy();
    }
  });

  it("emits the captured id shapes", () => {
    // Conversation id: dashed UUID. The per-turn ids: 32 hex, no dashes.
    expect(h["X-Conversation-ID"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    for (const name of ["X-Conversation-Request-ID", "X-Root-Request-ID", "X-Conversation-Message-ID", "X-Request-ID"]) {
      expect(h[name], name).toMatch(/^[0-9a-f]{32}$/i);
    }
  });

  it("keeps the captured id relationships", () => {
    // The client aliases these pairs.
    expect(h["X-Request-ID"]).toBe(h["X-Conversation-Message-ID"]);
    expect(h["X-Root-Request-ID"]).toBe(h["X-Conversation-Request-ID"]);
  });

  it("sends the W3C/B3 trace family", () => {
    expect(h["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/i);
    expect(h["b3"]).toMatch(/^[0-9a-f]{32}-[0-9a-f]{16}-1$/i);
    expect(h["X-B3-TraceId"]).toMatch(/^[0-9a-f]{32}$/i);
    expect(h["X-B3-SpanId"]).toMatch(/^[0-9a-f]{16}$/i);
    expect(h["X-B3-Sampled"]).toBe("1");
    expect(h["X-Trace-ID"]).toMatch(/^[0-9a-f]{32}$/i);
  });

  it("keeps the static registry headers", () => {
    expect(h["User-Agent"]).toBe("CLI/2.172.1 CodeBuddy/2.172.1");
    expect(h["X-IDE-Version"]).toBe("2.172.1");
    expect(h["X-IDE-Type"]).toBe("CLI");
    expect(h["X-Domain"]).toBe("www.codebuddy.cn");
  });

  it("gives fresh per-turn ids on each call but keeps the conversation id", () => {
    const h2 = exec.buildHeaders(cred, true, "u", "m", {});
    expect(h2["X-Conversation-Request-ID"]).not.toBe(h["X-Conversation-Request-ID"]);
    expect(h2["X-Conversation-Message-ID"]).not.toBe(h["X-Conversation-Message-ID"]);
    expect(h2["X-Conversation-ID"]).toBe(h["X-Conversation-ID"]);
  });

  it("preserves a caller-supplied conversation id verbatim", () => {
    const h3 = exec.buildHeaders(
      { accessToken: "test-token", rawHeaders: { "x-conversation-id": "Caller-Conv-1" } },
      true,
      "u",
      "m",
      {}
    );
    expect(h3["x-conversation-id"]).toBe("Caller-Conv-1");
  });
});
