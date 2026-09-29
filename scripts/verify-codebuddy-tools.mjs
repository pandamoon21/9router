// End-to-end check against a running 9router (default :20140).
// Verifies the CodeBuddy tool-shape fixes with a real 365-tool payload:
//   11152 — digit-leading tool names rejected by Kimi/DeepSeek
//   11129 — `$schema` on non-trivial parameter schemas rejected by DeepSeek
//   11101 — object tool_choice rejected by the gateway
//   round trip — the client must get its own tool-name spelling back
//
//   node scripts/verify-codebuddy-tools.mjs            # :20140
//   node scripts/verify-codebuddy-tools.mjs 20128      # custom port
const PORT = process.argv[2] || "20140";
const KEY = process.env.NINE_KEY || "sk-559abd617ad2b339-vspvnx-2da0cac7";
const BASE = `http://127.0.0.1:${PORT}/v1/chat/completions`;

const tool = (name, params = { type: "object", properties: { a: { type: "string" } } }) =>
  ({ type: "function", function: { name, description: "d", parameters: params } });

// A payload mirroring a real opencode/codex tool set: many tools, illegal names,
// $schema markers and an object tool_choice.
function bigPayload() {
  const tools = [];
  for (let i = 0; i < 360; i++) tools.push(tool(`mcp_srv${i % 7}_tool_${i}`));
  tools.push(tool("9remote_openArtifact", { $schema: "http://json-schema.org/draft-07/schema#", type: "object", properties: { path: { type: "string" } }, required: ["path"] }));
  tools.push(tool("exa_agent_run", { type: "object", properties: { runId: { type: "string", pattern: "^agent\\_run\\_" } }, $schema: "http://json-schema.org/draft-07/schema#" }));
  return {
    model: "cbcn/glm-5.2",
    stream: false,
    messages: [{ role: "user", content: "reply with the single word OK" }],
    tools,
    tool_choice: { type: "function", function: { name: "9remote_openArtifact" } },
  };
}

async function post(payload) {
  const r = await fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` }, body: JSON.stringify(payload) });
  return { status: r.status, body: await r.text() };
}

async function main() {
  const models = ["kimi-k3-1", "kimi-k2.7", "deepseek-v4-pro", "deepseek-v4.1-flash", "glm-5.2", "glm-5.3", "hy4-preview", "minimax-m3"];
  let fails = 0;

  console.log(`\n== ${BASE} — 362-tool payload with illegal names + $schema + object tool_choice ==`);
  for (const m of models) {
    const { status, body } = await post({ ...bigPayload(), model: `cbcn/${m}` });
    const ok = status === 200;
    if (!ok) fails++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${m.padEnd(20)} ${status} ${ok ? "" : body.slice(0, 140)}`);
  }

  console.log(`\n== tool-name round trip (client must see its own spelling) ==`);
  const rt = {
    model: "cbcn/glm-5.2",
    stream: false,
    messages: [{ role: "user", content: "Call the 9remote_openArtifact tool with path=/tmp/x now, no prose." }],
    tools: [tool("9remote_openArtifact", { type: "object", properties: { path: { type: "string" } }, required: ["path"] })],
    tool_choice: { type: "function", function: { name: "9remote_openArtifact" } },
  };
  const { status, body } = await post(rt);
  const name = JSON.parse(body)?.choices?.[0]?.message?.tool_calls?.[0]?.function?.name;
  const okName = name === "9remote_openArtifact";
  if (!okName) fails++;
  console.log(`  ${okName ? "PASS" : "FAIL"}  returned tool name = ${JSON.stringify(name)} (want "9remote_openArtifact")`);

  console.log(`\n${fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
