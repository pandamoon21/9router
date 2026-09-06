// CodeBuddy (cn + intl) upstream is stream-only and ignores/breaks on
// response_format (models answer in prose when it is present). transformRequest
// must drop response_format and mirror the schema/directive into the LAST user
// message — the only lever these models follow.
import { describe, it, expect } from "vitest";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";

const SCHEMA = {
  type: "object",
  properties: { what: { type: "string" } },
  required: ["what"],
};

function makeBody() {
  return {
    model: "glm-5.2",
    stream: false,
    messages: [
      { role: "system", content: "Extract facts." },
      { role: "user", content: "Alice works at Google." },
    ],
  };
}

describe("CodeBuddy response_format enforcement (json_schema)", () => {
  const cn = new CodeBuddyExecutor();

  it("drops response_format and injects schema into last user message", () => {
    const body = { ...makeBody(), response_format: { type: "json_schema", json_schema: { name: "facts", schema: SCHEMA } } };
    const out = cn.transformRequest("glm-5.2", body, false, {});
    expect(out.response_format).toBeUndefined();
    expect(out.stream).toBe(true);
    const lastUser = out.messages[out.messages.length - 1];
    expect(lastUser.content).toContain("You must respond with valid JSON matching this schema:");
    expect(lastUser.content).toContain('"required"');
  });

  it("appends directive to last text part when content is typed blocks", () => {
    const body = {
      ...makeBody(),
      messages: [
        { role: "system", content: "Extract facts." },
        { role: "user", content: [{ type: "text", text: "Alice works at Google." }] },
      ],
      response_format: { type: "json_schema", json_schema: { schema: SCHEMA } },
    };
    const out = cn.transformRequest("glm-5.2", body, false, {});
    const lastUser = out.messages[out.messages.length - 1];
    expect(Array.isArray(lastUser.content)).toBe(true);
    const text = lastUser.content.map((p) => p.text).join("");
    expect(text).toContain("Alice works at Google.");
    expect(text).toContain("You must respond with valid JSON matching this schema:");
  });

  it("json_object drops response_format and injects plain JSON directive", () => {
    const body = { ...makeBody(), response_format: { type: "json_object" } };
    const out = cn.transformRequest("glm-5.2", body, false, {});
    expect(out.response_format).toBeUndefined();
    expect(out.messages[out.messages.length - 1].content).toContain("Respond only in valid JSON.");
  });

  it("leaves body untouched when no response_format", () => {
    const body = makeBody();
    const out = cn.transformRequest("glm-5.2", body, false, {});
    expect(out.response_format).toBeUndefined();
    expect(out.messages[out.messages.length - 1].content).toBe("Alice works at Google.");
  });
});

describe("CodeBuddyIntl response_format enforcement", () => {
  const intl = new CodeBuddyIntlExecutor();

  it("drops response_format and injects schema before rebuilding typed messages", () => {
    const body = {
      ...makeBody(),
      model: "glm-5.2",
      response_format: { type: "json_schema", json_schema: { schema: SCHEMA } },
    };
    const out = intl.transformRequest("glm-5.2", body, false, {});
    expect(out.response_format).toBeUndefined();
    expect(out.stream).toBe(true);
    const lastUser = out.messages[out.messages.length - 1];
    expect(lastUser.role).toBe("user");
    expect(Array.isArray(lastUser.content)).toBe(true);
    const text = lastUser.content.map((p) => p.text).join("");
    expect(text).toContain("You must respond with valid JSON matching this schema:");
    expect(text).toContain("Alice works at Google.");
  });
});
