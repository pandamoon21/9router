// The stored refresh token has its own lifetime (`refreshExpiresAt`), separate
// from the access token's `expiresAt`. Past it, a refresh can only fail, so the
// guard reports it instead of spending a round trip per request.
import { describe, it, expect } from "vitest";
import { isRefreshTokenExpired } from "../../open-sse/services/oauthCredentialManager.js";

describe("isRefreshTokenExpired", () => {
  it("is true once refreshExpiresAt has passed", () => {
    expect(isRefreshTokenExpired({ providerSpecificData: { refreshExpiresAt: Date.now() - 1000 } })).toBe(true);
  });

  it("is false while the refresh token is still alive", () => {
    expect(isRefreshTokenExpired({ providerSpecificData: { refreshExpiresAt: Date.now() + 60_000 } })).toBe(false);
  });

  it("accepts an ISO string", () => {
    expect(isRefreshTokenExpired({
      providerSpecificData: { refreshExpiresAt: new Date(Date.now() - 1000).toISOString() },
    })).toBe(true);
  });

  it("stays false when no lifetime is recorded (the endpoint decides)", () => {
    expect(isRefreshTokenExpired({ providerSpecificData: {} })).toBe(false);
    expect(isRefreshTokenExpired({})).toBe(false);
    expect(isRefreshTokenExpired(null)).toBe(false);
  });
});
