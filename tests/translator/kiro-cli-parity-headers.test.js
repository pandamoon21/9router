/**
 * kiro-cli wire parity — registry headers + executor buildHeaders().
 *
 * Asserts 9router's static Kiro headers match the fingerprint captured from the
 * real kiro-cli 2.21.4 client, and that the non-OAuth methods still send what
 * they need. See docs/03-chat-request-spec.md in the research repo. The
 * exact-string assertions are deliberate: "close enough" is what gets a client
 * flagged.
 */
import { describe, it, expect } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

const headers = PROVIDERS.kiro.headers;

describe("kiro registry headers — kiro-cli parity", () => {
  it("uses the AWS JSON 1.0 content type, not application/json", () => {
    expect(headers["Content-Type"]).toBe("application/x-amz-json-1.0");
  });

  it("accepts anything (the CLI does not negotiate eventstream via Accept)", () => {
    expect(headers["Accept"]).toBe("*/*");
  });

  it("user-agent is the rust grammar WITHOUT ua/2.1 or api/", () => {
    const ua = headers["User-Agent"];
    expect(ua).toBe(
      "aws-sdk-rust/1.3.15 os/windows lang/rust/1.92.0 " +
        "md/appVersion-2.21.4 app/AmazonQ-For-CLI"
    );
    expect(ua).not.toContain("ua/2.1");
    expect(ua).not.toContain("api/");
    expect(ua).toContain("md/appVersion-");
  });

  it("x-amz-user-agent is the rust grammar WITH ua/2.1, api/ and m/F — but NO md/", () => {
    const xua = headers["X-Amz-User-Agent"];
    expect(xua).toBe(
      "aws-sdk-rust/1.3.15 ua/2.1 api/codewhispererstreaming/0.1.17975 " +
        "os/windows lang/rust/1.92.0 m/F app/AmazonQ-For-CLI"
    );
    expect(xua).toContain("api/codewhispererstreaming/");
    expect(xua).toContain("m/F");
    expect(xua).not.toContain("md/");
  });

  it("keeps the two user-agent grammars distinct", () => {
    expect(headers["User-Agent"]).not.toBe(headers["X-Amz-User-Agent"]);
  });

  it("no longer sends the placeholder AWS-SDK-JS client identity", () => {
    const all = Object.values(headers).join(" ");
    expect(all).not.toContain("AWS-SDK-JS");
    expect(all).not.toContain("aws-sdk-js");
    expect(all).not.toContain("kiro-ide/");
  });
});

describe("kiro executor buildHeaders — OAuth fingerprint", () => {
  const executor = new KiroExecutor();
  const oauth = (method) => ({
    accessToken: "aoaTESTTOKEN",
    providerSpecificData: { authMethod: method, profileArn: "arn:aws:codewhisperer:us-east-1:1:profile/X" },
  });

  for (const method of ["builder-id", "idc", "google", "github", "import"]) {
    it(`sets x-amz-target and optout for authMethod=${method}`, () => {
      const h = executor.buildHeaders(oauth(method), true, "https://runtime.us-east-1.kiro.dev/");
      expect(h["x-amz-target"]).toBe("AmazonCodeWhispererStreamingService.GenerateAssistantResponse");
      expect(h["x-amzn-codewhisperer-optout"]).toBe("false");
    });
  }

  it("x-kiro-attempt has NO space; amz-sdk-request HAS one", () => {
    const h = executor.buildHeaders(oauth("builder-id"), true, "https://runtime.us-east-1.kiro.dev/");
    expect(h["x-kiro-attempt"]).toBe("1;max=3");
    expect(h["amz-sdk-request"]).toBe("attempt=1; max=3");
  });

  it("raises BOTH retry headers on a retry attempt", () => {
    const h = executor.buildHeaders(
      oauth("builder-id"), true, "https://runtime.us-east-1.kiro.dev/", null, 2
    );
    expect(h["amz-sdk-request"]).toBe("attempt=2; max=3");
    expect(h["x-kiro-attempt"]).toBe("2;max=3");
  });

  it("is call-compatible with BaseExecutor's (creds, stream, url, model) call site", () => {
    // BaseExecutor passes `model` as the 4th argument. If that ever lands in the
    // attempt slot, both retry headers would be corrupted with a model name.
    const h = executor.buildHeaders(
      oauth("builder-id"), true, "https://runtime.us-east-1.kiro.dev/", "claude-opus-4.7"
    );
    expect(h["amz-sdk-request"]).toBe("attempt=1; max=3");
    expect(h["x-kiro-attempt"]).toBe("1;max=3");
  });

  it("omits the headers the CLI never sends", () => {
    const h = executor.buildHeaders(oauth("builder-id"), true, "https://runtime.us-east-1.kiro.dev/");
    expect(h["x-amzn-kiro-agent-mode"]).toBeUndefined();
    expect(h["x-amzn-codewhisperer-machine-id"]).toBeUndefined();
    expect(h["x-amz-sso-bearer"]).toBeUndefined();
    expect(h["x-amzn-codewhisperer-profile-arn"]).toBeUndefined();
  });

  it("uses lowercase smithy header names for parity", () => {
    const h = executor.buildHeaders(oauth("builder-id"), true, "https://runtime.us-east-1.kiro.dev/");
    expect(h["amz-sdk-invocation-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(h["Amz-Sdk-Request"]).toBeUndefined();
  });
});

describe("kiro executor buildHeaders — non-OAuth regression guards", () => {
  const executor = new KiroExecutor();

  it("api_key still sends TokenType=API_KEY and the legacy surface headers", () => {
    const h = executor.buildHeaders(
      { apiKey: "sk-test", providerSpecificData: { authMethod: "api_key" } },
      true,
      "https://q.us-east-1.amazonaws.com/generateAssistantResponse"
    );
    expect(h["Authorization"]).toBe("Bearer sk-test");
    expect(h["TokenType"]).toBe("API_KEY");
    // must NOT pick up the OAuth-only fingerprint headers
    expect(h["x-kiro-attempt"]).toBeUndefined();
    expect(h["x-amzn-codewhisperer-optout"]).toBeUndefined();
    expect(h["x-amz-target"]).toBeUndefined();
  });

  it("external_idp still sends TokenType=EXTERNAL_IDP and keeps the SSO bearer", () => {
    const h = executor.buildHeaders(
      { accessToken: "tok-ext", providerSpecificData: { authMethod: "external_idp" } },
      true,
      "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse"
    );
    expect(h["TokenType"]).toBe("EXTERNAL_IDP");
    expect(h["x-amz-sso-bearer"]).toBe("tok-ext");
    expect(h["X-Amz-Target"]).toBeTruthy();
    expect(h["x-kiro-attempt"]).toBeUndefined();
  });

  it("an unknown/absent authMethod keeps the previous behaviour", () => {
    const h = executor.buildHeaders(
      { accessToken: "tok", providerSpecificData: {} }, true, "https://runtime.us-east-1.kiro.dev/"
    );
    expect(h["x-amzn-kiro-agent-mode"]).toBe("spec");
    expect(h["x-amzn-codewhisperer-machine-id"]).toBe("kiro-desktop");
    expect(h["x-amz-sso-bearer"]).toBe("tok");
    expect(h["x-kiro-attempt"]).toBeUndefined();
  });
});
