# CodeBuddy gateway fingerprint — reverse engineering WorkBuddy.exe

**Date:** 2026-10-22
**Target:** `C:\Users\naufa\AppData\Local\Programs\WorkBuddy\WorkBuddy.exe`
**Product:** WorkBuddy Desktop **5.8.3** (Electron; Tencent)

**Why this document exists:** Tencent's gateway fingerprints every
`POST /v2/chat/completions` request against the client's own header pattern.
Anything that does not look like the official client gets rejected — the
familiar `HTTP 400 code 11128` ("Illegal API invocation from an unapproved
channel") on the CN gateway, and `code 11-128` ("conversation id missing",
「这次调用没通过渠道校验，可能不是官方客户端发出的」) on the international one.

This is the ground truth extracted from the shipping client, the reasoning
behind every header 9router now sends, and a recipe to re-derive it when the
client bumps.

---

## 0. TL;DR

| | Before | After |
|---|---|---|
| `codebuddy-intl` | registry's static headers **only** — no ids, no agent headers, no trace headers | full fingerprint (same as CN) |
| `codebuddy-cn` | ids + `X-Agent-Intent` + `X-Agent-Type` | + `X-Agent-Purpose`, `X-Root-Request-ID`, trace family, client id shapes |
| Id shapes | random UUIDv4 per request, dashed | conversation id dashed UUID (stable), per-turn ids 32-hex (client shape) |
| Client version | 2.156.0 (CN) / 2.133.1 (intl) | 2.172.1 both |
| Body | untouched | `max_tokens`→`max_completion_tokens`, `xhigh`/`max`→`high` |

Implementation: `open-sse/utils/codebuddyGateway.js` (+ both executors).
Changelog entry: `CHANGELOG.md` → "2026-10-22 — CodeBuddy CN/Intl: 1:1 gateway
fingerprint from WorkBuddy.exe".

---

## 1. Target identification

REA opened the PE cleanly:

```json
{"path":"…\\WorkBuddy.exe","format":"pe","kind":"executable",
 "sha256":"5ea5d8ba6f6a435c27c239115647886a9646f76ff5a721e82f84f0ff16ac5e15",
 "architecture":"x86_64"}
```

But the exe is the **Electron bootstrap** — the request logic is not in it.
Everything interesting lives in the sidecar payload:

| Artefact | Size | SHA-256 |
|---|---|---|
| `resources/app.asar` | 92.1 MB | `3e50fcb5b060deba4f1ea9a8c293cf955bf12d7e52d971985de914350afd9077` |
| `app.asar` → `main/server.js` | 3 600 054 B | `cd20c2b45d7cef85e28517b039272d49d7059f9a557633268990b66823e42e1c` |
| `app.asar` → `cli/dist/codebuddy-lite-wb.mjs` | 9 485 196 B | `92899eb4b9d9403a95ceae17dc95e6816bb28dd9fe099790240b5b54d1dac330` |

`resources/app.asar.unpacked/` holds only native bits (`koffi`, `node-pty`,
`TuringShieldSDK.dll`, `perf_metrics.node`) — no JS of interest.

---

## 2. Getting the JS out of `app.asar`

`npx asar extract` aborts partway (an unpacked `koffi.exp` path it cannot
resolve), so `app.asar` was parsed directly. The format is a header pickle:

```
u32 = 4              // size of the size-pickle
u32 headerSize       // header pickle size
u32 headerStringSize // JSON length
u32 ?                // padding
char* headerJson     // the file tree
...file data at 16 + headerSize
```

Extractor used (`extract-asar.mjs`, kept in the RE scratch dir):

```js
import fs from "node:fs";
const buf = fs.readFileSync(archive);
const headerSize = buf.readUInt32LE(12);
const headerJson = buf.subarray(16, 16 + headerSize).toString("utf8");
const tree = JSON.parse(headerJson);
const dataOffset = 16 + headerSize;
const unpackedRoot = archive.replace(/\.asar$/, ".asar.unpacked");
// walk(node.files) → writeFileSync(abs, buf.subarray(dataOffset + node.offset, …))
```

`app.asar` inventory (17 352 entries):

| Top level | Entries | Note |
|---|---|---|
| `node_modules/` | 13 095 | vendored deps |
| `renderer/` | 1 914 | UI assets (Vue bundles) |
| `resources/` | 1 761 | icons, templates |
| `cli/` | **364** | **the CodeBuddy Code CLI** — `bin/`, `dist/`, `builtin/`, `node_modules/` |
| `main/` | **187** | **WorkBuddy Electron main process** — `server.js` (3.6 MB) |
| `native/` | 21 | `turing-sdk`, `perf-metrics`, `wechat-copydata-decoder` |
| `preload/` | 7 | renderer bridge |
| `tencent-docs/` | 2 | shipped docs |

`cli/dist/` holds the bundle plus 40 lazy chunks:

```
cli/dist/codebuddy-lite-wb.mjs            9.5 MB   ← the client
cli/dist/lazy-lite-wb/*.mjs               ~16 MB   ← lazily loaded chunks
```

The `lite-wb` variant is what WorkBuddy ships (`CODEBUDDY_FORCE_LITE_WB_BUNDLE=1`
in `cli/bin/codebuddy`); the plain `codebuddy` / `codebuddy-headless` bundles
exist in the npm package but not here.

---

## 3. Leg A — the CodeBuddy Code CLI

### 3.1 Version

`cli/dist/codebuddy-lite-wb.mjs` @ 4 825 315 embeds its own package manifest:

```json
"publishConfig":{"access":"public","customPackage":{
  "name":"@tencent-ai/codebuddy-code","version":"2.161.0", …}}
```

The npm registry's current `latest` is **2.172.1** (2026-10-22) — that is what
9router advertises; the client bundled in WorkBuddy 5.8.3 is 2.161.0.

### 3.2 The request builder — `axiosToFetchAdapter` (@ 3 663 311)

```js
let N = this.sessionManager.getCurrent() || this.sessionManager.sessionSubject.getValue();
let U = F?.messageId ?? (0, mr.nH)().replace(/-/g, ""),      // message id
    B = F?.conversationRequestId : (0, g9.x8w)(N);
M[yc.CONVERSATION_ID_HEADER] = N.id;                          // X-Conversation-ID
M[yc.CONVERSATION_REQUEST_ID_HEADER] = B || "";               // X-Conversation-Request-ID
M[yc.CONVERSATION_MESSAGE_ID_HEADER] = N.messageId;           // X-Conversation-Message-ID
M[yc.REQUEST_ID_HEADER] = N.messageId;                        // X-Request-ID (alias)
M[yc.AGENT_INTENT] = N.meta?.["codebuddy.ai/mode"] ?? "craft";// X-Agent-Intent
process.env.PERSONAL_AGENT_ROLE
  ? M[yc.AGENT_PURPOSE] = "person_agent"
  : W && (M[yc.AGENT_PURPOSE] = W);                           // X-Agent-Purpose
M[yc.IDE_TYPE_HEADER]  = q?.ideType  || s || OO.Vo;
M[yc.IDE_NAME_HEADER]  = q?.ideName  || c || "";
M[yc.IDE_VERSION_HEADER] = q?.ideVersion || p || "0.0.0";
```

then, further down the same function:

```js
M[yc.REQUEST_ID_HEADER] = U;                                   // re-stamped, same value
M[yc.CONVERSATION_MESSAGE_ID_HEADER] = U;
M[yc.CONVERSATION_REQUEST_ID_HEADER] = B || "";
X  && (M[yc.ROOT_REQUEST_ID_HEADER] = X);                      // X-Root-Request-ID
ee && (M[yc.PARENT_CONVERSATION_ID_HEADER] = ee);              // X-Parent-Conversation-ID
M[yc.AGENT_TYPE_HEADER] = F?.agentType ?? (0, g9.ztP)(N);      // X-Agent-Type
this.applyCompactionHeaders(M, F?.compaction);                 // X-Compaction / X-Context-Compacted
```

**`X-Request-ID` aliases `X-Conversation-Message-ID`** — that pairing is on the
wire, not an invention.

The header constants themselves live at @ 8 459 195:

```js
i.TRACE_ID_HEADER="X-Trace-ID", i.REQUEST_ID_HEADER="X-Request-ID",
i.ROOT_REQUEST_ID_HEADER="X-Root-Request-ID",
i.PARENT_CONVERSATION_ID_HEADER="X-Parent-Conversation-ID",
i.AGENT_TYPE_HEADER="X-Agent-Type", i.COMPACTION_HEADER="X-Compaction",
i.CONTEXT_COMPACTED_HEADER="X-Context-Compacted",
i.CONVERSATION_ID_HEADER="X-Conversation-ID", i.SESSION_ID_HEADER="X-Session-ID",
i.CONVERSATION_REQUEST_ID_HEADER="X-Conversation-Request-ID",
i.CONVERSATION_MESSAGE_ID_HEADER="X-Conversation-Message-ID",
i.AGENT_INTENT="X-Agent-Intent", i.PRODUCT="X-Product",
i.IDE_TYPE_HEADER="X-IDE-Type", i.IDE_NAME_HEADER="X-IDE-Name",
i.IDE_VERSION_HEADER="X-IDE-Version", i.API_KEY_HEADER="X-API-Key",
i.PRODUCT_VERSION_HEADER="X-Product-Version", i.USER_ID_HEADER="X-User-Id",
i.PRIVATE_DATA_HEADER="X-Private-Data", i.DATA_TAG_HEADER="X-Data-Tag",
i.MODEL_ID_HEADER="X-Model-ID", i.AGENT_PURPOSE="X-Agent-Purpose"
```

### 3.3 `X-Private-Data` semantics — `getCustomHeaders` (@ 3 668 705)

```js
let p = await this.settingsManager.get("enableModelOptimization");
let h = p?.enabled !== false;                                  // default: true
c[yc.PRIVATE_DATA_HEADER] = h ? "false" : "true";
```

So the CLI sends **`X-Private-Data: false`** while model optimisation is on
(the default) and `"true"` when it is off. WorkBuddy's desktop leg always sends
`"true"` — see §4.

### 3.4 Account headers — `runIdentityHeaders` (module 30876 @ 1 300 364)

```js
function runIdentityHeaders() {
  let t = resolveRunIdentity(); if (!t) return {};
  let { auth: i, account: n } = t, c = {};
  n?.uid         && (c[s.HTTP_HEADER_USER_ID] = n.uid);          // X-User-Id
  n?.enterpriseId&& (c[s.HTTP_HEADER_ENTERPRISE_ID] = n.enterpriseId);
  i?.method      && (c[s.HTTP_HEADER_AUTH_METHOD] = i.method);    // X-Auth-Method
  n?.idSource    && (c[s.HTTP_HEADER_ID_SOURCE] = n.idSource);    // X-Id-Source
  if (n?.uid && (n.enterpriseId || n.idSource || i?.method)) {
    let t = { uin: n.uid };
    n.enterpriseId && (t.owner_uin = n.enterpriseId);
    n.idSource      && (t.id_source = n.idSource);
    i?.method       && (t.token_source = i.method);
    c[s.HTTP_HEADER_USERINFO] = Buffer.from(JSON.stringify(t), "utf-8").toString("base64");
  }
  return { ...c, ...t.headers };
}
```

### 3.5 User-Agent — `buildUserAgent` (@ 8 610 300)

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

→ `<platform>/<platformVersion> <applicationName>/<productVersion> [extension]`

The WorkBuddy host injects `CLI/<bundledCliVersion>` as the extension, which
is why the desktop app's UA carries a third segment:
`WorkBuddy/5.8.3 workbuddy/5.8.3 CLI/2.161.0`.

The companion product segment comes from `buildAsciiSafeProductSegment`:
`productNameEn || applicationName || productName`.

### 3.6 The id shapes

* Session id → `generateUUUID()` (module 37638 @ 111 912): RFC 4122 v4, dashed.
* Message id → `randomUUID().replace(/-/g, "")` → **32 hex, no dashes**.
* The desktop client's request/message ids are UUID**v7** (48-bit ms prefix
  first), dashed; dropping the dashes yields the 32-hex form the gateway
  carries. (Upstream PR #4949 captured this on the wire.)

### 3.7 The request-pipeline body rules (@ 3 748 256)

These run on every model request, before dispatch. Only the ones that can
apply to CodeBuddy (no server capability map carried by 9router) matter:

| Rule | Match | Effect |
|---|---|---|
| `SdkFieldCleanupRule` | always | `delete verbosity; delete reasoning_summary` |
| `MaxTokensFieldRule` | `!!modelId` | `max_tokens` → `max_completion_tokens` when `caps.maxTokensField === "max_completion_tokens"` **or** model id starts with `o1`/`o3`/`o4`/`gpt-4.1`/`gpt-5` |
| `ReasoningEffortSupportRule` | `caps.supportsReasoningEffort === false` | drop `reasoning_effort` and `reasoning.effort` |
| `ThinkingEffortTranslatorRule` | `caps.thinkingLevelMap` | clamp `reasoning_effort` into `["off","minimal","low","medium","high","xhigh","max"]`; `"off"` → delete |
| `LegacyXhighFallbackRule` | **no** `thinkingLevelMap` | `xhigh`/`max` → `high` |
| `ThinkingFormatTranslatorRule` | `caps.thinkingFormat !== "openai"` | CodeBuddy is `"openai"`, so it never fires |
| `ReasoningContentBackfillRule` | model-cap driven | backfill `reasoning_content` on assistant turns |
| `ToolResultNameRule` | `caps.requiresToolResultName` | add `name` to tool messages |
| `TemperatureSupportRule` | `caps.supportsTemperature === false` | drop `temperature` |
| `ResponsesNativeChatCompletionsFallbackRule` | OpenAI-Responses APIs | n/a |

The reasoning-summary injection happens later, in the adapter:

```js
async injectReasoningSummaryIfNeeded(t, i) {
  return !(!(await this.enableThinking(i)
                || "string" == typeof t?.reasoning_effort
                || "string" == typeof t?.reasoning?.effort)
             || t?.reasoning_summary)
         && (t.reasoning_summary = "auto", !0);
}
```

→ `reasoning_summary: "auto"` is added when the session has thinking enabled
**or** the caller already sent a reasoning effort. `SdkFieldCleanupRule` having
deleted it earlier is what makes this re-add meaningful.

### 3.8 Auth endpoints (CLI)

```
POST /v2{prefixPath}/auth/state?platform={platform}
GET  /v2{prefixPath}/auth/token?state={state}
POST /v2{prefixPath}/auth/token/refresh        # X-Refresh-Token + X-Auth-Refresh-Source: plugin
```

`prefixPath` = `productConfig.authentication.attributes.prefixPath` (default
`/plugin`), `platform` = `authentication.attributes.platform ?? platform`.
State/token requests carry `X-No-Authorization`, `X-No-User-Id`,
`X-No-Enterprise-Id`, `X-No-Department-Info: "true"`.

### 3.9 Refresh-token lifecycle — what the client does

Worth spelling out because 9router mirrors it (`open-sse/services/tokenRefresh/providers.js`):

**Request shape** (`refreshSession`, @ 7 064 026):

```js
this.restOperations.post(`/v2${this.prefixPath}/auth/token/refresh`, {}, {
  headers: { ...this.enterpriseHeaders(t.auth),        // X-Domain: auth.domain || authority(endpoint)
             "X-Refresh-Token": t.auth.refreshToken,
             "X-Auth-Refresh-Source": "plugin",
             ...i.traceSpan.requestHeaders },
});
```

The refresh token travels in a **header**, never in the body (`{}`), and the
response replaces the whole `auth` object — so a rotated `refreshToken` wins and
an omitted one keeps the current value.

**Expiry bookkeeping** (`calculateExpiresAt`):

```js
!t.expiresAt        && t.expiresIn        && (t.expiresAt = Date.now() + 1e3 * t.expiresIn);
!t.refreshExpiresAt && t.refreshExpiresIn && (t.refreshExpiresAt = Date.now() + 1e3 * t.refreshExpiresIn);
```

Two independent clocks: the access token and the refresh token.

**When it refreshes** (`scheduleRefreshSession`, @ 7 097 919):

```js
let i = 864e5 + rand(0..60000) - 300000;            // ~24h − 5min ±1min
if (expiresAt - 864e5 < Date.now()) i = 300000 + rand(0..60000);  // short-lived token → ~5min
let delay = Math.max(lastRefreshTime + i - Date.now(), 15000);    // MIN_REFRESH_DELAY_MS
```

plus re-entry guards: `REFRESH_ATTEMPT_COOLDOWN_MS = 30 s`, and on a transient
failure a retry at `5s · 2^n` capped at 60 s.

**Failure semantics.** `isAuthenticationInvalidError` = HTTP 401/403 from the
refresh endpoint → `UnauthorizedError`, which the retry loop treats as final
(`t = n instanceof F.UnauthorizedError; t || !(i > 0) || this.loggedOut || (retry…)`).
A dead refresh token ends the session; it is never retried blindly.

**What Tencent actually returns for a dead token** (probed 2026-10-22 against
`https://copilot.tencent.com/v2/plugin/auth/token/refresh`):

```http
HTTP/1.1 401
{"code":12153,"msg":"12153:refresh token failed:10000:token format error","requestId":"…"}
```

Identical with `X-Domain: copilot.tencent.com` and `X-Domain: www.codebuddy.cn`,
so the domain header is not what gates the refresh.

---

## 4. Leg B — WorkBuddy's own upstream leg (`main/server.js` @ 3 513 000)

WorkBuddy runs the CLI as a sidecar and proxies its chat traffic through a
loopback `VlmProxy`, stamping its own identity on the way out.

### 4.1 `buildVlmGatewayHeaders`

```js
function buildVlmGatewayHeaders(e) {
  let n = {}, r = e.appVersion?.trim() || "0.0.0", i = e.cliVersion?.trim();
  e.userId?.trim() && (n["X-User-Id"] = e.userId.trim());
  e.enterpriseId?.trim() && (n["X-Enterprise-Id"] = e.enterpriseId.trim(),
                             n["X-Tenant-Id"] = e.enterpriseId.trim());
  e.domain?.trim() && (n["X-Domain"] = e.domain.trim());
  n["X-Product"]       = e.deploymentType?.trim() || "SaaS";
  n["X-IDE-Type"]      = "WorkBuddy";
  n["X-IDE-Name"]      = "WorkBuddy";
  n["X-IDE-Version"]   = r;
  n["X-Private-Data"]  = "true";
  n["User-Agent"]      = [`WorkBuddy/${r}`, `WorkBuddy/${r}`,
                           ...i ? [`CLI/${i}`] : []].join(" ");
  return n;
}
```

### 4.2 `applyGatewayHeaders`

```js
function applyGatewayHeaders(e, n, r) {
  e.set("Accept", "application/json");
  e.set("Content-Type", "application/json");
  e.set("x-requested-with", "XMLHttpRequest");
  e.set("X-Conversation-ID", n);
  e.set("X-Conversation-Request-ID", r.conversationRequestId);
  e.set("acp-connection-id", r.acpConnectionId);
  e.set("X-Conversation-Message-ID", (0, W.randomUUID)());
  e.set("X-Request-ID", (0, W.randomUUID)());
  e.set("X-Agent-Intent", "craft");
  e.set("X-Agent-Purpose", "conversation");
  e.set("x-codebuddy-request", "1");
  for (let [n, r] of YN) e.set(n, e.get(n) || r);   // identity defaults
  applyTraceHeaders(e);
}
var YN = [["X-IDE-Type","WorkBuddy"],["X-IDE-Name","WorkBuddy"],
          ["X-IDE-Version","0.0.0"],["X-Private-Data","true"],["X-Product","SaaS"]];
```

### 4.3 `applyTraceHeaders`

```js
function applyTraceHeaders(e) {
  let n = (0, W.randomBytes)(16).toString("hex"),   // trace id
      r = (0, W.randomBytes)(8).toString("hex"),      // span id
      i = (0, W.randomBytes)(8).toString("hex");      // parent span id
  e.set("traceparent", `00-${n}-${r}-01`);
  e.set("b3", `${n}-${r}-1-${i}`);
  e.set("X-B3-TraceId", n);
  e.set("X-B3-ParentSpanId", i);
  e.set("X-B3-SpanId", r);
  e.set("X-B3-Sampled", "1");
  e.set("X-Trace-ID", n);
}
```

The CLI's OTel injection emits the same family but **omits
`X-B3-ParentSpanId` for a root span** and uses a three-segment `b3`
(`<trace>-<span>-1`) — which is the shape captured on the wire.

### 4.4 The upstream hop

```js
var WN = `/v2/chat/completions`,
    GN = `https://copilot.tencent.com/v2/chat/completions`;
…
return applyGatewayHeaders(r, e.sessionId, e.metadata),
       r.set(`Accept-Encoding`, `identity`),
       r.set(`Authorization`, `Bearer ${n}`),
       this.fetchImpl(this.resolveUpstreamUrl(), {
         method:`POST`, redirect:`manual`, headers:r, body:new Uint8Array(e.body), signal:e.signal});
```

Note `redirect: "manual"` and `Accept-Encoding: identity`.

---

## 5. Host / deployment resolution

`main/server.js` @ 1 965 288:

```js
let i = n?.isOversea === true || n?.networkEnvironment === "external";
let a = n?.applicationName?.toLowerCase().includes("codebuddy") === true;
return i
  ? (a ? (r ? "https://staging-codebuddy.tencent.com" : "https://www.codebuddy.ai")
         : (r ? "https://staging.workbuddy.ai" : "https://www.workbuddy.ai"))
  : (r ? "https://staging.workbuddy.cn" : "https://www.workbuddy.cn");
```

CLI CN SaaS origins (module 66784 @ 8 677 552):

| Constant | Value |
|---|---|
| `CN_SAAS_CORE_API_PRIMARY_ORIGIN` | `https://www.workbuddy.cn` |
| `CN_SAAS_CORE_API_ALTERNATE_ORIGIN` | `https://copilot.tencent.com` |
| `CN_SAAS_CORE_API_BACKUP_ORIGIN` | `https://wb.tencentbuddy.com` |
| `CN_SAAS_CORE_API_FRONT_DOORS` | primary + alternate |
| `CN_SAAS_CORE_API_TRUSTED_ORIGINS` | primary + alternate + backup |

### The two international deployments

| Deployment | Site origin | `X-Domain` | `applicationName` | UA |
|---|---|---|---|---|
| China (WorkBuddy) | `www.workbuddy.cn` | `www.workbuddy.cn` | `workbuddy` | `WorkBuddy/<v> workbuddy/<v> CLI/<cli>` |
| China (CodeBuddy CLI) | `copilot.tencent.com` | `www.codebuddy.cn` | `codebuddy` | `CLI/<v> CodeBuddy/<v>` |
| International (CodeBuddy) | `www.codebuddy.ai` | `www.codebuddy.ai` | `codebuddy` | `IDE/<v> CodeBuddy/<v>` |
| International (WorkBuddy AI) | `www.workbuddy.ai` | `www.workbuddy.ai` | `workbuddy-ai` | `WorkBuddy/<v> workbuddy-ai/<v> CLI/<cli>` |

9router's `codebuddy-intl` targets the **international CodeBuddy** deployment
(`www.codebuddy.ai`) — the same host its OAuth flow and
`scripts/refresh-codebuddy-models.mjs` (`GET /v3/config`) already use, and the
host where the model catalog has been observed to return data.

> Upstream PR #4949 moved `codebuddy-intl` to `www.workbuddy.ai` (the
> WorkBuddy AI deployment). That is a **deployment switch, not a header fix**:
> 9router's intl OAuth endpoints and its catalog refresh are bound to
> `www.codebuddy.ai`, and the access token is minted per host. Moving only the
> chat URL would reproduce the very "unapproved channel" failure this work
> fixes.

### Other hosts observed in `main/server.js`

```
https://copilot.tencent.com          https://www.workbuddy.cn
https://www.codebuddy.ai             https://www.workbuddy.ai
https://staging.workbuddy.cn         https://staging.workbuddy.ai
https://staging-codebuddy.tencent.com
https://tencent.sso.codebuddy.cn     https://tencent.staging-sso.codebuddy.cn
https://oauth2.account.tencent.com   https://oauth2.ci-741.account.tencentcs.com
https://download.codebuddy.cn/plugin-marketplace/
https://drive.tencent.com   https://ardot.tencent.com/mcp   https://smh26tqjmz2qlj4i.api.tencentsmh.cn
```

### API surface (`/v2/*` paths found in `main/server.js`)

```
/v2/chat/completions                       ← the chat gateway
/v2/chat/prediction                        ← title prediction
/v2/chat/queue/status  /v2/chat/queue/cancel
/v2/enterprises/personal/models            ← per-account model list
/v2/feature-flag/api   /v2/activity/banner
/v2/msg-center/message  /v2/api-keys  /v2/enterprises
/v2/as/conversations/…   /v2/as/connector/…   /v2/as/netdisk/upload
/v2/as/scheduler/tasks   /v2/as/inspiration/code/{encode,decode}
/v2/user/cloudagent/{agents,instances,tasks,quota,…}
```

Plus, from the CLI side: `/v2/plugin/auth/{state,token,token/refresh}`,
`/v2/report` (telemetry), `/v3/config` (catalog),
`/v2/billing/meter/get-user-resource` (quota).

---

## 6. The resulting wire spec

| Header | CLI | WorkBuddy desktop | 9router now |
|---|---|---|---|
| `X-Conversation-ID` | session id (dashed UUID) | session id | dashed UUID, stable per conversation |
| `X-Conversation-Request-ID` | per-turn id | per-turn id | 32-hex, per turn |
| `X-Root-Request-ID` | session `meta.rootRequestId` | — | same value as `X-Conversation-Request-ID` |
| `X-Conversation-Message-ID` | message id (32 hex) | random UUID | 32-hex, per turn |
| `X-Request-ID` | **= message id** | random UUID | **= message id** |
| `X-Parent-Conversation-ID` | session `meta.parentConversationId` | — | when the caller supplies it |
| `X-Agent-Intent` | `mode ?? "craft"` | `"craft"` | `"craft"` |
| `X-Agent-Purpose` | session `agentPurpose` | `"conversation"` | `"conversation"` |
| `X-Agent-Type` | `main`/`subagent`/`team` | — | `"main"` |
| `X-Product` | `SaaS` | `deploymentType ?? "SaaS"` | `SaaS` |
| `X-Product-Version` | product version | — | client version |
| `X-IDE-Type` / `X-IDE-Name` | platform | `WorkBuddy` | `CLI` / `IDE` (profile-dependent) |
| `X-IDE-Version` | platform version | app version | client version |
| `X-Private-Data` | `"false"` (optimisation on) | `"true"` | `"false"` (profile-dependent) |
| `User-Agent` | `buildUserAgent` | `WorkBuddy/… CLI/…` | `buildUserAgent` (profile-dependent) |
| `X-Domain` | login domain | login domain | registry value |
| `X-User-Id` / `X-Enterprise-Id` / `X-Tenant-Id` / `X-Userinfo` | account | account | — (not implemented) |
| `traceparent` / `b3` / `X-B3-*` / `X-Trace-ID` | OTel root span | 4-segment `b3` | root span, 3-segment `b3` |
| `x-requested-with` | `XMLHttpRequest` | `XMLHttpRequest` | `XMLHttpRequest` |
| `x-codebuddy-request` | `1` | `1` | `1` |
| `acp-connection-id` | — | ACP connection id | — (ACP-only) |

Not implemented (and why): the account headers (`X-User-Id` etc.) need the
account snapshot the OAuth flow does not persist; `acp-connection-id` is
meaningless outside an ACP session; `X-Userinfo` is base64 of an account
descriptor that only the real client has.

---

## 7. Mapping to 9router

**`open-sse/utils/codebuddyGateway.js` (new)** — one source of truth:

| Export | Purpose |
|---|---|
| `CODEBUDDY_CLIENT_PROFILES` | `cli` / `ide` / `workbuddy` identity blocks |
| `buildCodeBuddyUserAgent(profile)` | the client's UA template |
| `codebuddyUuid7()` / `codebuddyHexId()` | dashed UUIDv7 and its 32-hex form |
| `buildCodeBuddyTraceHeaders()` | W3C + B3 family |
| `buildCodeBuddyGatewayHeaders({…})` | conversation + agent header set |
| `applyCodeBuddyRequestHeaders(headers, {…})` | stamps the family, honours a caller-supplied `X-Conversation-ID`, derives a stable conversation id otherwise |
| `applyCodeBuddyBodyRules(body, model)` | `max_tokens` rename, `xhigh`/`max` collapse |

**Executors** — `codebuddy-cn` and `codebuddy-intl` now emit the same family.
The international executor previously sent the registry's static headers only.

**Registries** — client version `2.156.0` → `2.172.1` (intl was on `2.133.1`);
`X-Product-Version` and `X-Private-Data` moved into the static identity block.

**`CODEBUDDY_CLIENT=cli|ide|workbuddy`** swaps the whole identity block
atomically (User-Agent, `X-IDE-*`, `X-Product-Version`, `X-Private-Data`).
The upstream binds the access token to the platform it was minted for, so the
profile must match the credential — pairing a CLI-scoped token with
`X-IDE-Type: WorkBuddy` is exactly the "unapproved channel" shape the CN WAF
rejects with code 11128. Unset keeps the registry's own identity.

---

## 8. Token refresh in 9router

Implementation: `open-sse/services/tokenRefresh/providers.js`
(`refreshCodebuddyProvider`), `open-sse/services/oauthCredentialManager.js`
(`isRefreshTokenExpired`), `src/sse/services/tokenRefresh.js` (app-side guard and
persistence).

| Concern | Client (§3.9) | 9router |
|---|---|---|
| Token transport | `X-Refresh-Token` header, body `{}` | same |
| Refresh source marker | `X-Auth-Refresh-Source: plugin` | same |
| `X-Domain` | `auth.domain` | fixed per deployment (`copilot.tencent.com` / `www.codebuddy.ai`) — probed equivalent |
| `Authorization` | current access token | same |
| Rotation | response replaces `auth` wholesale | `data.refreshToken \|\| current` |
| Access-token clock | `expiresIn` → `expiresAt` | same |
| Refresh-token clock | `refreshExpiresIn` → `refreshExpiresAt` | same, stored as `providerSpecificData.refreshExpiresAt` |
| Dead token | 401/403 → `UnauthorizedError`, no retry | 401/403 or body `12153`/`token format error` → `{ error: "invalid_grant" }` (unrecoverable) |
| Transient failure | retry `5s·2^n` ≤ 60 s | `null` (retried on the next request; `dedupRefresh` collapses bursts within 10 s) |
| Refresh timing | timer ≈ 24 h − 5 min, or ≈ 5 min for short-lived tokens, min 15 s | 5 min before `expiresAt` (`TOKEN_EXPIRY_BUFFER_MS`), or after a chat 401 |

A connection whose refresh token is past `refreshExpiresAt` is reported as
needing a fresh login instead of being exchanged.

### Entering the pair by hand

The OAuth flow stores `accessToken` + `refreshToken` via `mapTokens`
(`src/lib/oauth/providers/codebuddy-*.js`). Without login, `POST /api/providers`
now accepts the same pair for `codebuddy-cn` / `codebuddy-intl`:

```json
{
  "provider": "codebuddy-cn",
  "name": "my-cbcn",
  "accessToken": "<access_token>",
  "refreshToken": "<refresh_token>",
  "expiresIn": 86400
}
```

It is stored as an `oauth` connection, which is the only shape the refresh path
reads (`getAccessToken` bails out without `credentials.refreshToken`). Sending
only `apiKey` keeps the old behaviour — a static key that cannot renew.

> Note: `refresh_token` is the credential that matters. An access token entered
> alone is valid only until it expires.

### Surfacing the state in the dashboard

`POST /api/providers/[id]/test` for these two providers exchanges the refresh
token and returns `tokenState` (`accessToken` / `refreshToken` ∈
`alive | expired | revoked | missing | unverified`). The connection row renders a
badge — *no refresh token*, *refresh ok · \<date\>*, *refresh expired \<date\>* —
and the connection payload exposes `hasRefreshToken` / `hasAccessToken` booleans
(the tokens themselves never leave the server).

---

## 9. Upstream PR survey (`decolua/9router`, last two weeks)

| PR | State | Title | Verdict |
|---|---|---|---|
| **#4949** | open | `fix(codebuddy-intl): 对齐 WorkBuddy AI 国际版出站身份，补会话头族（面向 11-128 渠道校验）` | **Adopted** — the header family and id shapes. Independently reached the same conclusions from a mitmproxy capture of WorkBuddy AI 5.8.4 (UUIDv7 ids, 32-hex per-turn ids, `X-Root-Request-ID` aliasing `X-Conversation-Request-ID`, `WorkBuddy/5.8.4 workbuddy-ai/5.8.4 CLI/2.161.0` UA). Its *host* change was **not** adopted (§5). |
| **#5086** | open | `fix(codebuddy): preserve explicit conversation identity and turn metadata` | **Adopted (concept)** — a caller-supplied `X-Conversation-ID` is preserved verbatim; otherwise a stable id is derived. The fork already ships `open-sse/utils/sessionManager.js` with `resolveSessionIdentity` / `resolveContinuationId`. |
| **#5032** | open | `fix(codebuddy): resolve HTTP 400 (code 11128 "request illegal")` | **Not adopted** — pins the older `2.108.1` client, narrows the agent-prompt filter, and adds `X-Stainless-*` headers. Those come from the OpenAI SDK, but the CLI uses axios — they are not on the wire. It also merges the intl executor into the CN one, dropping intl-specific normalisation. |
| #5102 | closed | `fix(codebuddy): back off blocked international connections` | Not adopted (closed unmerged, no header work). |
| #5023 | closed | `feat(codebuddy): add conversation headers and CLI identity` | Superseded by #4949 / #5086. |

Upstream `master` (v0.5.104) itself has **no** per-request CodeBuddy identity
headers at all — `open-sse/executors/codebuddy-cn.js` there has no
`buildHeaders` override — so the fork's layer is still required.

---

## 10. How to re-verify

The client bumps roughly weekly; when the fingerprint needs a refresh, re-run
the three steps below against a fresh install of WorkBuddy.

### 10.1 Two helpers (plain Node, no dependencies)

Minified bundles are single-line, so `grep` truncates and `read` cannot show
them. These two throwaway helpers make the bundles readable; they live in the
local scratch dir (`.work/`, gitignored) — copy them verbatim.

**`ctx.mjs`** — regex search with a character window around every hit:

```js
// usage: node ctx.mjs <file> <regex> [radius=600] [maxHits=20]
import fs from "node:fs";
const [, , file, pattern, radiusArg, maxArg] = process.argv;
const radius = Number(radiusArg || 600);
const maxHits = Number(maxArg || 20);
const re = new RegExp(pattern, "g");
const text = fs.readFileSync(file, "utf8");
let m, i = 0;
while ((m = re.exec(text)) !== null && i < maxHits) {
  const start = Math.max(0, m.index - radius);
  const end = Math.min(text.length, m.index + m[0].length + radius);
  console.log(`\n===== hit ${++i} @ ${m.index} (len ${m[0].length}) =====`);
  console.log(text.slice(start, end).replace(/\n/g, "\\n"));
  if (m.index === re.lastIndex) re.lastIndex++;
}
```

**`fmt.mjs`** — re-flow a character range into readable lines:

```js
// usage: node fmt.mjs <file> <start> <end> [outFile] [width=160]
import fs from "node:fs";
const [, , file, s, e, outFile, widthArg] = process.argv;
const width = Number(widthArg || 160);
const text = fs.readFileSync(file, "utf8").slice(Number(s), Number(e));
const out = [];
let i = 0;
while (i < text.length) {
  let cut = width;
  if (i + width < text.length) {
    const b = Math.max(text.lastIndexOf("; ", i + width) - i,
                       text.lastIndexOf(";`", i + width) - i);
    if (b > width * 0.4) cut = b + 1;
  }
  out.push(text.slice(i, i + cut).trimEnd());
  i += cut;
}
const body = out.join("\n");
if (outFile) { fs.writeFileSync(outFile, body); console.log(`wrote ${out.length} lines -> ${outFile}`); }
else console.log(body);
```

### 10.2 The three extraction steps

```bash
# 1. extract the two JS files (extractor source in §2)
node extract-asar.mjs \
  "C:/Users/naufa/AppData/Local/Programs/WorkBuddy/resources/app.asar" \
  ./asar main cli

# 2. read the CLI's request builder
node ctx.mjs asar/cli/dist/codebuddy-lite-wb.mjs "axiosToFetchAdapter" 900 2
node ctx.mjs asar/cli/dist/codebuddy-lite-wb.mjs "X-Agent-Purpose" 700 2
node ctx.mjs asar/cli/dist/codebuddy-lite-wb.mjs "buildUserAgent" 700 2

# 3. read WorkBuddy's upstream leg
node ctx.mjs asar/main/server.js "applyGatewayHeaders" 700 2
node ctx.mjs asar/main/server.js "applyTraceHeaders" 600 2

# 4. re-flow a region into readable lines
node fmt.mjs asar/main/server.js 3513000 3522000 wb-gateway.txt
```

Version bumps to watch: `npm view @tencent-ai/codebuddy-code version` (the
advertised version) and the embedded `"version":"2.x.y"` in the bundle's own
package manifest (the version WorkBuddy actually ships).

---

## 11. Verification status

| Check | Result |
|---|---|
| `tests/unit/codebuddy-cn-waf-headers.test.js` | updated, green |
| `tests/unit/codebuddy-intl-gateway-headers.test.js` | new, green |
| `tests/unit/codebuddy-body-rules.test.js` | new, green |
| `tests/__baseline__/verify-providers.mjs` | ✅ (baseline re-pinned) |
| `tests/__baseline__/verify-oauth-urls.mjs` | ✅ unchanged |
| `tests/__baseline__/verify-alias.mjs` | ⚠️ fails **at pristine `HEAD` too** — stale alias snapshot, `providerModels.js` untouched by this work |
| Full suite vs known-fails | ✅ 0 regressions (68 known failures before the upstream merge, 56 after) |
| Live upstream probe | **not run** — no CodeBuddy credential in the local 9router store |

The header names, id shapes, User-Agent template and body rules are extracted
from the shipping client. The *acceptance* of the new international
fingerprint against the live `www.codebuddy.ai` gateway is **not** verified
here — that needs a credential and a live probe
(`scripts/verify-codebuddy-tools.mjs` drives the same path end-to-end).
