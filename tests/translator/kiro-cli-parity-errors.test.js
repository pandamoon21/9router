/**
 * kiro-cli wire parity — upstream error parsing.
 *
 * Kiro answers a rejected request with plain JSON (not an EventStream frame):
 *   {"__type":"com.amazon.kiro.runtimeservice#ValidationException",
 *    "message":"...", "reason":"INVALID_MODEL_ID"}
 * plus an x-amzn-RequestId header. The parser must surface the reason and the
 * correlation id, which the generic parser drops.
 */
import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";

const executor = new KiroExecutor();

function kiroError(body, requestId = "d4129996-f4f5-4a5f-977c-8cbe70b12164") {
  return new Response(JSON.stringify(body), {
    status: 400,
    headers: {
      "content-type": "application/x-amz-json-1.0",
      ...(requestId ? { "x-amzn-RequestId": requestId } : {}),
    },
  });
}

const VALIDATION = {
  __type: "com.amazon.kiro.runtimeservice#ValidationException",
  message: "Invalid model ID. Please select a different model to continue.",
  reason: "INVALID_MODEL_ID",
};

describe("kiro parseError — the captured 400 body", () => {
  it("surfaces the message, reason, request id and exception type", () => {
    const parsed = executor.parseError(kiroError(VALIDATION), JSON.stringify(VALIDATION));
    expect(parsed.status).toBe(400);
    expect(parsed.message).toContain("Invalid model ID");
    expect(parsed.message).toContain("reason=INVALID_MODEL_ID");
    expect(parsed.message).toContain("request_id=d4129996");
    expect(parsed.message).toContain("ValidationException");
    expect(parsed.kiroReason).toBe("INVALID_MODEL_ID");
    expect(parsed.requestId).toBe("d4129996-f4f5-4a5f-977c-8cbe70b12164");
  });

  it("works without the request-id header", () => {
    const parsed = executor.parseError(
      kiroError(VALIDATION, null),
      JSON.stringify(VALIDATION)
    );
    expect(parsed.message).toContain("reason=INVALID_MODEL_ID");
    expect(parsed.message).not.toContain("request_id=");
    expect(parsed.kiroReason).toBe("INVALID_MODEL_ID");
  });

  it("works with a reason but no __type", () => {
    const body = { message: "nope", reason: "THROTTLED" };
    const parsed = executor.parseError(kiroError(body), JSON.stringify(body));
    expect(parsed.message).toContain("nope");
    expect(parsed.message).toContain("reason=THROTTLED");
    expect(parsed.kiroReason).toBe("THROTTLED");
  });

  it("falls back cleanly on a non-JSON body", () => {
    const parsed = executor.parseError(kiroError({}, null), "<html>502</html>");
    expect(parsed.status).toBe(400);
    expect(parsed.kiroReason).toBeUndefined();
    expect(typeof parsed.message).toBe("string");
  });

  it("falls back cleanly on an empty body", () => {
    const parsed = executor.parseError(kiroError({}, null), "");
    expect(parsed.status).toBe(400);
    expect(parsed.message).toBeTruthy();
  });
});

describe("kiro parseError — reached through parseUpstreamError", () => {
  it("the message shown to the caller carries the kiro reason", async () => {
    const out = await parseUpstreamError(kiroError(VALIDATION), executor);
    expect(out.statusCode).toBe(400);
    expect(out.message).toContain("Invalid model ID");
    expect(out.message).toContain("INVALID_MODEL_ID");
  });

  it("does not crash if the executor has no parseError", async () => {
    const out = await parseUpstreamError(kiroError(VALIDATION), null);
    expect(out.statusCode).toBe(400);
    expect(out.message).toContain("Invalid model ID");
  });
});
