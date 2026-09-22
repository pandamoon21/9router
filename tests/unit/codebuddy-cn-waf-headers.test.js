import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { describe, it, expect } from "vitest";

describe("codebuddy-cn: WAF fingerprint headers", () => {
  const exec = new CodeBuddyExecutor();
  const cred = { accessToken: "test-token" };
  const h = exec.buildHeaders(cred, true, "https://copilot.tencent.com/v2/chat/completions", "deepseek-v4.1-flash", {});

  it("stamps the real-CLI per-request identity headers", () => {
    expect(h["X-Agent-Intent"]).toBe("craft");
    expect(h["X-Agent-Type"]).toBe("main");
    expect(h["X-Private-Data"]).toBe("false");
    expect(h["X-Product-Version"]).toBe("2.156.0");
  });

  it("emits valid UUID-shaped conversation/message/request ids", () => {
    const UUID = /^[0-9a-f-]{36}$/i;
    expect(h["X-Conversation-ID"]).toMatch(UUID);
    expect(h["X-Conversation-Request-ID"]).toMatch(UUID);
    expect(h["X-Conversation-Message-ID"]).toMatch(UUID);
    expect(h["X-Request-ID"]).toMatch(UUID);
  });

  it("uses the same id for X-Request-ID and X-Conversation-Message-ID", () => {
    // Real CLI aliases them (see AGENT_INTENT context: `ea[REQUEST_ID_HEADER]=em`).
    expect(h["X-Request-ID"]).toBe(h["X-Conversation-Message-ID"]);
  });

  it("keeps the static registry headers", () => {
    expect(h["User-Agent"]).toBe("CLI/2.156.0 CodeBuddy/2.156.0");
    expect(h["X-IDE-Version"]).toBe("2.156.0");
    expect(h["X-Domain"]).toBe("www.codebuddy.cn");
  });

  it("gives fresh ids on each call", () => {
    const h2 = exec.buildHeaders(cred, true, "u", "m", {});
    expect(h2["X-Conversation-ID"]).not.toBe(h["X-Conversation-ID"]);
  });
});
