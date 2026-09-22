# Refreshing CodeBuddy model catalogs

Fork tracks two CodeBuddy providers whose model lists drift as Tencent adds
and retires models:

- `codebuddy-cn` — copilot.tencent.com (China gateway)
- `codebuddy-intl` — www.codebuddy.ai (International gateway)

`scripts/refresh-codebuddy-models.mjs` pulls the live catalog from either
gateway's `/v3/config` endpoint and rewrites the `models: […]` block in the
matching registry file. It never writes bearer tokens to disk; credentials
come from your local 9router SQLite runtime or from a `--token=<jwt>` flag.

## When to run it

- A user reports "model X is missing" on the dashboard.
- Tencent's dashboard shows a new model you want to route through.
- Periodically, as part of routine fork maintenance.

## Prerequisites

You need **one** active credential for the provider you want to refresh:

- For `codebuddy-cn`: an OAuth or API-key connection for `codebuddy-cn` in
  your local 9router, OR a raw JWT you can pass with `--token=`.
- For `codebuddy-intl`: same, but for `codebuddy-intl`.

The script reads tokens from `%APPDATA%\9router\db\data.sqlite` on Windows
or `~/.9router/db/data.sqlite` on Linux/macOS. It uses `better-sqlite3`
(already a fork dependency), so `npm install` at the repo root is enough.

## Basic usage

Dry-run (default; shows the diff, changes nothing):

```bash
# from repo root
node scripts/refresh-codebuddy-models.mjs                    # cbcn
node scripts/refresh-codebuddy-models.mjs --provider=intl    # cbai
```

Apply the change (rewrites `open-sse/providers/registry/codebuddy-*.js`):

```bash
node scripts/refresh-codebuddy-models.mjs --write
node scripts/refresh-codebuddy-models.mjs --provider=intl --write
```

Override the credential (CI, or when the local DB isn't accessible):

```bash
node scripts/refresh-codebuddy-models.mjs --provider=intl --token="<jwt>"
```

## What the script does

1. Reads the current registry's `models: […]` block to know the starting set.
2. Fetches `/v3/config` with the full CLI fingerprint:

   | Header | Value |
   |---|---|
   | `Authorization` | `Bearer <token>` |
   | `User-Agent` | `CLI/2.156.0 CodeBuddy/2.156.0` |
   | `X-Product` | `SaaS` |
   | `X-Domain` | `www.codebuddy.cn` or `www.codebuddy.ai` |
   | `X-User-Id` | `sub` claim from the JWT |
   | `X-Requested-With` | `XMLHttpRequest` |
   | `Accept` | `application/json, text/plain, */*` |

   The `X-User-Id` header is critical for `codebuddy-intl` — without it,
   `data.models` returns empty. Both providers gate the catalog behind the
   same fingerprint the real CLI sends on every chat request.
3. Filters out entries the fork doesn't route through the chat path:
   - `default` / `default-model` / `default-model-lite` (placeholder)
   - `hunyuan-image-*` (image endpoints, not chat)
   - Virtual aliases: `fast-model`, `balanced-model`, `primary-model`,
     `reasoning-model` (UI aliases that resolve to a real model server-side)
   - Anything without `supportsToolCall`
4. Prints the diff and, with `--write`, replaces just the `models: […]` block
   in the registry file. Everything else in the registry (transport headers,
   OAuth URLs, aliases, etc.) is left alone — those change on a different
   cadence (real-CLI version bumps) and should be edited by hand.

## After running

- Run the fork's baseline check to update the pinned providers snapshot:
  ```bash
  node tests/__baseline__/snapshot-providers.mjs
  ```
- Run tests:
  ```bash
  cd tests && npx vitest run unit/codebuddy-cn-waf-headers.test.js unit/codebuddy-cn-system-prompt.test.js
  ```
- Commit both `open-sse/providers/registry/codebuddy-*.js` and the updated
  `tests/__baseline__/providers-baseline.json`.

## Security notes

- The script writes zero bearer tokens to source-controlled files.
- If you pass `--token=<jwt>`, it lives only in that process's argv — don't
  paste it into shell history, prefer an env var:
  ```bash
  CBAI_TOKEN=<jwt> node scripts/refresh-codebuddy-models.mjs --provider=intl --token="$CBAI_TOKEN"
  ```
- The token in the local 9router SQLite is the same OAuth JWT already used
  for chat, so refreshing the catalog exposes no new secret.

## Troubleshooting

**`no active codebuddy-cn credential row`** — you don't have that provider
connected in the local 9router. Either connect it via the dashboard, or pass
`--token=<jwt>`.

**`returned no data.models`** — the token is missing catalog scope, or the
`X-User-Id` header couldn't be derived (JWT payload malformed). Grab a fresh
token from your CLI/browser session and try again with `--token=`.

**`returned 401`** — token expired. Re-authenticate the provider in the
dashboard, or fetch a fresh JWT.

**Providers baseline drift after refresh** — expected. `snapshot-providers.mjs`
re-pins the snapshot; commit both files together.
