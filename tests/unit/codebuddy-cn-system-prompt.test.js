// CodeBuddy CN system-prompt handling.
//
// History: `9138c993` added a rewrite that replaced any system message with
// NEUTRAL_PROMPT when it was longer than 2000 chars OR matched an agent-identity
// regex. The stated reason was "Tencent's content filter rejects agent system
// prompts" — that claim was measured on 2026-09-20 and did not reproduce:
//   - a 25,716-char persona prompt was delivered intact to 14 cbcn models
//     (HTTP 200, 5830-6254 in_tokens), 13 of which followed the persona;
//   - the >2000 arm was silently discarding every long prompt a user set,
//     with no error and no log.
// The filter is now off by default and gated behind CODEBUDDY_CN_AGENT_FILTER.
import { describe, it, expect, afterEach } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";

const LONG = "x".repeat(2500);
const MARKER = "You are Claude Code, Anthropic's official CLI for coding.";

const body = (content) => ({ messages: [{ role: "system", content }, { role: "user", content: "hi" }] });
const systemOf = (out) => out.messages[0].content;

describe("CodeBuddyExecutor system prompt is passed through by default", () => {
  const exec = new CodeBuddyExecutor();
  afterEach(() => { delete process.env.CODEBUDDY_CN_AGENT_FILTER; });

  it("keeps a long system prompt instead of the >2000-char replacement", () => {
    expect(systemOf(exec.transformRequest("glm-5.2", body(LONG), false, {}))).toBe(LONG);
  });

  it("keeps an agent-identity system prompt", () => {
    expect(systemOf(exec.transformRequest("glm-5.2", body(MARKER), false, {}))).toBe(MARKER);
  });

  it("keeps typed-block content and its shape", () => {
    const blocks = [{ type: "text", text: LONG }];
    expect(systemOf(exec.transformRequest("glm-5.2", body(blocks), false, {}))).toEqual(blocks);
  });

  it("leaves user messages alone", () => {
    const out = exec.transformRequest("glm-5.2", body(MARKER), false, {});
    expect(out.messages[1].content).toBe("hi");
  });
});

describe("CodeBuddyExecutor filter is restorable via env gate", () => {
  const exec = new CodeBuddyExecutor();
  afterEach(() => { delete process.env.CODEBUDDY_CN_AGENT_FILTER; });

  it("replaces an agent-identity prompt when re-enabled", () => {
    process.env.CODEBUDDY_CN_AGENT_FILTER = "1";
    const out = exec.transformRequest("glm-5.2", body(MARKER), false, {});
    expect(systemOf(out)).toMatch(/helpful AI assistant/);
  });

  it("still passes a long benign prompt when re-enabled (>2000 arm is gone)", () => {
    process.env.CODEBUDDY_CN_AGENT_FILTER = "1";
    expect(systemOf(exec.transformRequest("glm-5.2", body(LONG), false, {}))).toBe(LONG);
  });
});
