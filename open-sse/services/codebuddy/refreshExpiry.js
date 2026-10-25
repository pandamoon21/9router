/**
 * True when the stored refresh token is itself past its lifetime.
 *
 * CodeBuddy's token payload carries `refreshExpiresIn`, which the client keeps
 * as `refreshExpiresAt`. Once that passes, a refresh call cannot succeed, so
 * callers should report "re-authenticate" instead of spending a round trip per
 * request on a refresh that is guaranteed to fail.
 *
 * Fork-only file on purpose: it used to live in oauthCredentialManager.js, but
 * tests that mock that module with a two-export factory then broke on the extra
 * import. Keeping it here also leaves the upstream-owned file untouched.
 */
export function isRefreshTokenExpired(credentials, nowMs = Date.now()) {
  const expiresAt = credentials?.providerSpecificData?.refreshExpiresAt;
  const ms = typeof expiresAt === "number" ? expiresAt : Date.parse(expiresAt || "");
  return Number.isFinite(ms) && ms <= nowMs;
}
