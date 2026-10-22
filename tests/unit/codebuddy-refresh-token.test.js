// CodeBuddy token refresh — request shape, dead-token classification, lifetime.
//
// `providers.js` and `tokenRefresh.js` are imported after the fetch stub is
// installed and with `resetModules`, because `dedupRefresh` caches results per
// (provider, refreshToken) for 10s — a shared module registry would hand a
// previous test's response to the next one.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

let fetchMock;

function stubFetch(handler) {
  fetchMock = vi.fn(handler);
  globalThis.fetch = fetchMock;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function loadProviders() {
  vi.resetModules();
  return import("../../open-sse/services/tokenRefresh/providers.js");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe("codebuddy refresh: request shape", () => {
  it("sends the refresh token in X-Refresh-Token, not the body", async () => {
    stubFetch(async () => jsonResponse({
      code: 0,
      data: { accessToken: "new-at", refreshToken: "new-rt", expiresIn: 86400 },
    }));

    const { refreshCodebuddyToken } = await loadProviders();
    const result = await refreshCodebuddyToken({ accessToken: "old-at", refreshToken: "old-rt" }, null);

    expect(result.accessToken).toBe("new-at");
    expect(result.refreshToken).toBe("new-rt");
    expect(result.expiresIn).toBe(86400);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://copilot.tencent.com/v2/plugin/auth/token/refresh");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Refresh-Token"]).toBe("old-rt");
    expect(init.headers["X-Auth-Refresh-Source"]).toBe("plugin");
    expect(init.headers["X-Domain"]).toBe("copilot.tencent.com");
    expect(init.headers["Authorization"]).toBe("Bearer old-at");
    expect(init.body).toBe("{}");
  });

  it("keeps the current refresh token when the server does not rotate it", async () => {
    stubFetch(async () => jsonResponse({ code: 0, data: { accessToken: "new-at" } }));

    const { refreshCodebuddyToken } = await loadProviders();
    const result = await refreshCodebuddyToken({ refreshToken: "keep-me" }, null);
    expect(result.refreshToken).toBe("keep-me");
  });

  it("records the refresh token's own lifetime", async () => {
    stubFetch(async () => jsonResponse({
      code: 0,
      data: { accessToken: "a", refreshToken: "b", expiresIn: 60, refreshExpiresIn: 3600 },
    }));

    const { refreshCodebuddyToken } = await loadProviders();
    const before = Date.now();
    const result = await refreshCodebuddyToken({ refreshToken: "rt" }, null);
    expect(result.refreshExpiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000 - 50);
    expect(result.refreshExpiresAt).toBeLessThanOrEqual(Date.now() + 3600 * 1000 + 50);
  });

  it("keeps the intl provider on its own host", async () => {
    stubFetch(async () => jsonResponse({ code: 0, data: { accessToken: "a" } }));

    const { refreshCodebuddyIntlToken } = await loadProviders();
    await refreshCodebuddyIntlToken({ refreshToken: "rt-intl" }, null);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.codebuddy.ai/v2/plugin/auth/token/refresh");
    expect(init.headers["X-Domain"]).toBe("www.codebuddy.ai");
  });
});

describe("codebuddy refresh: dead refresh token classification", () => {
  it("maps Tencent 12153 (HTTP 401) to invalid_grant so the account stops retrying", async () => {
    stubFetch(async () => jsonResponse(
      { code: 12153, msg: "12153:refresh token failed:10000:token format error" },
      401
    ));

    const { refreshCodebuddyToken } = await loadProviders();
    expect(await refreshCodebuddyToken({ refreshToken: "dead" }, null)).toEqual({ error: "invalid_grant" });
  });

  it("classifies a 200 body carrying 12153 the same way", async () => {
    stubFetch(async () => jsonResponse({ code: 12153, msg: "refresh token failed" }));

    const { refreshCodebuddyToken } = await loadProviders();
    expect(await refreshCodebuddyToken({ refreshToken: "dead" }, null)).toEqual({ error: "invalid_grant" });
  });

  it("treats a 5xx as transient (null), not as a dead credential", async () => {
    stubFetch(async () => new Response("upstream unavailable", { status: 503 }));

    const { refreshCodebuddyToken } = await loadProviders();
    expect(await refreshCodebuddyToken({ refreshToken: "rt" }, null)).toBeNull();
  });

  it("treats a network error as transient", async () => {
    stubFetch(async () => { throw new Error("ECONNRESET"); });

    const { refreshCodebuddyToken } = await loadProviders();
    expect(await refreshCodebuddyToken({ refreshToken: "rt" }, null)).toBeNull();
  });

  it("returns null without a refresh token", async () => {
    stubFetch(async () => jsonResponse({ code: 0, data: { accessToken: "nope" } }));

    const { refreshCodebuddyToken } = await loadProviders();
    expect(await refreshCodebuddyToken({ accessToken: "only-at" }, null)).toBeNull();
  });
});

describe("codebuddy refresh: unrecoverable classification", () => {
  it("invalid_grant is unrecoverable, a transient null is not", async () => {
    vi.resetModules();
    const { isUnrecoverableRefreshError } = await import("../../open-sse/services/tokenRefresh.js");
    expect(isUnrecoverableRefreshError({ error: "invalid_grant" })).toBe(true);
    expect(isUnrecoverableRefreshError(null)).toBeFalsy();
    expect(isUnrecoverableRefreshError(undefined)).toBeFalsy();
  });
});
