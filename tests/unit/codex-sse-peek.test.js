import { describe, expect, it } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function makeStreamFromChunks(chunks) {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
}

async function readAll(stream) {
  const reader = stream.getReader();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

// Upstream renamed the SSE peek to `_peekSseTransientError` (it now also
// detects account-capacity fallbacks). The behavior these tests pin down is
// unchanged: a clean stream must be re-assembled byte-for-byte with no
// truncation, and an overloaded prefix must be matched without a replacement.
describe("CodexExecutor _peekSseTransientError", () => {
  it("forwards a clean SSE stream byte-for-byte without duplicating or dropping chunks", async () => {
    const chunks = [
      "event: response.created\ndata: {\"id\":\"r_1\"}\n\n",
      "event: response.output_text.delta\ndata: {\"delta\":\"Halo \"}\n\n",
      "event: response.output_text.delta\ndata: {\"delta\":\"dunia\"}\n\n",
      "event: response.completed\ndata: {\"id\":\"r_1\"}\n\n",
    ];
    const expected = chunks.join("");

    const executor = new CodexExecutor();
    const response = new Response(makeStreamFromChunks(chunks), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.matched).toBeNull();
    expect(peek.replacementBody).toBeTruthy();

    const text = await readAll(peek.replacementBody);
    expect(text).toBe(expected);
    expect(text.length).toBe(expected.length);
  });

  it("preserves output across many small chunks (no truncation like Bac Sek P L)", async () => {
    const words = ["Background", "Sekarang", "Process", "Loading", "Streaming", "Output"];
    const chunks = words.map((w) => `event: response.output_text.delta\ndata: {\"delta\":\"${w} \"}\n\n`);
    const expected = chunks.join("");

    const executor = new CodexExecutor();
    const response = new Response(makeStreamFromChunks(chunks), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.matched).toBeNull();
    const text = await readAll(peek.replacementBody);
    expect(text).toBe(expected);
    for (const w of words) expect(text).toContain(w);
  });

  it("detects server_is_overloaded in the prefix and returns no replacement body", async () => {
    const chunks = [
      "event: response.created\ndata: {\"id\":\"r_1\"}\n\n",
      "event: error\ndata: {\"type\":\"server_is_overloaded\",\"message\":\"upstream busy\"}\n\n",
    ];

    const executor = new CodexExecutor();
    const response = new Response(makeStreamFromChunks(chunks), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.matched).toBe("server_is_overloaded");
    expect(peek.replacementBody).toBeNull();
  });

  it("handles a body that completes entirely within the peek window", async () => {
    const chunks = ["event: response.completed\ndata: {\"id\":\"r_1\"}\n\n"];
    const expected = chunks.join("");

    const executor = new CodexExecutor();
    const response = new Response(makeStreamFromChunks(chunks), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const peek = await executor._peekSseTransientError(response);
    expect(peek.matched).toBeNull();
    const text = await readAll(peek.replacementBody);
    expect(text).toBe(expected);
  });

  it("returns inert result for non-OK responses", async () => {
    const executor = new CodexExecutor();
    const response = new Response("nope", { status: 500 });
    const peek = await executor._peekSseTransientError(response);
    expect(peek).toMatchObject({ matched: null, replacementBody: null });
  });
});
