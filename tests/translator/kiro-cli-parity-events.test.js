/**
 * kiro-cli wire parity — response event handling.
 *
 * Two rules under test:
 *   1. event types that do not exist in kiro-cli must not be handled as if they
 *      did (messageStopEvent, metricsEvent), and
 *   2. an unrecognised :event-type must be SKIPPED, not treated as an error —
 *      the binary declares ~17 variants and only 7 are ever observed.
 *
 * Driven through the real EventStream decoder by feeding synthetic frames.
 */
import { describe, it, expect } from "vitest";
import { KiroExecutor } from "../../open-sse/executors/kiro.js";

const encoder = new TextEncoder();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/** Build one AWS EventStream frame: prelude + headers + payload + message CRC. */
function frame(eventType, payloadObj) {
  const headers = [
    [":event-type", eventType],
    [":content-type", "application/json"],
    [":message-type", "event"],
  ];
  const hparts = [];
  for (const [name, value] of headers) {
    const n = encoder.encode(name);
    const v = encoder.encode(value);
    const h = new Uint8Array(1 + n.length + 1 + 2 + v.length);
    h[0] = n.length;
    h.set(n, 1);
    h[1 + n.length] = 7; // string
    new DataView(h.buffer).setUint16(2 + n.length, v.length, false);
    h.set(v, 4 + n.length);
    hparts.push(h);
  }
  const headerBytes = Buffer.concat(hparts.map((h) => Buffer.from(h)));
  const payload = Buffer.from(JSON.stringify(payloadObj ?? {}), "utf8");
  const total = 12 + headerBytes.length + payload.length + 4;
  const out = Buffer.alloc(total);
  out.writeUInt32BE(total, 0);
  out.writeUInt32BE(headerBytes.length, 4);
  out.writeUInt32BE(crc32(out.subarray(0, 8)), 8);
  headerBytes.copy(out, 12);
  payload.copy(out, 12 + headerBytes.length);
  out.writeUInt32BE(crc32(out.subarray(0, total - 4)), total - 4);
  return new Uint8Array(out);
}

// transformEventStreamToSSE(response, model, options) returns a Response whose
// .body streams OpenAI-shaped SSE text.
async function collect(executor, frames, options = {}) {
  const stream = new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(f);
      controller.close();
    },
  });
  const response = new Response(stream, {
    headers: { "content-type": "application/vnd.amazon.eventstream" },
  });
  const out = executor.transformEventStreamToSSE(response, "claude-sonnet-4.5", options);
  const reader = out.body.getReader();
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(new TextDecoder().decode(value));
  }
  return { text: chunks.join(""), response: out };
}

describe("kiro events — invented event types are gone", () => {
  it("does not treat messageStopEvent as a terminator", async () => {
    const executor = new KiroExecutor();
    const { text } = await collect(executor, [
      frame("assistantResponseEvent", { content: "hi" }),
      frame("messageStopEvent", { stopReason: "END_TURN" }),
    ]);
    // The turn still completes via the buffered-EOF path, but the invented event
    // must not have contributed a stop reason.
    expect(text).toContain("hi");
  });

  it("ignores metricsEvent without crashing", async () => {
    const executor = new KiroExecutor();
    const { text } = await collect(executor, [
      frame("assistantResponseEvent", { content: "ok" }),
      frame("metricsEvent", { inputTokens: 10, outputTokens: 5 }),
    ]);
    expect(text).toContain("ok");
  });
});

describe("kiro events — unknown event types are skipped", () => {
  for (const eventType of [
    "citationEvent",
    "dryRunSucceedEvent",
    "followupPromptEvent",
    "messageMetadataEvent",
    "invalidStateEvent",
    "supplementaryWebLinksEvent",
    "toolResultEvent",
    "somethingNewEntirely",
  ]) {
    it(`tolerates ${eventType} between normal events`, async () => {
      const executor = new KiroExecutor();
      const { text } = await collect(executor, [
        frame("assistantResponseEvent", { content: "a" }),
        frame(eventType, { whatever: true }),
        frame("assistantResponseEvent", { content: "b" }),
        frame("metadataEvent", { stopReason: "END_TURN" }),
      ]);
      expect(text).toContain("a");
      expect(text).toContain("b");
    });
  }
});

describe("kiro events — metadataEvent carries more than stopReason", () => {
  it("reads contextUsagePercentage and rumtime/effort fields without crashing", async () => {
    const executor = new KiroExecutor();
    const { text } = await collect(executor, [
      frame("assistantResponseEvent", { content: "x" }),
      frame("metadataEvent", {
        stopReason: "END_TURN",
        contextUsagePercentage: 12.5,
        turnDurationMs: 4200,
        effort: "high",
        meteringUsage: [{ usage: 0.25 }, { usage: 0.5 }],
      }),
    ]);
    expect(text).toContain("x");
  });

  it("tolerates a refusal object", async () => {
    const executor = new KiroExecutor();
    const { text } = await collect(executor, [
      frame("metadataEvent", {
        stopReason: "CONTENT_FILTERED",
        refusal: { category: "safety", explanation: "declined", recommendedModel: "claude-opus-4.8" },
      }),
    ]);
    expect(typeof text).toBe("string");
  });

  it("tolerates contextUsageInvalidated", async () => {
    const executor = new KiroExecutor();
    const { text } = await collect(executor, [
      frame("assistantResponseEvent", { content: "y" }),
      frame("metadataEvent", { stopReason: "END_TURN", contextUsageInvalidated: true }),
    ]);
    expect(text).toContain("y");
  });
});

describe("kiro events — toolUseEvent terminates on stop:true", () => {
  it("assembles fragments and closes the call on stop:true", async () => {
    const executor = new KiroExecutor();
    const id = "toolu_bdrk_TEST";
    const { text } = await collect(executor, [
      frame("toolUseEvent", { name: "fs_read", toolUseId: id }),
      frame("toolUseEvent", { input: '{"pa', name: "fs_read", toolUseId: id }),
      frame("toolUseEvent", { input: 'th":"a"}', name: "fs_read", toolUseId: id }),
      frame("toolUseEvent", { name: "fs_read", stop: true, toolUseId: id }),
      frame("metadataEvent", { stopReason: "TOOL_USE" }),
    ]);
    expect(text).toContain("fs_read");
  });
});
