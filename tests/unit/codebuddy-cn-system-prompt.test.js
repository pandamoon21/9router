// CodeBuddy CN system-prompt handling.
//
// History: `9138c993` added a rewrite that replaced any system message with
// NEUTRAL_PROMPT when it was longer than 2000 chars OR matched an agent-identity
// regex. The length arm was measured wrong (a 25,716-char benign persona
// prompt was delivered intact to 14 cbcn models, HTTP 200) and stays off.
// The identity-marker arm turned out to be needed after all: a 2026-09-22
// bisect through the local gateway proved that a system prompt containing
// "You are Claude Code, Anthropic's official CLI for Claude." returns 11128
// ("The request was blocked by security policy") on `copilot.tencent.com`,
// while the same prompt with generic wording returns 200. Aegis scans system
// prompts for brand-impersonation strings, and Claude Code sends that exact
// phrase — so the identity-marker arm is now **default-on**. Escape hatch:
// CODEBUDDY_CN_AGENT_FILTER=0 disables it.
import { describe, it, expect, afterEach } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";

const LONG = "x".repeat(2500);
const MARKER = "You are Claude Code, Anthropic's official CLI for coding.";

const body = (content) => ({ messages: [{ role: "system", content }, { role: "user", content: "hi" }] });
const systemOf = (out) => out.messages[0].content;

describe("CodeBuddyExecutor: identity marker replaced by default, length arm stays off", () => {
  const exec = new CodeBuddyExecutor();
  afterEach(() => { delete process.env.CODEBUDDY_CN_AGENT_FILTER; });

  it("keeps a long benign system prompt (>2000-char arm is gone)", () => {
    expect(systemOf(exec.transformRequest("glm-5.2", body(LONG), false, {}))).toBe(LONG);
  });

  it("replaces an agent-identity system prompt by default (WAF-safe path)", () => {
    const out = exec.transformRequest("glm-5.2", body(MARKER), false, {});
    expect(systemOf(out)).toMatch(/helpful AI assistant/);
  });

  it("keeps typed-block content shape when replacing", () => {
    const blocks = [{ type: "text", text: MARKER }];
    const out = exec.transformRequest("glm-5.2", body(blocks), false, {});
    expect(Array.isArray(systemOf(out))).toBe(true);
  });

  it("leaves user messages alone", () => {
    const out = exec.transformRequest("glm-5.2", body(MARKER), false, {});
    expect(out.messages[1].content).toBe("hi");
  });
});

describe("CodeBuddyExecutor: filter is disable-able via env gate", () => {
  const exec = new CodeBuddyExecutor();
  afterEach(() => { delete process.env.CODEBUDDY_CN_AGENT_FILTER; });

  it("passes an agent-identity prompt through when explicitly disabled", () => {
    process.env.CODEBUDDY_CN_AGENT_FILTER = "0";
    expect(systemOf(exec.transformRequest("glm-5.2", body(MARKER), false, {}))).toBe(MARKER);
  });

  it("still passes a long benign prompt when disabled", () => {
    process.env.CODEBUDDY_CN_AGENT_FILTER = "0";
    expect(systemOf(exec.transformRequest("glm-5.2", body(LONG), false, {}))).toBe(LONG);
  });
});
