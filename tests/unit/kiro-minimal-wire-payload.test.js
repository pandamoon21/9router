import { describe, expect, it } from "vitest";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";

for (const [name, translate, body] of [
  ["OpenAI", openaiToKiroRequest, { messages: [{ role: "user", content: "hello" }] }],
  ["Claude", claudeToKiroRequest, { messages: [{ role: "user", content: "hello" }] }],
]) {
  describe(`${name} Kiro minimal wire payload`, () => {
    it("matches the kiro-cli wire shape on the fields it sends", () => {
      const payload = translate("kiro/claude-sonnet-4.5", body, true, {});
      // `agentMode` is a 9router-era field kiro-cli never sends.
      expect(payload).not.toHaveProperty("agentMode");
      // kiro-cli DOES send these two on every turn (captured 2026-09-14), so
      // they are required, not omitted.
      expect(payload.conversationState.agentTaskType).toBe("vibe");
      expect(typeof payload.conversationState.agentContinuationId).toBe("string");
      expect(payload.conversationState.chatTriggerType).toBe("MANUAL");
      expect(payload.conversationState.currentMessage.userInputMessage.origin).toBe("KIRO_CLI");
      // The CLI sends no inferenceConfig at the top level.
      expect(payload).not.toHaveProperty("inferenceConfig");
    });
  });
}
