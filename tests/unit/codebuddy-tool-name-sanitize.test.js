// CodeBuddy CN/Intl model validators reject tool shapes the plain OpenAI API
// accepts (measured against copilot.tencent.com on 2026-09-29):
//   - Kimi k3-1 / k2.7 and DeepSeek reject a tool name that does not match
//     ^[a-zA-Z_][a-zA-Z0-9_-]*$ with code 11152 ("tool name is invalid or
//     duplicated"). A leading digit is the common trigger.
//   - DeepSeek v4-pro / v4.1-flash reject a non-trivial parameter schema carrying
//     a root `$schema` marker with code 11129.
// transformRequest must normalise both and restore the client's tool spelling on
// the response leg via the recorded rename map.
import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";
import { takeRenamedToolNames, restoreToolNames } from "../../open-sse/utils/opencodeFingerprint.js";

function tool(name, params = { type: "object", properties: { a: { type: "string" } } }) {
  return { type: "function", function: { name, description: "d", parameters: params } };
}

function makeBody(overrides = {}) {
  return {
    model: "kimi-k3-1",
    stream: true,
    messages: [{ role: "user", content: "hi" }],
    ...overrides,
  };
}

const cn = new CodeBuddyExecutor();
const intl = new CodeBuddyIntlExecutor();

describe("CodeBuddy tool-name sanitisation (11152)", () => {
  it("prefixes a digit-leading tool name and records the rename", () => {
    const body = makeBody({ tools: [tool("9remote_openArtifact"), tool("bash")] });
    const out = cn.transformRequest("kimi-k3-1", body, false, {});
    const names = out.tools.map((t) => t.function.name);
    expect(names).toContain("_9remote_openArtifact");
    expect(names).toContain("bash");

    // The map is keyed on the original body (chatCore's translatedBody), which the
    // executor may have cloned into a new object on the way out.
    const map = takeRenamedToolNames(body);
    expect(map.get("_9remote_openArtifact")).toBe("9remote_openArtifact");
  });

  it("leaves already-valid names untouched and records no rename", () => {
    const body = makeBody({ tools: [tool("bash"), tool("mcp__server__tool"), tool("a-b")] });
    const out = cn.transformRequest("kimi-k3-1", body, false, {});
    expect(out.tools.map((t) => t.function.name)).toEqual(["bash", "mcp__server__tool", "a-b"]);
    expect(takeRenamedToolNames(out)).toBeNull();
  });

  it("rewrites tool_choice and message history references", () => {
    const body = makeBody({
      tools: [tool("9remote_openArtifact")],
      tool_choice: { type: "function", function: { name: "9remote_openArtifact" } },
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "9remote_openArtifact", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "c1", content: "ok" },
      ],
    });
    const out = cn.transformRequest("kimi-k3-1", body, false, {});
    // tool_choice flattened to a string and pointed at the sent (sanitised) name
    expect(out.tool_choice).toBe("_9remote_openArtifact");
    expect(out.messages[1].tool_calls[0].function.name).toBe("_9remote_openArtifact");
  });

  it("avoids collisions when the sanitised name already exists", () => {
    const body = makeBody({ tools: [tool("_9remote"), tool("9remote")] });
    const out = cn.transformRequest("kimi-k3-1", body, false, {});
    expect(new Set(out.tools.map((t) => t.function.name)).size).toBe(2);
  });

  it("restores the client spelling in a streamed tool call", () => {
    const body = makeBody({ tools: [tool("9remote_openArtifact")] });
    cn.transformRequest("kimi-k3-1", body, false, {});
    const map = takeRenamedToolNames(body);
    const restored = restoreToolNames(
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "_9remote_openArtifact", arguments: "{}" } }] } }] },
      map,
    );
    expect(restored.choices[0].delta.tool_calls[0].function.name).toBe("9remote_openArtifact");
  });
});

describe("CodeBuddy schema-marker stripping (11129)", () => {
  it("drops $schema from the parameters root and nested nodes", () => {
    const params = {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { runId: { type: "string", $schema: "http://json-schema.org/draft-07/schema#" } },
    };
    const body = makeBody({ tools: [tool("exa_agent_run", params)] });
    const out = cn.transformRequest("deepseek-v4-pro", body, false, {});
    expect(out.tools[0].function.parameters.$schema).toBeUndefined();
    expect(out.tools[0].function.parameters.properties.runId.$schema).toBeUndefined();
    // non-schema keys survive
    expect(out.tools[0].function.parameters.properties.runId.type).toBe("string");
  });

  it("applies the same normalisation on codebuddy-intl", () => {
    const body = makeBody({ tools: [tool("9remote_openArtifact", { $schema: "x", type: "object", properties: {} })] });
    const out = intl.transformRequest("kimi-k3-1", body, false, {});
    expect(out.tools[0].function.name).toBe("_9remote_openArtifact");
    expect(out.tools[0].function.parameters.$schema).toBeUndefined();
  });

  it("is a no-op when there are no tools", () => {
    const out = cn.transformRequest("kimi-k3-1", makeBody(), false, {});
    expect(out.tools).toBeUndefined();
  });
});

describe("CodeBuddy tool_choice flattening (11101)", () => {
  it("flattens the OpenAI object form to a bare name string", () => {
    const body = makeBody({ tools: [tool("bash")], tool_choice: { type: "function", function: { name: "bash" } } });
    const out = cn.transformRequest("glm-5.2", body, false, {});
    expect(out.tool_choice).toBe("bash");
  });

  it("maps Claude-native auto/tool choices to strings", () => {
    const auto = cn.transformRequest("glm-5.2", makeBody({ tools: [tool("bash")], tool_choice: { type: "auto" } }), false, {});
    expect(auto.tool_choice).toBe("auto");
    const forced = cn.transformRequest("glm-5.2", makeBody({ tools: [tool("bash")], tool_choice: { type: "tool", name: "bash" } }), false, {});
    expect(forced.tool_choice).toBe("bash");
  });

  it("leaves an already-string tool_choice untouched", () => {
    const out = cn.transformRequest("glm-5.2", makeBody({ tools: [tool("bash")], tool_choice: "required" }), false, {});
    expect(out.tool_choice).toBe("required");
  });

  it("applies on codebuddy-intl too", () => {
    const out = intl.transformRequest("glm-5.2", makeBody({ tools: [tool("bash")], tool_choice: { type: "function", function: { name: "bash" } } }), false, {});
    expect(out.tool_choice).toBe("bash");
  });
});
