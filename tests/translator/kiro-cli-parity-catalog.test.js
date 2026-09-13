/**
 * kiro-cli wire parity — catalog effort schema parsing.
 *
 * The fixtures below are the catalog lines captured verbatim from
 * ListAvailableModels (work/model_catalog.txt, 2026-09-14). They are the
 * authority for which models accept additionalModelRequestFields and which
 * effort levels each accepts.
 *
 * The last block is the important one: the hand-written model-id regex in
 * resolveKiroEffortPath must agree with the schema the server actually sends.
 * If they ever disagree, a request can carry effort fields Kiro rejects — a
 * 400 the regex alone would never predict.
 */
import { describe, it, expect } from "vitest";
import { parseKiroEffortSchema, kiroDefaultEffort } from "../../open-sse/services/kiroModels.js";
import { resolveKiroEffortPath } from "../../open-sse/config/kiroConstants.js";

// Verbatim catalog entries, trimmed to the schema + identity fields.
const CLAUDE_SCHEMA = (levels, def) => ({
  additionalModelRequestFieldsSchema: {
    type: "object",
    properties: {
      thinking: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["adaptive", "disabled"] },
          display: { type: "string", enum: ["summarized", "omitted"] },
        },
        required: ["type"],
      },
      output_config: { type: "object", properties: { effort: { type: "string", enum: levels, default: def } } },
      max_tokens: { type: "integer", minimum: 1024, maximum: 128000 },
    },
    additionalProperties: false,
  },
});

const GPT_SCHEMA = (levels, def) => ({
  additionalModelRequestFieldsSchema: {
    type: "object",
    properties: {
      reasoning: { type: "object", properties: { effort: { type: "string", enum: levels, default: def } } },
      max_tokens: { type: "integer", minimum: 1024, maximum: 128000 },
    },
    additionalProperties: false,
  },
});

const WIDE = ["low", "medium", "high", "xhigh", "max"];
const NARROW = ["low", "medium", "high", "max"];
const GPT_LEVELS = ["none", "low", "medium", "high", "xhigh", "max"];

// Every model the capture contains, with its schema (null = no schema sent).
const CATALOG = [
  ["auto", null],
  ["claude-opus-5", CLAUDE_SCHEMA(WIDE, "high")],
  ["claude-sonnet-5", CLAUDE_SCHEMA(WIDE, "high")],
  ["claude-opus-4.8", CLAUDE_SCHEMA(WIDE, "high")],
  ["gpt-5.6-sol", GPT_SCHEMA(GPT_LEVELS, "high")],
  ["gpt-5.6-terra", GPT_SCHEMA(GPT_LEVELS, "high")],
  ["gpt-5.6-luna", GPT_SCHEMA(GPT_LEVELS, "high")],
  ["claude-opus-4.7", CLAUDE_SCHEMA(WIDE, "xhigh")],
  ["claude-opus-4.6", CLAUDE_SCHEMA(NARROW, "high")],
  ["claude-sonnet-4.6", CLAUDE_SCHEMA(NARROW, "high")],
  ["claude-opus-4.5", null],
  ["claude-sonnet-4.5", null],
  ["claude-sonnet-4", null],
  ["claude-haiku-4.5", null],
  ["deepseek-3.2", null],
  ["minimax-m2.5", null],
  ["minimax-m2.1", null],
  ["glm-5", null],
  ["qwen3-coder-next", null],
];

describe("catalog effort schema — parsing", () => {
  it("reads the output_config path and its levels", () => {
    expect(parseKiroEffortSchema(CLAUDE_SCHEMA(WIDE, "xhigh"))).toEqual({
      path: "output_config",
      levels: WIDE,
      default: "xhigh",
    });
  });

  it("reads the reasoning path and its levels", () => {
    expect(parseKiroEffortSchema(GPT_SCHEMA(GPT_LEVELS, "high"))).toEqual({
      path: "reasoning",
      levels: GPT_LEVELS,
      default: "high",
    });
  });

  it("returns null when the entry carries no schema", () => {
    expect(parseKiroEffortSchema({ modelId: "claude-sonnet-4.5" })).toBeNull();
    expect(parseKiroEffortSchema({})).toBeNull();
    expect(parseKiroEffortSchema(null)).toBeNull();
  });

  it("returns null for a schema with no effort property", () => {
    const entry = {
      additionalModelRequestFieldsSchema: {
        type: "object",
        properties: { max_tokens: { type: "integer" } },
      },
    };
    expect(parseKiroEffortSchema(entry)).toBeNull();
  });

  it("takes the output_config path when a schema somehow carries both", () => {
    const both = {
      additionalModelRequestFieldsSchema: {
        properties: {
          reasoning: { properties: { effort: { enum: GPT_LEVELS } } },
          output_config: { properties: { effort: { enum: WIDE } } },
        },
      },
    };
    expect(parseKiroEffortSchema(both).path).toBe("output_config");
  });

  it("exposes the catalog default for supported models only", () => {
    expect(kiroDefaultEffort(CLAUDE_SCHEMA(WIDE, "xhigh"))).toBe("xhigh");
    expect(kiroDefaultEffort(GPT_SCHEMA(GPT_LEVELS, "high"))).toBe("high");
    expect(kiroDefaultEffort({ modelId: "glm-5" })).toBeNull();
  });

  it("a schema with an effort block but no default reports null", () => {
    const noDefault = {
      additionalModelRequestFieldsSchema: {
        properties: { output_config: { properties: { effort: { enum: WIDE } } } },
      },
    };
    expect(kiroDefaultEffort(noDefault)).toBeNull();
  });
});

describe("catalog vs the model-id regex — they must agree", () => {
  it.each(CATALOG)("%s paths agree with the captured schema", (modelId, entry) => {
    const fromSchema = entry ? parseKiroEffortSchema(entry).path : null;
    expect(resolveKiroEffortPath(modelId)).toBe(fromSchema);
  });

  it("the regex never claims support the catalog withholds", () => {
    for (const [modelId, entry] of CATALOG) {
      if (resolveKiroEffortPath(modelId) !== null) {
        expect(entry, `${modelId} has no schema but the regex says it does`).not.toBeNull();
      }
    }
  });

  it("no schema-bearing model is missed by the regex", () => {
    for (const [modelId, entry] of CATALOG) {
      if (entry !== null) {
        expect(resolveKiroEffortPath(modelId), `${modelId} has a schema but the regex skips it`).not.toBeNull();
      }
    }
  });
});
