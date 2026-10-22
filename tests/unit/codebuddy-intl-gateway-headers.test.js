import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";
import registry from "../../open-sse/providers/registry/codebuddy-intl.js";
import { describe, it, expect } from "vitest";

// The international gateway is the same Tencent stack behind a different host,
// so it runs the same channel check as the CN one: a request that carries no
// conversation header family is rejected with HTTP 400 / code 11-128
// ("conversation id missing"). Before the fingerprint work this executor sent
// the registry's static headers only — no ids at all.
describe("codebuddy-intl: gateway fingerprint headers", () => {
  const exec = new CodeBuddyIntlExecutor();
  const cred = { accessToken: "test-token" };
  const h = exec.buildHeaders(cred, true, registry.transport.baseUrl, "gpt-5.6-sol", {});

  it("sends the whole conversation header family", () => {
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

  it("emits the captured id shapes and relationships", () => {
    expect(h["X-Conversation-ID"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    for (const name of ["X-Conversation-Request-ID", "X-Root-Request-ID", "X-Conversation-Message-ID", "X-Request-ID"]) {
      expect(h[name], name).toMatch(/^[0-9a-f]{32}$/i);
    }
    expect(h["X-Request-ID"]).toBe(h["X-Conversation-Message-ID"]);
    expect(h["X-Root-Request-ID"]).toBe(h["X-Conversation-Request-ID"]);
  });

  it("sends the agent headers", () => {
    expect(h["X-Agent-Intent"]).toBe("craft");
    expect(h["X-Agent-Purpose"]).toBe("conversation");
    expect(h["X-Agent-Type"]).toBe("main");
  });

  it("sends the W3C/B3 trace family", () => {
    expect(h["traceparent"]).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/i);
    expect(h["b3"]).toMatch(/^[0-9a-f]{32}-[0-9a-f]{16}-1$/i);
    expect(h["X-B3-TraceId"]).toMatch(/^[0-9a-f]{32}$/i);
    expect(h["X-B3-SpanId"]).toMatch(/^[0-9a-f]{16}$/i);
    expect(h["X-B3-Sampled"]).toBe("1");
    expect(h["X-Trace-ID"]).toMatch(/^[0-9a-f]{32}$/i);
  });

  it("keeps the registry identity headers", () => {
    expect(h["User-Agent"]).toBe("IDE/2.172.1 CodeBuddy/2.172.1");
    expect(h["X-IDE-Type"]).toBe("IDE");
    expect(h["X-IDE-Name"]).toBe("IDE");
    expect(h["X-IDE-Version"]).toBe("2.172.1");
    expect(h["X-Product-Version"]).toBe("2.172.1");
    expect(h["X-Private-Data"]).toBe("false");
    expect(h["X-Domain"]).toBe("www.codebuddy.ai");
    expect(h["x-codebuddy-request"]).toBe("1");
  });

  it("gives fresh per-turn ids on each call but keeps the conversation id", () => {
    const h2 = exec.buildHeaders(cred, true, registry.transport.baseUrl, "gpt-5.6-sol", {});
    expect(h2["X-Conversation-Request-ID"]).not.toBe(h["X-Conversation-Request-ID"]);
    expect(h2["X-Conversation-Message-ID"]).not.toBe(h["X-Conversation-Message-ID"]);
    expect(h2["X-Conversation-ID"]).toBe(h["X-Conversation-ID"]);
  });

  it("preserves a caller-supplied conversation id verbatim", () => {
    const h3 = exec.buildHeaders(
      { accessToken: "test-token", rawHeaders: { "x-conversation-id": "Caller-Conv-1" } },
      true,
      registry.transport.baseUrl,
      "gpt-5.6-sol",
      {}
    );
    expect(h3["x-conversation-id"]).toBe("Caller-Conv-1");
  });
});
