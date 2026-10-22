import { describe, it, expect, afterEach } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { applyCodeBuddyBodyRules, CODEBUDDY_CLIENT_PROFILES, buildCodeBuddyUserAgent } from "../../open-sse/utils/codebuddyGateway.js";

// The client's request pipeline applies a fixed set of body rules before
// dispatch. 9router does not carry the server's per-model capability map, so
// the client's fallback rules are the ones that match the wire.
describe("codebuddy: client body rules", () => {
  it("renames max_tokens to max_completion_tokens for the OpenAI reasoning models", () => {
    for (const model of ["gpt-5.6-sol", "gpt-5.5", "gpt-5.4", "gpt-4.1", "o1", "o3", "o4"]) {
      const body = { max_tokens: 1024 };
      applyCodeBuddyBodyRules(body, model);
      expect(body.max_completion_tokens, model).toBe(1024);
      expect(body.max_tokens, model).toBeUndefined();
    }
  });

  it("leaves max_tokens alone for the models that do not need the rename", () => {
    for (const model of ["glm-5.3", "kimi-k3-1", "minimax-m3", "hy3", "deepseek-v4-pro", "gpt-6-astra"]) {
      const body = { max_tokens: 1024 };
      applyCodeBuddyBodyRules(body, model);
      expect(body.max_tokens, model).toBe(1024);
      expect(body.max_completion_tokens, model).toBeUndefined();
    }
  });

  it("never renames when the caller already sent max_completion_tokens", () => {
    const body = { max_tokens: 1024, max_completion_tokens: 512 };
    applyCodeBuddyBodyRules(body, "gpt-5.6-sol");
    expect(body.max_tokens).toBe(1024);
    expect(body.max_completion_tokens).toBe(512);
  });

  it("collapses the xhigh/max thinking levels to high", () => {
    expect(applyCodeBuddyBodyRules({ reasoning_effort: "xhigh" }, "glm-5.3").reasoning_effort).toBe("high");
    expect(applyCodeBuddyBodyRules({ reasoning_effort: "max" }, "glm-5.3").reasoning_effort).toBe("high");
    expect(applyCodeBuddyBodyRules({ reasoning: { effort: "xhigh" } }, "glm-5.3").reasoning.effort).toBe("high");
    expect(applyCodeBuddyBodyRules({ reasoning_effort: "low" }, "glm-5.3").reasoning_effort).toBe("low");
  });
});

describe("codebuddy: client identity profiles", () => {
  const exec = new CodeBuddyExecutor();

  afterEach(() => {
    delete process.env.CODEBUDDY_CLIENT;
  });

  it("builds the User-Agent the way the client does", () => {
    expect(buildCodeBuddyUserAgent(CODEBUDDY_CLIENT_PROFILES.cli)).toBe("CLI/2.172.1 CodeBuddy/2.172.1");
    expect(buildCodeBuddyUserAgent(CODEBUDDY_CLIENT_PROFILES.ide)).toBe("IDE/2.172.1 CodeBuddy/2.172.1");
    // The WorkBuddy host injects its bundled CLI version as a third segment.
    expect(buildCodeBuddyUserAgent(CODEBUDDY_CLIENT_PROFILES.workbuddy)).toBe(
      "WorkBuddy/5.8.3 workbuddy/5.8.3 CLI/2.161.0"
    );
  });

  it("swaps the whole identity block when CODEBUDDY_CLIENT selects a profile", () => {
    process.env.CODEBUDDY_CLIENT = "workbuddy";
    const h = exec.buildHeaders({ accessToken: "test-token" }, true, "u", "m", {});
    expect(h["User-Agent"]).toBe("WorkBuddy/5.8.3 workbuddy/5.8.3 CLI/2.161.0");
    expect(h["X-IDE-Type"]).toBe("WorkBuddy");
    expect(h["X-IDE-Name"]).toBe("WorkBuddy");
    expect(h["X-IDE-Version"]).toBe("5.8.3");
    expect(h["X-Private-Data"]).toBe("true");
    expect(h["X-Product-Version"]).toBe("5.8.3");
    // The per-request set is untouched by the profile switch.
    expect(h["X-Agent-Purpose"]).toBe("conversation");
    expect(h["X-Request-ID"]).toBe(h["X-Conversation-Message-ID"]);
  });

  it("leaves the registry identity alone when no profile is selected", () => {
    const h = exec.buildHeaders({ accessToken: "test-token" }, true, "u", "m", {});
    expect(h["User-Agent"]).toBe("CLI/2.172.1 CodeBuddy/2.172.1");
    expect(h["X-IDE-Type"]).toBe("CLI");
    expect(h["X-Private-Data"]).toBe("false");
  });
});
