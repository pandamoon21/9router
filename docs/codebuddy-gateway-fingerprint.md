# CodeBuddy gateway fingerprint — 1:1 with the real client

**Date:** 2026-10-22
**Target analysed:** `C:\Users\naufa\AppData\Local\Programs\WorkBuddy\WorkBuddy.exe`
(WorkBuddy Desktop **5.8.3**, Electron; `resources/app.asar` = 92 MB)

**Goal:** make 9router's `codebuddy-cn` / `codebuddy-intl` requests byte-shaped
like the client that Tencent's gateway actually fingerprints.

---

## 1. Where the ground truth lives

WorkBuddy.exe is the Electron bootstrap; the request logic is in the embedded
CodeBuddy Code CLI and in WorkBuddy's own main process. Both are inside
`resources/app.asar`:

| Path in `app.asar` | What it is | Why it matters |
|---|---|---|
| `app/cli/dist/codebuddy-lite-wb.mjs` (9.5 MB) | CodeBuddy Code CLI bundle (`@tencent-ai/codebuddy-code` **2.161.0**) | Builds the **CLI's own** upstream request to the gateway |
| `app/main/server.js` (3.6 MB) | WorkBuddy Electron main process | Builds the **desktop app's** upstream request to the gateway |

Extraction (asar header pickle parse, no `npx asar` needed — `npx asar extract`
aborts on an unpacked `koffi` path):

```bash
node .work/wb-re/extract-asar.mjs "<install>/resources/app.asar" ./asar main preload renderer
```

---

## 2. The CLI's request builder (`axiosToFetchAdapter`)

`app/cli/dist/codebuddy-lite-wb.mjs` → `axiosToFetchAdapter` sets, per request:

```js
M[yc.CONVERSATION_ID_HEADER] = N.id;              // X-Conversation-ID  (session id)
M[yc.CONVERSATION_REQUEST_ID_HEADER] = B || "";    // X-Conversation-Request-ID
M[yc.CONVERSATION_MESSAGE_ID_HEADER] = N.messageId;// X-Conversation-Message-ID
M[yc.REQUEST_ID_HEADER] = N.messageId;             // X-Request-ID  (aliases the message id)
M[yc.AGENT_INTENT] = N.meta?.["codebuddy.ai/mode"] ?? "craft";   // X-Agent-Intent
M[yc.AGENT_PURPOSE] = …;                           // X-Agent-Purpose
M[yc.IDE_TYPE_HEADER] = …; M[yc.IDE_NAME_HEADER] = …; M[yc.IDE_VERSION_HEADER] = …;
M[yc.AGENT_TYPE_HEADER] = F?.agentType ?? resolveAgentType(N);   // X-Agent-Type
```

and, in `getCustomHeaders`:

```js
c[yc.PRIVATE_DATA_HEADER] = h ? "false" : "true";  // X-Private-Data (enableModelOptimization)
```

The message id fallback is `randomUUID().replace(/-/g, "")` — **32 hex, no
dashes**. The trace family is injected by the OTel span hook
(`injectOtelSpanHeaders`): `traceparent`, `b3`, `X-B3-TraceId`, `X-B3-SpanId`,
`X-B3-Sampled`, `X-Trace-ID` — and `X-B3-ParentSpanId` **only** when the span
has a parent (a root request omits it).

### User-Agent template (`buildUserAgent`)

```js
async buildUserAgent(t = "") {
  let i = t ? [t] : [];
  let n = await this.clientInfoProvider.get() || {};
  let s = n.applicationName || n.productName;
  if (s) i.unshift(`${s}/${n.productVersion || "unknown"}`);
  if (n.platform) i.unshift(`${n.platform}/${n.platformVersion || "unknown"}`);
  if (n.userAgentExtension) i.push(n.userAgentExtension);
  return i.join(" ");
}
```

→ `<platform>/<platformVersion> <applicationName>/<productVersion> [extension]`.

---

## 3. WorkBuddy's own upstream leg (`app/main/server.js`)

```js
function buildVlmGatewayHeaders(e) {
  …
  n["X-Product"] = e.deploymentType?.trim() || "SaaS";
  n["X-IDE-Type"] = "WorkBuddy";
  n["X-IDE-Name"] = "WorkBuddy";
  n["X-IDE-Version"] = r;                      // app version
  n["X-Private-Data"] = "true";
  n["User-Agent"] = [`WorkBuddy/${r}`, `WorkBuddy/${r}`, ...i ? [`CLI/${i}`] : []].join(" ");
}

function applyGatewayHeaders(e, n, r) {
  e.set("Accept", "application/json");
  e.set("Content-Type", "application/json");
  e.set("x-requested-with", "XMLHttpRequest");
  e.set("X-Conversation-ID", n);
  e.set("X-Conversation-Request-ID", r.conversationRequestId);
  e.set("acp-connection-id", r.acpConnectionId);
  e.set("X-Conversation-Message-ID", randomUUID());
  e.set("X-Request-ID", randomUUID());
  e.set("X-Agent-Intent", "craft");
  e.set("X-Agent-Purpose", "conversation");
  e.set("x-codebuddy-request", "1");
  for (let [n, r] of YN) e.set(n, e.get(n) || r);
  applyTraceHeaders(e);
}
```

`applyTraceHeaders` emits `traceparent`, `b3`, `X-B3-TraceId`,
`X-B3-ParentSpanId`, `X-B3-SpanId`, `X-B3-Sampled`, `X-Trace-ID`.

Upstream URL: `https://copilot.tencent.com/v2/chat/completions`
(`WN = "/v2/chat/completions"`, `GN = "https://copilot.tencent.com/v2/chat/completions"`).

---

## 4. Deployment / host resolution

`app/main/server.js`:

```js
let i = n?.isOversea === true || n?.networkEnvironment === "external";
let a = n?.applicationName?.toLowerCase().includes("codebuddy") === true;
return i
  ? (a ? (r ? "https://staging-codebuddy.tencent.com" : "https://www.codebuddy.ai")
         : (r ? "https://staging.workbuddy.ai" : "https://www.workbuddy.ai"))
  : (r ? "https://staging.workbuddy.cn" : "https://www.workbuddy.cn");
```

CLI CN SaaS origins (`CN_SAAS_CORE_API_*`):

| Constant | Value |
|---|---|
| `CN_SAAS_CORE_API_PRIMARY_ORIGIN` | `https://www.workbuddy.cn` |
| `CN_SAAS_CORE_API_ALTERNATE_ORIGIN` | `https://copilot.tencent.com` |
| `CN_SAAS_CORE_API_BACKUP_ORIGIN` | `https://wb.tencentbuddy.com` |

So there are **two** international deployments:

| Deployment | Site | `X-Domain` | Product name |
|---|---|---|---|
| CodeBuddy international | `www.codebuddy.ai` | `www.codebuddy.ai` | `codebuddy` |
| WorkBuddy AI international | `www.workbuddy.ai` | `www.workbuddy.ai` | `workbuddy-ai` |

9router's `codebuddy-intl` uses the **CodeBuddy international** deployment
(`www.codebuddy.ai`) — the same host its OAuth flow and
`scripts/refresh-codebuddy-models.mjs` (`/v3/config`) already use and where the
catalog has been observed to return models.

### Auth endpoints (CLI)

```
POST /v2{prefixPath}/auth/state?platform={platform}      # prefixPath = "/plugin"
GET  /v2{prefixPath}/auth/token?state={state}
POST /v2{prefixPath}/auth/token/refresh                  # X-Refresh-Token + X-Auth-Refresh-Source: plugin
```

---

## 5. Upstream PR survey (decolua/9router, last two weeks)

| PR | State | Title | Verdict |
|---|---|---|---|
| **#4949** | open | `fix(codebuddy-intl): 对齐 WorkBuddy AI 国际版出站身份，补会话头族（面向 11-128 渠道校验）` | **Adopted (header family + id shapes).** Independently reached the same conclusions from a mitmproxy capture of WorkBuddy AI 5.8.4. Its *host* change (`www.codebuddy.ai` → `www.workbuddy.ai`) is **not** adopted: 9router's intl OAuth + catalog refresh are bound to `www.codebuddy.ai`. |
| **#5086** | open | `fix(codebuddy): preserve explicit conversation identity and turn metadata` | **Adopted (concept).** Caller-supplied `X-Conversation-ID` is preserved verbatim; otherwise a stable id is derived from the caller's session id. The fork already ships `open-sse/utils/sessionManager.js` with `resolveSessionIdentity` / `resolveContinuationId`. |
| **#5032** | open | `fix(codebuddy): resolve HTTP 400 (code 11128 …)` | **Not adopted.** Pins the *older* `2.108.1` client version, narrows the agent-prompt filter, and adds `X-Stainless-*` headers — those come from the OpenAI SDK, but the CLI uses axios, so they are not on the wire. |
| #5102 | closed | `fix(codebuddy): back off blocked international connections` | Not adopted (closed unmerged; no header work). |
| #5023 | closed | `feat(codebuddy): add conversation headers and CLI identity` | Superseded by #4949/#5086. |

Upstream `master` (v0.5.104) itself has **no** per-request CodeBuddy identity
headers at all — `open-sse/executors/codebuddy-cn.js` there has no
`buildHeaders` override — so the fork's layer is still needed.

---

## 6. What changed in 9router

### New: `open-sse/utils/codebuddyGateway.js`

Single source of truth for the fingerprint:

* `CODEBUDDY_CLIENT_PROFILES` — `cli` / `ide` / `workbuddy` identity blocks.
* `buildCodeBuddyUserAgent(profile)` — the client's UA template.
* `codebuddyUuid7()` / `codebuddyHexId()` — dashed UUIDv7 and its 32-hex form.
* `buildCodeBuddyTraceHeaders()` — W3C + B3 family.
* `buildCodeBuddyGatewayHeaders({…})` — the conversation + agent header set.
* `applyCodeBuddyRequestHeaders(headers, {…})` — stamps the family, honours a
  caller-supplied `X-Conversation-ID`, and derives a stable conversation id
  otherwise.
* `applyCodeBuddyBodyRules(body, model)` — `max_tokens` →
  `max_completion_tokens` for `o1/o3/o4/gpt-4.1/gpt-5*`, and `xhigh`/`max` →
  `high`.

### Executors

`codebuddy-cn` and `codebuddy-intl` now send the **same** header family.
The international executor previously sent the registry's static headers only —
no conversation ids, no agent headers, no trace headers — which is exactly the
shape the gateway's channel check rejects with **HTTP 400 / code 11-128**
(`conversation id missing`, 「这次调用没通过渠道校验，可能不是官方客户端发出的」).

### Registries

* CLI version `2.156.0` → **2.172.1** (current npm release of
  `@tencent-ai/codebuddy-code`); the international registry was still on
  `2.133.1`.
* `X-Product-Version` and `X-Private-Data` added to both registries' static
  identity block.

### Client profile switch

`CODEBUDDY_CLIENT=cli|ide|workbuddy` swaps the whole identity block
(`User-Agent`, `X-IDE-Type/Name/Version`, `X-Product-Version`,
`X-Private-Data`) atomically. The upstream binds the access token to the
platform it was minted for, so the profile must match the credential —
mixing `X-IDE-Type: WorkBuddy` with a CLI-scoped token is the "unapproved
channel" shape the CN WAF rejects with code 11128.

---

## 7. Verification status

| Check | Result |
|---|---|
| `tests/unit/codebuddy-cn-waf-headers.test.js` | updated, green |
| `tests/unit/codebuddy-intl-gateway-headers.test.js` | new, green |
| `tests/unit/codebuddy-body-rules.test.js` | new, green |
| `tests/__baseline__/verify-providers.mjs` | ✅ (baseline re-pinned) |
| `tests/__baseline__/verify-oauth-urls.mjs` | ✅ unchanged |
| `tests/__baseline__/verify-alias.mjs` | ⚠️ fails **at pristine HEAD too** (stale alias snapshot, `providerModels.js` untouched by this work) |
| Live upstream probe | **not run** — no CodeBuddy credential in the local 9router store |

The id shapes, header names and User-Agent template are extracted from the
shipped client; the *acceptance* of the new international fingerprint against
the live `www.codebuddy.ai` gateway is **not** verified here.
