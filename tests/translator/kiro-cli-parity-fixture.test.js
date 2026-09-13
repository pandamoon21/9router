/**
 * kiro-cli wire parity — structural check against the real CLI capture.
 *
 * Fixture: docs/fixtures/chat_request.kiro-cli.json — a 55 KB body captured
 * verbatim off the wire from kiro-cli.exe while hitting
 * AmazonCodeWhispererStreamingService.GenerateAssistantResponse.
 *
 * We assert KEY SETS, never byte equality: conversationId,
 * agentContinuationId and the injected time context are legitimately variable
 * and must NOT match the capture.
 *
 * The fixture lives in the research repo, so this test skips cleanly when it
 * is not checked out alongside 9router.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "../../../Riset-Kiro/docs/fixtures/chat_request.kiro-cli.json");
const HAVE = existsSync(FIXTURE);
const capture = HAVE ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;

// A plain turn shaped like the capture's currentMessage.
function build(model = "claude-opus-4.7") {
  return openaiToKiroRequest(
    model,
    { messages: [{ role: "user", content: "hello" }] },
    true,
    {}
  );
}

describe.skipIf(!HAVE)("capture fixture — body key sets match kiro-cli", () => {
  it("the capture still has the shape these assertions depend on", () => {
    expect(Object.keys(capture).sort()).toEqual(["conversationState", "profileArn"]);
  });

  it("top-level keys are exactly {conversationState, profileArn}", () => {
    const body = build();
    const expected = Object.keys(capture).sort();
    const actual = Object.keys(body).sort();
    // additionalModelRequestFields only appears when an effort is requested;
    // this plain turn requests none, so the key set must match exactly.
    expect(actual).toEqual(expected);
  });

  it("conversationState key set matches the capture", () => {
    const body = build();
    expect(Object.keys(body.conversationState).sort())
      .toEqual(Object.keys(capture.conversationState).sort());
  });

  it("currentMessage.userInputMessage key set matches the capture", () => {
    const capUm = capture.conversationState.currentMessage.userInputMessage;
    const um = build().conversationState.currentMessage.userInputMessage;
    expect(Object.keys(um).sort()).toEqual(Object.keys(capUm).sort());
  });

  it("userInputMessageContext carries envState with both keys", () => {
    const umc = build().conversationState.currentMessage.userInputMessage.userInputMessageContext;
    const capUmc = capture.conversationState.currentMessage.userInputMessage.userInputMessageContext;
    // The capture also carries `tools` (it was a tool turn); a plain turn does not.
    const env = umc.envState;
    expect(Object.keys(env).sort()).toEqual(Object.keys(capUmc.envState).sort());
    expect(typeof env.operatingSystem).toBe("string");
    expect(typeof env.currentWorkingDirectory).toBe("string");
    expect(env.operatingSystem).toBe(capUmc.envState.operatingSystem);
  });

  it("origin and agentTaskType match the CLI's literal values", () => {
    const cs = build().conversationState;
    expect(cs.currentMessage.userInputMessage.origin).toBe("KIRO_CLI");
    expect(cs.agentTaskType).toBe("vibe");
    expect(cs.currentMessage.userInputMessage.origin)
      .toBe(capture.conversationState.currentMessage.userInputMessage.origin);
    expect(cs.agentTaskType).toBe(capture.conversationState.agentTaskType);
  });

  it("has no inferenceConfig", () => {
    expect(build()).not.toHaveProperty("inferenceConfig");
    expect(capture).not.toHaveProperty("inferenceConfig");
  });

  it("has no additionalModelRequestFields when no effort is requested", () => {
    expect(build()).not.toHaveProperty("additionalModelRequestFields");
    expect(capture).not.toHaveProperty("additionalModelRequestFields");
  });

  it("history entries use the same per-turn key as the capture", () => {
    const capKeys = new Set(capture.conversationState.history.flatMap((t) => Object.keys(t)));
    const body = openaiToKiroRequest(
      "claude-opus-4.7",
      {
        messages: [
          { role: "user", content: "first" },
          { role: "assistant", content: "answer" },
          { role: "user", content: "second" },
        ],
      },
      true,
      {}
    );
    for (const turn of body.conversationState.history) {
      for (const key of Object.keys(turn)) {
        expect(capKeys, `history key ${key} is not in the capture`).toContain(key);
      }
    }
  });
});
