/**
 * CodeBuddy (Tencent) gateway fingerprint — 1:1 with the real client.
 *
 * Ground truth extracted 2026-10-22 from WorkBuddy Desktop 5.8.3
 * (`C:\Users\naufa\AppData\Local\Programs\WorkBuddy`), whose Electron
 * `resources/app.asar` embeds the CodeBuddy Code CLI:
 *
 *   - app.asar → app/cli/dist/codebuddy-lite-wb.mjs
 *       (CLI leg — `axiosToFetchAdapter`, the client's own upstream request,
 *        plus `buildUserAgent` for the User-Agent template)
 *   - app.asar → app/main/server.js
 *       (WorkBuddy leg — `buildVlmGatewayHeaders`, `applyGatewayHeaders`,
 *        `applyTraceHeaders`: the identity the desktop app stamps on the way
 *        to the gateway)
 *
 * Both legs converge on the same header shape, so this module implements it
 * once and both providers use it. The id shapes and the international
 * deployment match upstream PR #4949's mitmproxy capture of WorkBuddy AI
 * 5.8.4.
 */
import crypto from "node:crypto";

import { CODEBUDDY_CLI_VERSION, generateStableSessionId } from "../services/codebuddy/identity.js";
import { resolveContinuationId } from "./sessionManager.js";

/** WorkBuddy Desktop version that ships the analysed CLI bundle. */
export const CODEBUDDY_WORKBUDDY_APP_VERSION = "5.8.3";

/**
 * CodeBuddy Code CLI version embedded in WorkBuddy Desktop 5.8.3
 * (`@tencent-ai/codebuddy-code` in the bundle's package metadata). The
 * WorkBuddy leg puts this in the tail of its User-Agent.
 */
export const CODEBUDDY_WORKBUDDY_BUNDLED_CLI_VERSION = "2.161.0";

/**
 * Client identity profiles.
 *
 * `cli` / `ide` mirror the CodeBuddy Code CLI, which is what 9router's plugin
 * OAuth flow authenticates as (`platform=CLI` for the CN gateway,
 * `platform=ide` for the international one). `workbuddy` mirrors the WorkBuddy
 * Desktop electron app, whose main process stamps its own identity on the way
 * to the gateway.
 *
 * The identity block is swapped atomically — the upstream binds the access
 * token to the platform it was minted for, so mixing `X-IDE-Type: WorkBuddy`
 * with a CLI-scoped token is exactly the "unapproved channel" shape the CN
 * WAF rejects with code 11128. Pick the profile that matches the credential.
 *
 * `X-Domain` deliberately stays out of the profile: it names the login domain
 * the credential was minted against, which is a registry-level fact.
 */
export const CODEBUDDY_CLIENT_PROFILES = {
  cli: {
    platform: "CLI",
    platformVersion: CODEBUDDY_CLI_VERSION,
    applicationName: "CodeBuddy",
    productVersion: CODEBUDDY_CLI_VERSION,
    extension: "",
    // The CLI advertises private-data mode from its `enableModelOptimization`
    // setting; with model optimisation on (the default) it sends "false".
    privateData: "false",
  },
  ide: {
    platform: "IDE",
    platformVersion: CODEBUDDY_CLI_VERSION,
    applicationName: "CodeBuddy",
    productVersion: CODEBUDDY_CLI_VERSION,
    extension: "",
    privateData: "false",
  },
  workbuddy: {
    platform: "WorkBuddy",
    platformVersion: CODEBUDDY_WORKBUDDY_APP_VERSION,
    applicationName: "workbuddy",
    productVersion: CODEBUDDY_WORKBUDDY_APP_VERSION,
    extension: `CLI/${CODEBUDDY_WORKBUDDY_BUNDLED_CLI_VERSION}`,
    // The WorkBuddy leg always advertises private-data mode.
    privateData: "true",
  },
};

/** Identity header → profile field. */
const PROFILE_IDENTITY_FIELDS = {
  "User-Agent": "userAgent",
  "X-Product-Version": "productVersion",
  "X-IDE-Type": "platform",
  "X-IDE-Name": "platform",
  "X-IDE-Version": "platformVersion",
  "X-Private-Data": "privateData",
};

/**
 * Resolve an *explicit* client-profile override.
 *
 * Returns `null` when `CODEBUDDY_CLIENT` is unset, so callers can tell "no
 * override" apart from "override equals the provider default" and leave the
 * registry's static identity headers untouched.
 */
export function resolveCodeBuddyClientOverride() {
  const override = String(process.env.CODEBUDDY_CLIENT || "").trim().toLowerCase();
  if (override && CODEBUDDY_CLIENT_PROFILES[override]) {
    return CODEBUDDY_CLIENT_PROFILES[override];
  }
  return null;
}

/**
 * Resolve the effective client profile for a provider.
 */
export function resolveCodeBuddyClientProfile(defaultProfile = "cli") {
  return resolveCodeBuddyClientOverride() || CODEBUDDY_CLIENT_PROFILES[defaultProfile] || CODEBUDDY_CLIENT_PROFILES.cli;
}

/**
 * Build the User-Agent the client sends.
 *
 * Mirrors the CLI's `buildUserAgent`:
 *   `<platform>/<platformVersion> <applicationName>/<productVersion> [extension]`
 * The WorkBuddy host injects `CLI/<bundledCliVersion>` as the extension, which
 * is why the desktop app's UA carries a third segment.
 */
export function buildCodeBuddyUserAgent(profile) {
  const parts = [];
  if (profile.platform) parts.push(`${profile.platform}/${profile.platformVersion || "unknown"}`);
  if (profile.applicationName) parts.push(`${profile.applicationName}/${profile.productVersion || "unknown"}`);
  if (profile.extension) parts.push(profile.extension);
  return parts.join(" ");
}

/**
 * RFC 9562 UUIDv7 — 48-bit millisecond timestamp first, then random bits.
 *
 * The desktop client's request/message ids are this shape; dropping the
 * dashes yields the 32-hex form the gateway actually puts in the headers.
 */
export function codebuddyUuid7() {
  const buf = crypto.randomBytes(16);
  const ms = Date.now();
  buf[0] = (ms / 2 ** 40) & 0xff;
  buf[1] = (ms / 2 ** 32) & 0xff;
  buf[2] = (ms / 2 ** 24) & 0xff;
  buf[3] = (ms / 2 ** 16) & 0xff;
  buf[4] = (ms / 2 ** 8) & 0xff;
  buf[5] = ms & 0xff;
  buf[6] = (buf[6] & 0x0f) | 0x70; // version 7
  buf[8] = (buf[8] & 0x3f) | 0x80; // RFC variant
  const hex = buf.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** The dashless 32-hex id form the gateway carries in its request headers. */
export function codebuddyHexId() {
  return codebuddyUuid7().replace(/-/g, "");
}

/**
 * Distributed-trace headers.
 *
 * Mirrors `applyTraceHeaders` in the WorkBuddy main process and the OTel
 * span injection in the CLI's request adapter: a W3C `traceparent`, its B3
 * twin, and the B3/X-Trace-ID header set the gateway correlates on. A root
 * span has no parent, so `b3` carries three segments and no
 * `X-B3-ParentSpanId` is emitted.
 */
export function buildCodeBuddyTraceHeaders() {
  const traceId = codebuddyHexId();
  const spanId = crypto.randomBytes(8).toString("hex");
  return {
    "X-Trace-ID": traceId,
    traceparent: `00-${traceId}-${spanId}-01`,
    b3: `${traceId}-${spanId}-1`,
    "X-B3-TraceId": traceId,
    "X-B3-SpanId": spanId,
    "X-B3-Sampled": "1",
  };
}

/**
 * Build the per-request CodeBuddy gateway headers.
 *
 * The id family follows the client:
 *   X-Conversation-ID          dashed UUID, stable for the conversation
 *   X-Conversation-Request-ID  32 hex, fresh per turn   ┐ aliases each other
 *   X-Root-Request-ID          32 hex                    ┘
 *   X-Conversation-Message-ID  32 hex, fresh per turn   ┐ aliases each other
 *   X-Request-ID               32 hex                    ┘
 */
export function buildCodeBuddyGatewayHeaders({
  conversationId,
  conversationRequestId,
  rootRequestId,
  messageId,
  agentIntent = "craft",
  agentPurpose = "conversation",
  agentType = "main",
} = {}) {
  return {
    "X-Product": "SaaS",
    "X-Conversation-ID": conversationId,
    "X-Conversation-Request-ID": conversationRequestId,
    "X-Root-Request-ID": rootRequestId ?? conversationRequestId,
    "X-Conversation-Message-ID": messageId,
    "X-Request-ID": messageId,
    "X-Agent-Intent": agentIntent,
    "X-Agent-Purpose": agentPurpose,
    "X-Agent-Type": agentType,
    ...buildCodeBuddyTraceHeaders(),
  };
}

/**
 * Apply a client profile's identity block on top of headers that already
 * carry the registry's static identity. Only the identity headers are
 * replaced — the per-request set is untouched.
 */
export function applyCodeBuddyClientProfile(headers, profile) {
  if (!profile) return headers;
  for (const [name, field] of Object.entries(PROFILE_IDENTITY_FIELDS)) {
    if (headers[name] === undefined) continue;
    headers[name] = field === "userAgent" ? buildCodeBuddyUserAgent(profile) : profile[field];
  }
  return headers;
}

/**
 * Model-id prefixes whose `max_tokens` the client renames to
 * `max_completion_tokens` when the server publishes no explicit cap.
 *
 * From the CLI's `MaxTokensFieldRule.FALLBACK_COMPLETION_TOKEN_PREFIXES`.
 */
const MAX_COMPLETION_TOKEN_PREFIXES = ["o1", "o3", "o4", "gpt-4.1", "gpt-5"];

/** Raw client headers that carry a caller-supplied session/conversation id. */
const CLIENT_SESSION_HEADER_KEYS = ["x-session-id", "session-id", "session_id", "x-amp-thread-id"];

/** Find a raw client header by case-insensitive name; returns the key. */
function findRawHeaderKey(raw, name) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.get === "function") return raw.get(name) ? name : null;
  return Object.keys(raw).find((key) => key.toLowerCase() === name.toLowerCase()) || null;
}

/** Read a raw client header value (trimmed) or null. */
function readRawHeader(raw, name) {
  if (!raw || typeof raw !== "object") return null;
  const key = findRawHeaderKey(raw, name);
  if (!key) return null;
  const value = typeof raw.get === "function" ? raw.get(name) : raw[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Read the caller's own session id, if it sent one.
 *
 * Claude Code and the CodeBuddy family both carry a session id; when it is
 * present the conversation id can be stable across the turns of one
 * conversation without guessing from the message history.
 */
export function readCodebuddyClientSessionId(raw, body) {
  for (const key of CLIENT_SESSION_HEADER_KEYS) {
    const value = readRawHeader(raw, key);
    if (value) return value;
  }
  const fromBody = body?.session_id ?? body?.sessionId ?? body?.metadata?.user_id;
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();
  return null;
}

/**
 * Stamp the CodeBuddy per-request header family onto an outgoing request.
 *
 * The conversation id follows the client: a caller-supplied `X-Conversation-ID`
 * wins and is preserved verbatim; otherwise a stable id is derived from the
 * caller's session id, or from the credential's own session id when the caller
 * identifies no session. The per-turn ids are fresh on every call, exactly
 * like the client's.
 */
export function applyCodeBuddyRequestHeaders(headers, { credentials, body, scope = "codebuddy" } = {}) {
  const raw = credentials?.rawHeaders || {};

  const clientConversationId = readRawHeader(raw, "x-conversation-id");
  const clientRequestId = readRawHeader(raw, "x-conversation-request-id");
  const clientMessageId = readRawHeader(raw, "x-conversation-message-id");

  const token = credentials?.accessToken || credentials?.apiKey || "";
  const sessionKey = readCodebuddyClientSessionId(raw, body) || generateStableSessionId(token);
  const conversationId = clientConversationId || resolveContinuationId({
    sessionId: sessionKey,
    connectionId: credentials?.connectionId,
    scope,
  });

  const conversationRequestId = clientRequestId || codebuddyHexId();
  const messageId = clientMessageId || codebuddyHexId();

  Object.assign(headers, buildCodeBuddyGatewayHeaders({
    conversationId,
    conversationRequestId,
    rootRequestId: conversationRequestId,
    messageId,
  }));

  // Preserve the caller's own id headers (and their casing) when it sent them.
  for (const [name, value] of [
    ["x-conversation-id", clientConversationId],
    ["x-conversation-request-id", clientRequestId],
    ["x-conversation-message-id", clientMessageId],
  ]) {
    if (!value) continue;
    const key = findRawHeaderKey(raw, name);
    if (key) headers[key] = value;
  }

  return headers;
}

/**
 * Body-level rules the client applies to every model request before dispatch.
 *
 * - `MaxTokensFieldRule` — OpenAI reasoning models reject `max_tokens`.
 * - `LegacyXhighFallbackRule` — with no per-model thinking-level map, the
 *   client collapses the `xhigh`/`max` levels it knows to `high`.
 *
 * Both are no-ops for models that publish their own caps, which 9router does
 * not carry — so the fallback behaviour is the one that matches the client.
 */
export function applyCodeBuddyBodyRules(body, model) {
  if (!body || typeof body !== "object") return body;

  if (body.max_tokens && !body.max_completion_tokens && model) {
    const id = String(model);
    if (MAX_COMPLETION_TOKEN_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
    }
  }

  if (body.reasoning_effort === "xhigh" || body.reasoning_effort === "max") {
    body.reasoning_effort = "high";
  }
  if (body.reasoning && typeof body.reasoning === "object" && !Array.isArray(body.reasoning)) {
    if (body.reasoning.effort === "xhigh" || body.reasoning.effort === "max") {
      body.reasoning.effort = "high";
    }
  }

  return body;
}
