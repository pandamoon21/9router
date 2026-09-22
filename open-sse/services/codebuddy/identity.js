/**
 * CodeBuddy (Tencent) credential identity & telemetry fingerprinting.
 *
 * CodeBuddy's server cross-references the official CLI's device fingerprints
 * (qimei36, machineId, sessionId) against chat requests — a key that chats
 * without emitting those signals is flagged as a bot/proxy and banned.
 *
 * To avoid that, 9router derives a *stable, per-credential* identity from the
 * access token so the same key always presents the same fingerprint across
 * requests and across restarts (no persistent store needed — the derivation is
 * deterministic from the token, which is itself stable for a given login).
 *
 * Reference: 9router_CodeBuddy_Security_Fix_Guide §1.1–§1.4, §3 Rec 1/2/6.
 */
import crypto from "node:crypto";
import os from "node:os";

// Build metadata pinned to the current CLI release (product.json).
// Update these when bumping the User-Agent version in the registry.
// Source: node_modules/@tencent-ai/codebuddy-code/product.json
export const CODEBUDDY_BUILD_INFO = {
  releaseDate: 1785400746436,
  commit: "e9991e2be9dcafcce0fad23fc065dd91a7f3efed",
};

export const CODEBUDDY_CLI_VERSION = "2.156.0";

// Shared telemetry SDK topic (CLI shares WorkBuddy Desktop's SDK id).
const GALILEO_SDK_TOPIC = "SDK-768de26ec97715a3bbab";

/**
 * Best-effort extraction of the Tencent uid from a CodeBuddy access token.
 *
 * The official CLI's access token is a JWT whose payload carries `uid` (number
 * or string) and `username` (phone/email). We decode without verifying — we
 * only need a stable correlation id for telemetry, not auth.
 *
 * If the token is opaque (not a JWT), we fall back to a deterministic hash so
 * every request from the same key still presents the same uid-shaped string.
 */
export function extractCodebuddyUid(accessToken) {
  if (!accessToken || typeof accessToken !== "string") return null;
  const parts = accessToken.split(".");
  if (parts.length >= 2) {
    try {
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
      const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
      if (payload?.uid != null) return String(payload.uid);
      if (payload?.userId != null) return String(payload.userId);
    } catch {
      // not a JWT or payload malformed → fall through to hash
    }
  }
  // Deterministic fallback: stable 10-digit numeric-ish id from the token.
  const hash = crypto.createHash("sha256").update(accessToken).digest("hex");
  return String(BigInt("0x" + hash.slice(0, 12)) % 10000000000n).padStart(10, "0");
}

/**
 * Generate a stable 36-char hex qimei36 for a credential.
 *
 * The official QIMEI SDK emits a 36-character device fingerprint. We derive
 * one deterministically from the access token so it is:
 *   - stable across requests (same key → same qimei36)
 *   - unique per credential
 *   - correctly formatted (36 hex chars)
 */
export function generateStableQimei36(accessToken) {
  const seed = accessToken || "codebuddy-default-seed";
  const hex = crypto.createHash("sha256").update(seed).digest("hex");
  // sha256 → 64 hex chars; take the first 36 for qimei36 length parity.
  return hex.slice(0, 36);
}

/**
 * Generate a stable Windows-style machineId (UUID) for a credential.
 *
 * Mirrors the official client's `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography\MachineGuid`
 * shape: 8-4-4-4-12 hex. Stable per credential so the server never sees the
 * same key hop between machines.
 */
export function generateStableMachineId(accessToken) {
  const seed = accessToken || "codebuddy-default-seed";
  const hash = crypto.createHash("sha256").update("machine:" + seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Generate a stable sessionId for a credential.
 *
 * The official CLI generates one sessionId per *process* and reuses it for
 * every event in that session. 9router is a long-lived proxy, so we derive a
 * stable-per-credential sessionId — equivalent to "one CLI session per key",
 * which is the shape the server expects (a key that hops sessions every
 * request is also a bot signal).
 */
export function generateStableSessionId(accessToken) {
  const seed = accessToken || "codebuddy-default-seed";
  const hash = crypto.createHash("sha256").update("session:" + seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Derive a stable 40-char git commit hash for VCS telemetry fields.
 */
function generateStableCommitHash(accessToken) {
  return crypto.createHash("sha256").update("vcs:" + (accessToken || "")).digest("hex").slice(0, 40);
}

/**
 * Build the full per-credential CodeBuddy identity used in every telemetry event.
 *
 * @param {string} accessToken - CodeBuddy OAuth access token (or API key)
 * @returns {Object} identity fields ready to spread into a report event
 */
export function getCodebuddyIdentity(accessToken) {
  return {
    uid: extractCodebuddyUid(accessToken),
    machineId: generateStableMachineId(accessToken),
    sessionId: generateStableSessionId(accessToken),
    qimei36: generateStableQimei36(accessToken),
    vcsRevId: generateStableCommitHash(accessToken),
  };
}

/**
 * Common fields included in every /v2/report event (CodeBuddy CLI v2.133.1).
 *
 * Mirrors the official CLI's report envelope so the server sees a consistent
 * client across all events from a credential.
 */
export function buildCodebuddyCommonFields(identity, { domain = "www.codebuddy.cn" } = {}) {
  return {
    userId: identity.uid,
    product: "SaaS",
    releaseDate: CODEBUDDY_BUILD_INFO.releaseDate,
    commit: CODEBUDDY_BUILD_INFO.commit,
    extName: "workbuddy-desktop",
    extVersion: "5.3.8",
    ideName: "CLI",
    ideType: "CLI",
    ideVersion: CODEBUDDY_CLI_VERSION,
    machineId: identity.machineId,
    sessionId: identity.sessionId,
    qimei36: identity.qimei36,
    os: "win32",
    arch: "x64",
    osVersion: "10.0.26200",
    cpuModel: "13th Gen Intel(R) Core(TM) i5-13420H",
    cpuCores: 12,
    memorySize: 32,
    timezone: "Asia/Shanghai",
    vcsType: "git",
    vcsRepo: "github.com/user/project",
    vcsBranchName: "main",
    vcsRevId: identity.vcsRevId,
    _domain: domain,
  };
}

export const GALILEO_TOPIC = GALILEO_SDK_TOPIC;
