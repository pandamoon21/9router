/**
 * kiro-cli wire parity — endpoint shape and ordering.
 *
 * The CLI POSTs to the bare host root of runtime.<region>.kiro.dev; the
 * operation is selected by x-amz-target, not by the path. The Amazon hosts keep
 * their legacy path form.
 */
import { describe, it, expect } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

const kiro = PROVIDERS.kiro;

describe("kiro endpoint — kiro-cli parity", () => {
  it("primary baseUrl is the bare runtime host root", () => {
    expect(kiro.baseUrl).toBe("https://runtime.us-east-1.kiro.dev/");
    expect(kiro.baseUrl.endsWith("/generateAssistantResponse")).toBe(false);
  });

  it("keeps runtime.* first in baseUrls", () => {
    expect(kiro.baseUrls[0]).toBe("https://runtime.us-east-1.kiro.dev/");
  });

  it("the runtime entry has no path while the Amazon entries keep the legacy path", () => {
    const [runtime, cw, q] = kiro.baseUrls;
    expect(new URL(runtime).pathname).toBe("/");
    expect(new URL(cw).pathname).toBe("/generateAssistantResponse");
    expect(new URL(q).pathname).toBe("/generateAssistantResponse");
  });
});

describe("kiro endpoint ordering — auth gating", () => {
  const executor = new KiroExecutor();

  it("OAuth methods still reach the runtime host first", () => {
    const urls = executor.getOrderedBaseUrls({
      accessToken: "aoaTEST",
      providerSpecificData: { authMethod: "builder-id" },
    });
    expect(urls[0]).toContain("runtime.us-east-1.kiro.dev");
  });

  it("api_key keeps the q.* surface first (regression guard)", () => {
    const urls = executor.getOrderedBaseUrls({
      apiKey: "sk-test",
      providerSpecificData: { authMethod: "api_key" },
    });
    expect(urls[0]).toContain("://q.");
  });

  it("regionalizes only the amazonaws hosts, never runtime.kiro.dev", () => {
    const urls = executor.getOrderedBaseUrls({
      accessToken: "aoaTEST",
      providerSpecificData: { authMethod: "builder-id", region: "eu-central-1" },
    });
    expect(urls.some((u) => u.includes("eu-central-1.amazonaws.com"))).toBe(true);
    // runtime.* stays us-east-1: it is not an amazonaws host
    expect(urls.find((u) => u.includes("runtime."))).toContain("us-east-1");
  });
});
