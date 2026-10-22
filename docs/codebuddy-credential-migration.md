# Migrating CodeBuddy credentials into 9router

**Date:** 2026-10-22
**Context:** moving `codebuddy-cn` / `codebuddy-intl` accounts from a third-party
key-reseller export into a 9router database backup, and deciding which accounts
are actually usable.

> Every credential in this document is redacted. No access token, refresh token,
> API key or account identifier is reproduced here — only shapes, counts and
> outcomes. Do not paste real tokens into documentation.

---

## 1. The input files

| File | Contents |
|---|---|
| 9router DB backup (JSON) | `providerConnections[]` etc. — the accounts as the old instance had them |
| Reseller key export (JSON) | per-account `access_token`, `refresh_token`, `uid`, `identity`, `product_slug` |

The export is **not** a 9router backup: it is a key-vending API response
(`{ keys: [...], total, offset, limit, has_more }`). Its `product_slug` maps to
9router providers as:

| Export slug | 9router provider |
|---|---|
| `codebuddy-cn` | `codebuddy-cn` |
| `codebuddy-ai` | `codebuddy-intl` |

Its `uid` matches the `sub` claim of both JWTs, which is the only reliable join
key — names in the old backup (`Key 8`, `30`, `35-403 req illegal`, …) carry no
mapping.

---

## 2. Why the old rows could not refresh

The legacy backup stored every CodeBuddy account as `authType: "apikey"` with
the **access token** in `apiKey` and no `refreshToken` at all:

```
old row: { authType: "apikey", apiKey: "<access JWT>", refreshToken: undefined }
```

9router only renews a credential when `credentials.refreshToken` exists
(`getAccessToken` returns early otherwise), so these rows could never renew.
Converting them to `oauth` rows with the pair from the export is what makes the
refresh path applicable at all.

**Target shape per account:**

```
provider:      "codebuddy-cn" | "codebuddy-intl"
authType:      "oauth"
accessToken:   <export/rotated access JWT>
refreshToken:  <export/rotated refresh JWT>
expiresAt:     ISO(access JWT `exp`)
providerSpecificData.refreshExpiresAt: ISO(refresh JWT `exp`)
```

---

## 3. Refresh tokens rotate — treat the export as single-use

`POST /v2/plugin/auth/token/refresh` returns a **new refresh token** every time:

```
HTTP 200  {"code":0,"msg":"OK","data":{
  "accessToken":"…","refreshToken":"…",
  "expiresIn":2419200,"refreshExpiresIn":2592000}}
```

Measured on one account: access token `+28 days`, refresh token `+30 days`,
`sub` unchanged, refresh token **rotated**.

Consequences worth planning around:

- The moment one side refreshes, the other side's refresh token is invalidated.
  Two 9router instances sharing one exported refresh token will lock each other
  out — the loser sees `12153 … invalid_grant: Offline user session not found`.
- A reseller export goes stale for every account that was exchanged, so the
  result of a migration must become the new source of truth.
- An access token that still works is **not** proof the refresh token does, and
  vice versa. They have separate lifetimes (`exp` in each JWT) and separate
  liveness.

---

## 4. Two independent liveness checks

Neither check alone answers "can this account serve chat":

| Check | Asks | Misses |
|---|---|---|
| Refresh exchange (`POST …/token/refresh`) | is the session still live? | accounts whose refresh token died but whose access token is still valid |
| Chat probe (`POST /v2/chat/completions`) | will this token actually serve a request? | nothing, but costs a real request |

Run both. In this migration the refresh exchange succeeded for only part of the
set, yet several of the failures still answered chat with 200.

### Probe shapes

Refresh probe:

```
POST https://copilot.tencent.com/v2/plugin/auth/token/refresh
X-Refresh-Token: <refresh>
X-Auth-Refresh-Source: plugin
X-Domain: copilot.tencent.com
Authorization: Bearer <current access>
body: {}
```

Chat probe (one cheap model, `stream: true`, one short message) — must carry the
full gateway fingerprint, otherwise the 403/400 answers mean nothing
(see `docs/codebuddy-gateway-fingerprint.md` for every header):

```
POST https://copilot.tencent.com/v2/chat/completions
Authorization: Bearer <access>
X-Product: SaaS · X-Product-Version: <cli ver> · X-IDE-Type/Name: CLI
X-IDE-Version: <cli ver> · X-Private-Data: false · X-Domain: www.codebuddy.cn
x-requested-with: XMLHttpRequest · x-codebuddy-request: 1
X-Agent-Intent: craft · X-Agent-Purpose: conversation · X-Agent-Type: main
body: {"model":"<model>","messages":[{"role":"user","content":"hi"}],"stream":true}
```

### Interpreting the answers

| Answer | Meaning | Verdict |
|---|---|---|
| `200` + SSE | token serves chat | **usable** |
| `429` / `code 14018` “额度已用尽” | quota exhausted, token valid | **usable** — daily bonus credits refill it |
| `429` / `code 6004` | frequency limit with a reset time | **usable** — temporary |
| `403` / `code 11140` “request illegal” | channel/WAF rejection, not a token verdict | retry with another client profile before discarding |
| `401` + `Microsoft-IIS` HTML page | token rejected at the edge | dead |
| `401` / `code 12153 … invalid_grant: Offline user session not found` (on refresh) | Keycloak session revoked | dead — needs a fresh login |

The HTML `401` is worth calling out: a rejected CodeBuddy token comes back as an
IIS error page, not a JSON envelope, so naive `typeof body === "object"` error
handling misclassifies it.

---

## 5. Results of the 2026-10-22 migration

Source: 41 `codebuddy-cn` + 4 `codebuddy-ai` entries; old backup: 41
`codebuddy-cn` rows (all `apikey`) + 5 `codebuddy-intl` rows.

Chat probe over all 41 CN accounts:

| Outcome | Count |
|---|---|
| `200` — serves chat | 13 |
| `429` code 14018 — quota, still valid | 1 |
| `403` code 11140 — channel rejection | 3 |
| `401` IIS HTML — dead | 24 |

Final rows written to the rebuilt backup:

| Provider | Rows | Active | Inactive |
|---|---|---|---|
| `codebuddy-cn` | 41 | 14 (13 chat-ok + 1 quota-limited) | 27 |
| `codebuddy-intl` | 4 | 4 | 0 |
| other providers | 20 | untouched | — |

Notable numbers from the same run:

- 17 of 41 access tokens were still inside their `exp` window; only 13 of those
  actually answered chat.
- 7 of 41 refresh tokens could be exchanged.
- The union (7 refresh-ok ∪ 13 chat-ok) is what the active count reflects —
  proof that one check alone under-counts.

---

## 6. Rules applied when rebuilding

1. Every row is rebuilt from the export, keyed on the JWT `sub`.
2. `isActive` follows the probe: active on `200` **or** `429`; inactive on
   `401`/`403`.
3. `429` never disables a row — quota refills with the daily bonus.
4. A dead row keeps its `lastError` so the dashboard explains why.
5. `modelLock_*`, `backoffLevel` and old error history are dropped: a rebuilt row
   starts clean.
6. Rows without a counterpart in the export (1 legacy `codebuddy-intl` row) are
   left untouched rather than deleted.
7. Everything outside the two CodeBuddy providers is copied verbatim.

---

## 7. Procedure

1. Snapshot the current DB (`Profile → Export Database`).
2. Convert + probe with a scratch script (keep it out of the repo; it handles
   live credentials).
3. Write a **new** backup file; never overwrite the original.
4. Import it (`Profile → Import Database`, or `POST /api/settings/database`
   with the dashboard password).
5. Open a `cbcn-*` / `cbai-*` row and press **Test** — a healthy pair shows the
   *refresh ok · \<date\>* badge (see §8).
6. Keep the rebuilt backup as the source of truth; the reseller export is stale
   for every exchanged account.

---

## 8. What 9router shows afterwards

`docs/codebuddy-gateway-fingerprint.md` §8 covers the runtime side; the dashboard
surfaces:

- **Connection test** — exchanges the refresh token and returns `tokenState`
  (`alive | expired | revoked | missing | unverified`) instead of a bare
  “token exists”.
- **Row badge** — `no refresh token`, `refresh ok · <date>`,
  `refresh expired <date>`.
- **API payload** — `hasRefreshToken` / `hasAccessToken` booleans only; the
  tokens themselves never leave the server.

---

## 9. Open questions from this run

- **3 × `403` code 11140.** These tokens pass `sub` validation but are refused by
  the channel check. Retrying them under the `CODEBUDDY_CLIENT=workbuddy`
  profile is untested; if it works they are recoverable, not dead.
- **1 × `429` code 14018.** Active on the assumption that the daily bonus tops
  the account up; if the quota stays at zero it will surface as repeated 429s.
- **24 × `401`.** Both tokens are dead server-side; only a fresh login (or a
  newer export) can revive them.
