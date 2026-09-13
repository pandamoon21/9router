/**
 * kiro-cli wire parity — registry headers.
 *
 * Asserts 9router's static Kiro headers match the fingerprint captured from the
 * real kiro-cli 2.21.4 client. See docs/03-chat-request-spec.md in the research
 * repo. These are exact-string assertions on purpose: a "close enough" header is
 * the thing that gets a client flagged.
 */
import { describe, it, expect } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";

// PROVIDERS[id] is buildTransport(entry.transport), so the header block is
// flattened onto the provider object directly.
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
