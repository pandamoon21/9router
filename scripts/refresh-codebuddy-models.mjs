#!/usr/bin/env node
/**
 * Refresh a CodeBuddy provider's model catalog from its /v3/config endpoint.
 *
 * Supports both providers:
 *   codebuddy-cn   → copilot.tencent.com/v3/config (User-Agent: CLI/x.y.z)
 *   codebuddy-intl → www.codebuddy.ai/v3/config    (User-Agent: IDE/x.y.z)
 *
 * Why a script, not runtime:
 *   - The catalog is stable enough that pinning it in the registry is fine
 *     (upstream 9router also pins theirs); avoiding a runtime fetch keeps
 *     cold start deterministic and independent of a live token.
 *   - Run after user reports "new model X missing", or on a cron.
 *
 * Usage:
 *   node scripts/refresh-codebuddy-models.mjs [--provider=cn|intl] [--write] [--token=<jwt>]
 *
 * Defaults: --provider=cn, dry-run.
 * By default reads the access token from the local 9router SQLite DB at
 *   %APPDATA%/9router/db/data.sqlite (Windows) or ~/.9router/db/data.sqlite.
 *
 * ponytail: writes back only the catalog block; the transport/oauth
 * headers stay manual — those change on a different cadence (real-CLI bumps).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROVIDERS = {
  cn: {
    id: "codebuddy-cn",
    registry: "open-sse/providers/registry/codebuddy-cn.js",
    configUrl: "https://copilot.tencent.com/v3/config",
    userAgent: "CLI/2.156.0 CodeBuddy/2.156.0",
  },
  intl: {
    id: "codebuddy-intl",
    registry: "open-sse/providers/registry/codebuddy-intl.js",
    configUrl: "https://www.codebuddy.ai/v3/config",
    userAgent: "IDE/2.156.0 CodeBuddy/2.156.0",
  },
};

// A cbcn/cbai model is user-callable only when it can chat. Image-only
// endpoints (hunyuan-image-*) and the placeholder "default" ride a different
// code path.
function isChatModel(m) {
  if (!m.supportsToolCall) return false;
  if (m.id === "default") return false;
  if (/^hunyuan-image/.test(m.id)) return false;
  return true;
}

async function readTokenFromDb(providerId) {
  const dbPath = process.env.APPDATA
    ? path.join(process.env.APPDATA, "9router/db/data.sqlite")
    : path.join(os.homedir(), ".9router/db/data.sqlite");
  if (!fs.existsSync(dbPath)) {
    throw new Error(`no local 9router DB at ${dbPath}; pass --token=<jwt>`);
  }
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const row = db.prepare(
    "select data from providerConnections where provider=? and isActive=1 limit 1",
  ).get(providerId);
  db.close();
  if (!row) throw new Error(`no active ${providerId} credential row; pass --token=<jwt>`);
  return JSON.parse(row.data).apiKey;
}

async function fetchCatalog(cfg, token) {
  const r = await fetch(cfg.configUrl, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": cfg.userAgent },
  });
  if (!r.ok) throw new Error(`${cfg.configUrl} returned ${r.status}: ${await r.text()}`);
  const body = await r.json();
  if (body.code !== 0) throw new Error(`config error: ${JSON.stringify(body).slice(0, 200)}`);
  return body.data.models;
}

function renderCatalog(entries) {
  return entries.map((e) => `    { id: "${e.id}", name: "${e.name}" },`).join("\n");
}

function rewriteRegistry(registryPath, catalogBlock) {
  const src = fs.readFileSync(registryPath, "utf8");
  const re = /(models:\s*\[)([\s\S]*?)(\n\s*\],)/;
  if (!re.test(src)) throw new Error(`registry: models:[...] block not found in ${registryPath}`);
  const out = src.replace(re, (_m, head, _oldBody, tail) => `${head}\n${catalogBlock}${tail}`);
  fs.writeFileSync(registryPath, out);
}

function currentRegistryIds(registryPath) {
  const src = fs.readFileSync(registryPath, "utf8");
  const m = src.match(/models:\s*\[([\s\S]*?)\n\s*\],/);
  if (!m) return [];
  return [...m[1].matchAll(/id:\s*"([^"]+)"/g)].map((mm) => mm[1]);
}

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const providerArg = args.find((a) => a.startsWith("--provider="))?.slice(11) || "cn";
  const tokenArg = args.find((a) => a.startsWith("--token="))?.slice(8);

  const cfg = PROVIDERS[providerArg];
  if (!cfg) throw new Error(`unknown --provider=${providerArg}; expected cn or intl`);
  const registryPath = path.join(REPO_ROOT, cfg.registry);

  const token = tokenArg || (await readTokenFromDb(cfg.id));
  const upstream = await fetchCatalog(cfg, token);
  const chat = upstream.filter(isChatModel);
  const entries = chat.map((m) => ({ id: m.id, name: m.name }));

  const upstreamIds = new Set(entries.map((e) => e.id));
  const currentIds = new Set(currentRegistryIds(registryPath));
  const added = [...upstreamIds].filter((id) => !currentIds.has(id)).sort();
  const removed = [...currentIds].filter((id) => !upstreamIds.has(id)).sort();

  console.log(`[${cfg.id}] upstream chat models: ${entries.length}`);
  if (added.length) console.log("  + " + added.join("\n  + "));
  if (removed.length) console.log("  - " + removed.join("\n  - "));
  if (!added.length && !removed.length) console.log("  (registry already in sync)");

  const hidden = upstream.filter((m) => !isChatModel(m));
  if (hidden.length) {
    console.log(`\nnon-chat models (skipped): ${hidden.map((m) => m.id).join(", ")}`);
  }

  if (write) {
    rewriteRegistry(registryPath, renderCatalog(entries));
    console.log(`\nwrote ${entries.length} entries -> ${path.relative(REPO_ROOT, registryPath)}`);
  } else if (added.length || removed.length) {
    console.log("\n(use --write to apply)");
  }
}

main().catch((e) => {
  console.error(`refresh-codebuddy-models: ${e.message}`);
  process.exit(1);
});
