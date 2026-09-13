/**
 * kiro-cli wire parity — request body shape.
 *
 * Locks the body shape of both Kiro translators against the captured CLI
 * payload (docs/fixtures/chat_request.kiro-cli.json): top level is exactly
 * { conversationState, profileArn }, origin is KIRO_CLI, envState is present,
 * and no inferenceConfig is emitted.
 */
import { describe, it, expect } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";

const OAUTH_CRED = {
  accessToken: "aoaTEST",
  providerSpecificData: {
    authMethod: "builder-id",
    profileArn: "arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX",
  },
};

const openaiBody = {
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "what is 2+2?" },
  ],
};

const claudeBody = {
  system: "You are helpful.",
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "what is 2+2?" },
  ],
};

function payloads() {
  return [
    ["openai→kiro", openaiToKiroRequest("claude-sonnet-4.5", openaiBody, true, OAUTH_CRED)],
    ["claude→kiro", claudeToKiroRequest("claude-sonnet-4.5", claudeBody, true, OAUTH_CRED)],
  ];
}

describe("kiro body — top-level shape", () => {
  for (const [label, build] of [
    ["openai→kiro", () => openaiToKiroRequest("claude-sonnet-4.5", openaiBody, true, OAUTH_CRED)],
    ["claude→kiro", () => claudeToKiroRequest("claude-sonnet-4.5", claudeBody, true, OAUTH_CRED)],
  ]) {
    describe(label, () => {
      const payload = build();

      it("is non-null", () => {
        expect(payload).toBeTruthy();
      });

      it("has exactly conversationState + profileArn at top level", () => {
        expect(Object.keys(payload).sort()).toEqual(["conversationState", "profileArn"]);
      });

      it("never emits inferenceConfig", () => {
        expect(payload.inferenceConfig).toBeUndefined();
      });

      it("does not emit additionalModelRequestFields when no effort is set", () => {
        expect(payload.additionalModelRequestFields).toBeUndefined();
      });

      it("sets origin to KIRO_CLI (not AI_EDITOR)", () => {
        const cm = payload.conversationState.currentMessage.userInputMessage;
        expect(cm.origin).toBe("KIRO_CLI");
        expect(cm.origin).not.toBe("AI_EDITOR");
      });

      it("sets agentTaskType and a fresh agentContinuationId", () => {
        const cs = payload.conversationState;
        expect(cs.agentTaskType).toBe("vibe");
        expect(cs.agentContinuationId).toMatch(/^[0-9a-f-]{36}$/);
        expect(cs.agentContinuationId).not.toBe(cs.conversationId);
      });

      it("carries envState with both keys and a lowercase os enum", () => {
        const ctx = payload.conversationState.currentMessage.userInputMessage
          .userInputMessageContext;
        expect(ctx).toBeTruthy();
        expect(Object.keys(ctx.envState).sort()).toEqual([
          "currentWorkingDirectory",
          "operatingSystem",
        ]);
        expect(["windows", "linux", "macos"]).toContain(ctx.envState.operatingSystem);
        expect(ctx.envState.operatingSystem).not.toBe("win32");
        expect(ctx.envState.operatingSystem).not.toBe("darwin");
      });

      it("keeps chatTriggerType MANUAL", () => {
        expect(payload.conversationState.chatTriggerType).toBe("MANUAL");
      });
    });
  }
});

describe("kiro body — invariants across both translators", () => {
  it("agentContinuationId differs between two builds (fresh per turn)", () => {
    const a = openaiToKiroRequest("claude-sonnet-4.5", openaiBody, true, OAUTH_CRED);
    const b = openaiToKiroRequest("claude-sonnet-4.5", openaiBody, true, OAUTH_CRED);
    expect(a.conversationState.agentContinuationId).not.toBe(
      b.conversationState.agentContinuationId
    );
  });

  it("both translators agree on the shared parity fields", () => {
    const pairs = payloads();
    const shapes = pairs.map(([, p]) => ({
      top: Object.keys(p).sort(),
      origin: p.conversationState.currentMessage.userInputMessage.origin,
      taskType: p.conversationState.agentTaskType,
      hasEnv: Boolean(
        p.conversationState.currentMessage.userInputMessage.userInputMessageContext?.envState
      ),
    }));
    expect(shapes[0]).toEqual(shapes[1]);
  });
});
