import { DefaultExecutor } from "./default.js";
import { enforceResponseFormat } from "../utils/enforceResponseFormat.js";
import { sanitizeCodeBuddyToolNames, stripCodeBuddySchemaMarkers, flattenCodeBuddyToolChoice } from "../utils/codebuddyToolSanitize.js";
import { applyCodeBuddyRequestHeaders, applyCodeBuddyClientProfile, resolveCodeBuddyClientOverride, applyCodeBuddyBodyRules } from "../utils/codebuddyGateway.js";

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

  // The international gateway is the same Tencent stack behind a different
  // host, so it scores the same per-request fingerprint. Until now this
  // executor sent only the registry's static headers — no conversation ids,
  // no agent headers, no trace headers — which is the shape the gateway's
  // channel check rejects with HTTP 400 / code 11-128 ("conversation id
  // missing", displayTips「这次调用没通过渠道校验，可能不是官方客户端发出的」).
  //
  // Shape extracted 2026-10-22 from the CLI bundle shipped inside WorkBuddy
  // Desktop 5.8.3 (app.asar → app/cli/dist/codebuddy-lite-wb.mjs,
  // `axiosToFetchAdapter`) and from WorkBuddy's own upstream leg
  // (app.asar → app/main/server.js, `applyGatewayHeaders`).
  buildHeaders(credentials, stream, url, model, body) {
    const h = super.buildHeaders(credentials, stream, url, model, body);
    applyCodeBuddyRequestHeaders(h, { credentials, body, scope: "codebuddy-intl" });
    // `CODEBUDDY_CLIENT=workbuddy|cli|ide` swaps the whole identity block
    // (User-Agent, X-IDE-*, X-Product-Version, X-Private-Data) for a
    // credential minted on that platform.
    const profile = resolveCodeBuddyClientOverride();
    if (profile) applyCodeBuddyClientProfile(h, profile);
    return h;
  }

  transformRequest(model, body, stream, credentials) {
    let transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;
    transformed = enforceResponseFormat(transformed) || transformed;
    // Body rules the CLI applies to every model request: `max_tokens` is
    // renamed to `max_completion_tokens` for the OpenAI reasoning models
    // (gpt-5.x, gpt-4.1, o1/o3/o4), and the `xhigh`/`max` thinking levels
    // collapse to `high` when the server publishes no per-model map.
    // Keyed off the model that actually goes upstream.
    applyCodeBuddyBodyRules(transformed, transformed.model || model);

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
  parseError(response, bodyText) {
    if (bodyText) {
      try {
        const data = JSON.parse(bodyText);
        const msg = data?.msg || data?.message || data?.error?.message || "";
        if (data?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
          let resetsAtMs = null;
          const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
          if (match) {
            const dp = match[1];
            const tp = match[2];
            const tz = match[3]
              ? (match[3].includes(":") ? (match[3].startsWith("+") ? match[3] : `+${match[3]}`) : `+${match[3].padStart(2, "0")}:00`)
              : "+08:00";
            const dt = new Date(`${dp}T${tp}${tz}`);
            if (!isNaN(dt.getTime())) resetsAtMs = dt.getTime();
          }
          return {
            status: 429,
            message: msg || "CodeBuddy frequency limit (6004)",
            resetsAtMs,
          };
        }
      } catch {}
    }
    return super.parseError(response, bodyText);
  }
}

export default CodeBuddyIntlExecutor;
