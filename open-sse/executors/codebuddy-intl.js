import { DefaultExecutor } from "./default.js";
import { enforceResponseFormat } from "../utils/enforceResponseFormat.js";
import { sanitizeCodeBuddyToolNames, stripCodeBuddySchemaMarkers, flattenCodeBuddyToolChoice } from "../utils/codebuddyToolSanitize.js";

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  transformRequest(model, body, stream, credentials) {
    let transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;
    transformed = enforceResponseFormat(transformed) || transformed;

    // Same tool-shape normalisation as codebuddy-cn: the intl gateway shares the
    // Tencent model validators that reject illegal/duplicated tool names (11152),
    // `$schema`-carrying parameter schemas (11129), and object-shaped tool_choice
    // (11101).
    transformed = flattenCodeBuddyToolChoice(transformed);
    transformed = sanitizeCodeBuddyToolNames(transformed, body);
    transformed = stripCodeBuddySchemaMarkers(transformed);

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request): needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    transformed.messages = [{ role: "system", content: "You are CodeBuddy Code." }];
    for (const message of source) {
      if (!message || typeof message !== "object" || ["system", "developer"].includes(message.role)) continue;
      if (message.role === "user" && typeof message.content === "string") {
        transformed.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else {
        transformed.messages.push({ ...message });
      }
    }

    return transformed;
  }
}

export default CodeBuddyIntlExecutor;
