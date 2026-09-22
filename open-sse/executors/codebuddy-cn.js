import crypto from "node:crypto";
import { DefaultExecutor } from "./default.js";
import { enforceResponseFormat } from "../utils/enforceResponseFormat.js";

/**
 * CodeBuddyExecutor — talks to https://copilot.tencent.com/v2/chat/completions
 *
 * CodeBuddy is OpenAI-compatible but rejects non-stream chat requests
 * (HTTP 400, code 11101 "Non-stream chat request is currently not supported").
 * The same-format (openai→openai) translator path leaves body.stream as the
 * client sent it, so we force it true here — 9router still re-aggregates the
 * SSE into a JSON response for non-streaming clients.
 */
export class CodeBuddyExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-cn");
  }

  // Tencent Aegis (WAF) flags requests that lack the real CLI's per-request
  // fingerprint. Real @tencent-ai/codebuddy-code@2.156.0 stamps these 8 headers
  // on every /v2/chat/completions call — the registry only sets static ones, so
  // we add the dynamic identity headers here. Values match constants extracted
  // from the CLI bundle (see resolveAgentType → main/subagent/team).
  buildHeaders(credentials, stream, url, model, body) {
    const h = super.buildHeaders(credentials, stream, url, model, body);
    const cid = crypto.randomUUID();
    const mid = crypto.randomUUID();
    h["X-Conversation-ID"] = cid;
    h["X-Conversation-Request-ID"] = crypto.randomUUID();
    h["X-Conversation-Message-ID"] = mid;
    h["X-Request-ID"] = mid;
    h["X-Agent-Intent"] = "craft";
    h["X-Agent-Type"] = "main";
    h["X-Private-Data"] = "false";
    h["X-Product-Version"] = "2.156.0";
    return h;
  }

  transformRequest(model, body, stream, credentials) {
    let transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;
    transformed = enforceResponseFormat(transformed) || transformed;

    // Tencent's content filter flags CLI agent system prompts ("You are Claude
    // Code, Anthropic's official CLI...") as prompt injection / sensitive content
    // and rejects the whole request. Detect agent system prompts (length catch-all
    // + identity-marker regex) and replace them with a neutral one, while leaving
    // legitimate user system prompts untouched. content may be a string or typed
    // blocks ([{type:"text",text}]) depending on the incoming client format, so
    // flatten before matching and preserve the original shape on replacement.
    //
    // DISABLED 2026-09-20 (fork). Both arms were measured against the live
    // upstream and neither survives contact:
    //   - Tencent accepts long system prompts: 25,716 chars delivered intact on
    //     glm-5.2 / deepseek-v4-pro / deepseek-v4-flash / deepseek-v4.1-flash
    //     (HTTP 200, ~6034 in_tokens), and on 10 more cbcn models in a later
    //     sweep (14/14 HTTP 200, 13 followed the persona).
    //   - The >2000-char arm was silently discarding every long prompt our own
    //     users set, with no error and no log.
    // 2026-09-22 UPDATE: the length arm stays off, but the identity-marker arm
    // is now **default-on** — proven by bisect against
    // `copilot.tencent.com/v2/chat/completions` on 2026-09-22:
    // system prompt "You are Claude Code, Anthropic's official CLI for Claude."
    // returns 11128 (WAF "unapproved channel"); the same prompt with generic
    // wording returns 200. Aegis scans system-prompt content for brand
    // impersonation strings, and Claude Code sends that exact frase on every
    // request — so any user routing Claude Code → cbcn hits a hard 400 without
    // this rewrite. Escape hatch preserved: set CODEBUDDY_CN_AGENT_FILTER=0 to
    // disable (e.g. probing raw upstream behavior).
    const FILTER_ENABLED = process.env.CODEBUDDY_CN_AGENT_FILTER !== "0";
    const NEUTRAL_PROMPT = "You are a helpful AI assistant that helps with software engineering tasks.";
    const AGENT_PATTERN = /you are claude code|claude.?code.+official.+cli|anthropic.+official.+cli|anxthxropic.+official.+cli|you are (?:cursor|windsurf|cline|aider|continue|copilot|cody)|you are an? (?:ai )?(?:coding |code )?agent|cc_entrypoint\s*=\s*(?:cli|vscode|jetbrains|gui)|claude.?code.+issues|give feedback.+claude.?code|you are .{0,30}(?:powerful )?ai agent|orchestration capabilities|OhMyOpenCode|<agent-identity>|<Role>|<Behavior_Instructions>/i;
    const flatten = (content) =>
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((b) => (b && typeof b.text === "string" ? b.text : "")).join("\n")
          : "";
    if (FILTER_ENABLED && Array.isArray(transformed.messages)) {
      transformed.messages = transformed.messages.map((message) => {
        if (!message || message.role !== "system") return message;
        const text = flatten(message.content);
        if (!text) return message;
        if (AGENT_PATTERN.test(text)) {
          return typeof message.content === "string"
            ? { ...message, content: NEUTRAL_PROMPT }
            : { ...message, content: [{ type: "text", text: NEUTRAL_PROMPT }] };
        }
        return message;
      });
    }

    // CodeBuddy only surfaces model reasoning when the request carries the CLI's
    // OpenAI-style params: reasoning_effort + reasoning_summary:"auto". 9router's
    // thinking pipeline sets reasoning_effort only when the client asks, and never
    // sets reasoning_summary — so reasoning never shows. Mirror the CLI here.
    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort; // gateway has no "none" — just omit
    } else if (eff) {
      // Client explicitly asked for reasoning — mirror the CLI's reasoning_summary
      // so CodeBuddy surfaces the model's reasoning.
      transformed.reasoning_summary = "auto";
    }
    // No reasoning requested: leave both unset. Forcing reasoning_effort:"medium"
    // + reasoning_summary on plain requests makes CodeBuddy trip its content
    // filter and return an error (#2071).
    return transformed;
  }
}

export default CodeBuddyExecutor;
