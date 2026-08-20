/**
 * CodeBuddy (Tencent) telemetry sender — /v2/report + Galileo.
 *
 * The official CodeBuddy CLI emits lifecycle + chat events to
 *   POST https://copilot.tencent.com/v2/report
 * and periodic analytics to galileotelemetry.tencent.com. A key that chats
 * without any telemetry activity is flagged "silent key" → ban.
 *
 * This module fire-and-forgets the same events around each chat request so
 * 9router's traffic shape matches the official CLI. All sends are best-effort:
 * telemetry must never block or fail a chat request.
 *
 * Reference: 9router_CodeBuddy_Security_Fix_Guide §1.4, §1.5, §3 Rec 1/3/5.
 */
import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { dbg } from "../../utils/debugLog.js";
import {
  CODEBUDDY_BUILD_INFO,
  CODEBUDDY_CLI_VERSION,
  GALILEO_TOPIC,
  buildCodebuddyCommonFields,
  getCodebuddyIdentity,
} from "./identity.js";

const REPORT_URL_CN = "https://copilot.tencent.com/v2/report";
const REPORT_URL_INTL = "https://www.codebuddy.ai/v2/report";
const GALILEO_COLLECT_URL = "https://galileotelemetry.tencent.com/collect";
const GALILEO_TRACES_URL = "https://galileotelemetry.tencent.com/v1/traces";
const GALILEO_WHITELIST_URL = "https://galileotelemetry.tencent.com/aegiscontrol/whitelist";

const isIntl = (provider) => provider === "codebuddy-intl";

const reportUrlFor = (provider) => (isIntl(provider) ? REPORT_URL_INTL : REPORT_URL_CN);
const domainFor = (provider) => (isIntl(provider) ? "www.codebuddy.ai" : "www.codebuddy.cn");

function randomId(len) {
  return Array.from(crypto.getRandomValues(new Uint8Array(len)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Fire-and-forget POST to /v2/report. Never throws.
 */
async function sendReport(provider, accessToken, events, log) {
  const url = reportUrlFor(provider);
  const domain = domainFor(provider);
  const identity = getCodebuddyIdentity(accessToken);
  const common = buildCodebuddyCommonFields(identity, { domain });

  // Stamp every event with the common envelope.
  const payload = events.map((e) => ({ ...common, ...e }));

  try {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        Accept: "application/json",
        "User-Agent": `CLI/${CODEBUDDY_CLI_VERSION} CodeBuddy/${CODEBUDDY_CLI_VERSION}`,
        Authorization: `Bearer ${accessToken}`,
        "X-User-Id": identity.uid || "",
        "X-Domain": domain,
        "X-Product": "SaaS",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify(payload),
    });
    dbg("CB_TELEMETRY", `report ${response.status} (${events.map((e) => e.eventCode).join(",")})`);
    if (!response.ok) {
      log?.warn?.("CB_TELEMETRY", `report failed: ${response.status}`);
    }
  } catch (e) {
    log?.warn?.("CB_TELEMETRY", `report error: ${e.message}`);
  }
}

/**
 * Send ide_lifecycle + plugin_status on first use of a credential (startup signal).
 */
export async function sendCodebuddyLifecycle(provider, accessToken, log) {
  if (!accessToken) return;
  const identity = getCodebuddyIdentity(accessToken);
  const now = Date.now();
  const events = [
    {
      eventCode: "ide_lifecycle",
      timestamp: now,
      reportDelay: 2000,
      action: "start",
      text: JSON.stringify({
        sessionId: identity.sessionId,
        platform: "win32",
        arch: "x64",
        appVersion: CODEBUDDY_CLI_VERSION,
        startedAt: now,
      }),
    },
    {
      eventCode: "plugin_status",
      timestamp: now,
      reportDelay: 3000,
      status: "info",
      text: "pluginStart",
      isInterval: false,
    },
  ];
  await sendReport(provider, accessToken, events, log);
}

/**
 * Send pre-chat telemetry: agent_task_created + chat_message_send + chat_request_send.
 *
 * @param {Object} ctx - { provider, accessToken, conversationId, requestId, messageId, inputLength, model, log }
 */
export async function sendCodebuddyPreChat({
  provider,
  accessToken,
  conversationId,
  requestId,
  messageId,
  inputLength,
  model,
  log,
}) {
  if (!accessToken) return;
  const now = Date.now();
  const events = [
    {
      eventCode: "agent_task_created",
      timestamp: now - 2000,
      reportDelay: 1000,
      name: "working",
      mode: "craft",
      source: "LOCAL",
      has_repo: false,
      repo_type: "none",
      workspace_type: "empty",
      has_connector: false,
      has_expert: false,
      has_skill: false,
      requestModelName: "Auto",
      requestModelId: "auto",
      conversationId,
      requestId,
    },
    {
      eventCode: "chat_message_send",
      timestamp: now - 1500,
      reportDelay: 1000,
      conversationId,
      requestId,
      messageId,
      requestModelId: "auto",
      requestModelName: "Auto",
      historyCount: 1,
      isContextTruncated: false,
      currentStepCount: 1,
      presentAt: now - 1500,
    },
    {
      eventCode: "chat_request_send",
      timestamp: now - 1000,
      reportDelay: 1000,
      inputLength: inputLength || 0,
      requestModelId: "auto",
      requestModelName: "Auto",
      mode: "craft",
      conversationId,
      requestId,
      messageId,
      presentAt: now - 1000,
    },
  ];
  // avoid unused var warning for model param — it's part of the api contract for future use
  void model;
  await sendReport(provider, accessToken, events, log);
}

/**
 * Send post-chat telemetry: chat_message_response + agent_task_completed.
 *
 * @param {Object} ctx - { provider, accessToken, conversationId, requestId, messageId, inputToken, outputToken, durationMs, isSuccessful, finishReason, log }
 */
export async function sendCodebuddyPostChat({
  provider,
  accessToken,
  conversationId,
  requestId,
  messageId,
  inputToken,
  outputToken,
  durationMs,
  isSuccessful,
  finishReason,
  log,
}) {
  if (!accessToken) return;
  const now = Date.now();
  const total = (inputToken || 0) + (outputToken || 0);
  const events = [
    {
      eventCode: "chat_message_response",
      timestamp: now - 500,
      reportDelay: 1000,
      requestModelId: "auto",
      requestModelName: "Auto",
      responseModelId: "auto",
      inputToken: inputToken || 0,
      outputToken: outputToken || 0,
      totalToken: total,
      cachedTokens: 0,
      isSuccessful: isSuccessful !== false,
      messageErrorCode: "",
      finishReason: finishReason || "stop",
      firstTokenAt: now - (durationMs || 500),
      presentAt: now - 500,
      conversationId,
      requestId,
      messageId,
    },
    {
      eventCode: "agent_task_completed",
      timestamp: now,
      reportDelay: 1000,
      mode: "LOCAL",
      task_id: conversationId,
      duration_ms: durationMs || 0,
      total_steps: 1,
      conversationId,
      requestId,
      messageId,
    },
  ];
  await sendReport(provider, accessToken, events, log);
}

/**
 * Send a Galileo /collect heartbeat so the key shows periodic analytics activity.
 */
export async function sendCodebuddyGalileoCollect(provider, accessToken, uid, log) {
  if (!accessToken) return;
  const identity = getCodebuddyIdentity(accessToken);
  const userId = uid || identity.uid;
  if (!userId) return;
  const payload = {
    topic: GALILEO_TOPIC,
    bean: {
      uid: userId,
      aid: identity.sessionId.slice(0, 16),
      env: "production",
      platform: "windows_x64",
      netType: "wifi",
    },
    ext: JSON.stringify({
      wb_process: "main",
      wb_version: "5.3.8",
      appVersion: "5.3.8",
      wb_env: "production",
      platform: "windows_x64",
      node: "22.21.1",
      electron: "37.10.3",
      chrome: "138.0.7204.251",
      os: "windows 10.0.26200",
    }),
    scheme: "v2",
    d2: [],
    v: "2.6.13",
  };
  try {
    const response = await proxyAwareFetch(GALILEO_COLLECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
      },
      body: JSON.stringify(payload),
    });
    dbg("CB_TELEMETRY", `galileo collect ${response.status}`);
  } catch (e) {
    log?.warn?.("CB_TELEMETRY", `galileo collect error: ${e.message}`);
  }
  // avoid unused var
  void provider;
}

/**
 * Send an OpenTelemetry trace span for a chat request.
 */
export async function sendCodebuddyGalileoTrace(provider, { durationMs, log } = {}) {
  const traceId = randomId(16);
  const spanId = randomId(8);
  const nowNs = String(BigInt(Date.now()) * 1000000n);
  const endNs = String(BigInt(Date.now() + (durationMs || 1000)) * 1000000n);
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "codebuddy-cli" } },
            { key: "telemetry.sdk.language", value: { stringValue: "nodejs" } },
            { key: "telemetry.sdk.name", value: { stringValue: "opentelemetry" } },
            { key: "service.version", value: { stringValue: CODEBUDDY_CLI_VERSION } },
            { key: "env_name", value: { stringValue: "production" } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "codebuddy-cli" },
            spans: [
              {
                traceId,
                spanId,
                name: "wb.chat.request",
                kind: 1,
                startTimeUnixNano: nowNs,
                endTimeUnixNano: endNs,
              },
            ],
          },
        ],
      },
    ],
  };
  try {
    const response = await proxyAwareFetch(GALILEO_TRACES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    dbg("CB_TELEMETRY", `galileo trace ${response.status}`);
  } catch (e) {
    log?.warn?.("CB_TELEMETRY", `galileo trace error: ${e.message}`);
  }
  // avoid unused var
  void provider;
}

/**
 * Fetch the Aegis security whitelist (marks the client as known).
 */
export async function fetchCodebuddyAegisWhitelist(provider, uid, log) {
  if (!uid) return;
  const url = `${GALILEO_WHITELIST_URL}?uid=${encodeURIComponent(uid)}&topic=${GALILEO_TOPIC}`;
  try {
    const response = await proxyAwareFetch(url, { method: "GET" });
    dbg("CB_TELEMETRY", `aegis whitelist ${response.status}`);
  } catch (e) {
    log?.warn?.("CB_TELEMETRY", `aegis whitelist error: ${e.message}`);
  }
  // avoid unused var
  void provider;
}

// Track which credentials have already emitted startup signals this process.
const lifecycleSent = new Set();

/**
 * Emit startup telemetry for a credential once per process.
 */
export async function ensureCodebuddyStartupTelemetry(provider, accessToken, log) {
  if (!accessToken) return;
  if (lifecycleSent.has(accessToken)) return;
  lifecycleSent.add(accessToken);
  const identity = getCodebuddyIdentity(accessToken);
  // Fire all startup signals concurrently, don't block the caller.
  Promise.all([
    sendCodebuddyLifecycle(provider, accessToken, log),
    fetchCodebuddyAegisWhitelist(provider, identity.uid, log),
  ]).catch(() => {});
}
