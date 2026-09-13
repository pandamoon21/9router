/**
 * kiro-cli wire parity — chatCore must not add a top-level `model` to a Kiro body.
 *
 * The Kiro wire body is exactly { conversationState, profileArn }; the model
 * travels inside conversationState.currentMessage.userInputMessage.modelId.
 *
 * chatCore injects `translatedBody.model` for every provider (most need it), and
 * that put a key on the Kiro wire that kiro-cli never sends. The §6.4 live diff
 * against a real CLI capture caught it — the translator-level tests could not,
 * because the injection happens after translation.
 */
import { describe, it, expect, vi } from "vitest";

const executeMock = vi.fn(async () => ({
  response: new Response("data: [DONE]\n\n", {
    headers: { "content-type": "text/event-stream" },
  }),
  url: "https://runtime.us-east-1.kiro.dev/",
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    execute: executeMock,
    buildUrl: () => "https://runtime.us-east-1.kiro.dev/",
  }),
  getExecutorForProvider: () => ({
    execute: executeMock,
    buildUrl: () => "https://runtime.us-east-1.kiro.dev/",
  }),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

async function runKiro(model) {
  executeMock.mockClear();
  const body = { model, messages: [{ role: "user", content: "hi" }] };
  await handleChatCore({
    body,
    modelInfo: { provider: "kiro", model },
    credentials: {
      accessToken: "aoaTEST",
      providerSpecificData: { authMethod: "builder-id" },
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    connectionId: "kiro-parity-test",
    rtkEnabled: false,
    headroomEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    clientRawRequest: {
      endpoint: "/v1/chat/completions",
      body,
      headers: { accept: "application/json", "user-agent": "test/1.0" },
    },
  });
  const call = executeMock.mock.calls.at(-1);
  return call ? call[0]?.body : null;
}

describe("chatCore → Kiro body", () => {
  it("does not add a top-level `model` key", async () => {
    const sent = await runKiro("claude-opus-4.5");
    expect(sent, "executor was not called").toBeTruthy();
    expect(sent).not.toHaveProperty("model");
  });

  it("still carries the model inside conversationState", async () => {
    const sent = await runKiro("claude-opus-4.5");
    expect(sent.conversationState.currentMessage.userInputMessage.modelId)
      .toBe("claude-opus-4.5");
  });

  it("top-level keys stay exactly {conversationState, profileArn}", async () => {
    const sent = await runKiro("claude-opus-4.5");
    expect(Object.keys(sent).sort()).toEqual(["conversationState", "profileArn"]);
  });
});
