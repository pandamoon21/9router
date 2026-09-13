/**
 * kiro-cli wire parity — per-model reasoning effort.
 *
 * Effort is not one field. The live catalog's additionalModelRequestFieldsSchema
 * (captured 2026-09-13) advertises TWO shapes, keyed off the model family:
 *
 *   Claude >=4.6  -> additionalModelRequestFields.output_config.effort
 *                    enum [low, medium, high, xhigh, max]   (default high)
 *   GPT-5.6       -> additionalModelRequestFields.reasoning.effort
 *                    enum [none, low, medium, high, xhigh, max]
 *   everything else -> no additionalModelRequestFields at all
 *
 * `xhigh` and `max` are real wire values. Collapsing them into `high` sends a
 * request kiro-cli never sends; so does dropping GPT's `none`.
 */
import { describe, it, expect } from "vitest";
import {
  extractKiroEffortLevel,
  resolveKiroEffortPath,
  supportsKiroAdditionalModelRequestFields,
  buildKiroAdditionalModelRequestFieldsForModel,
  usesKiroNativeGptEffort,
} from "../../open-sse/config/kiroConstants.js";

const CLAUDE_ENUM = ["low", "medium", "high", "xhigh", "max"];
const GPT_ENUM = ["none", "low", "medium", "high", "xhigh", "max"];

describe("kiro effort — Claude path passes every advertised level through", () => {
  for (const level of CLAUDE_ENUM) {
    it(`output_config.effort=${level} survives unchanged`, () => {
      expect(extractKiroEffortLevel({ output_config: { effort: level } })).toBe(level);
    });
  }

  it("xhigh is not collapsed into high", () => {
    expect(extractKiroEffortLevel({ output_config: { effort: "xhigh" } })).not.toBe("high");
  });

  it("max is not collapsed into high", () => {
    expect(extractKiroEffortLevel({ output_config: { effort: "max" } })).not.toBe("high");
  });

  it("reads the same value from every caller-side spelling", () => {
    for (const body of [
      { output_config: { effort: "xhigh" } },
      { reasoning_effort: "xhigh" },
      { reasoning: { effort: "xhigh" } },
    ]) {
      expect(extractKiroEffortLevel(body)).toBe("xhigh");
    }
  });

  it("treats explicit no-reasoning aliases as absent", () => {
    for (const value of ["none", "off", "disabled", "NONE", "Off"]) {
      expect(extractKiroEffortLevel({ output_config: { effort: value } })).toBeNull();
    }
  });

  it("rejects values outside the captured enum", () => {
    for (const value of ["ultra", "minimal", "1", ""]) {
      expect(extractKiroEffortLevel({ output_config: { effort: value } })).toBeNull();
    }
  });

  it("is case-insensitive", () => {
    expect(extractKiroEffortLevel({ output_config: { effort: "XHIGH" } })).toBe("xhigh");
  });
});

describe("kiro effort — GPT path keeps the advertised none", () => {
  it("passes none through when routed at reasoning", () => {
    const body = { reasoning: { effort: "none" } };
    expect(usesKiroNativeGptEffort(body, "gpt-5.6-sol")).toBe(true);
    expect(buildKiroAdditionalModelRequestFieldsForModel(body, "gpt-5.6-sol")).toEqual({
      reasoning: { effort: "none" },
    });
  });

  for (const level of GPT_ENUM) {
    it(`gpt-5.6-sol accepts ${level}`, () => {
      const fields = buildKiroAdditionalModelRequestFieldsForModel(
        { reasoning: { effort: level } },
        "gpt-5.6-sol"
      );
      expect(fields).toEqual({ reasoning: { effort: level } });
    });
  }

  it("does not invent a thinking block on the GPT path", () => {
    const fields = buildKiroAdditionalModelRequestFieldsForModel(
      { reasoning: { effort: "high" } },
      "gpt-5.6-terra"
    );
    expect(fields.thinking).toBeUndefined();
    expect(fields.output_config).toBeUndefined();
  });
});

describe("kiro effort — path selection against the captured catalog", () => {
  it("routes Claude >=4.6 to output_config", () => {
    for (const model of [
      "claude-opus-4.6",
      "claude-opus-4.7",
      "claude-opus-4.8",
      "claude-sonnet-4.6",
      "claude-opus-5",
      "claude-sonnet-5",
    ]) {
      expect(resolveKiroEffortPath(model)).toBe("output_config");
    }
  });

  it("routes GPT-5.6 to reasoning", () => {
    for (const model of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6"]) {
      expect(resolveKiroEffortPath(model)).toBe("reasoning");
    }
  });

  it("sends no additionalModelRequestFields for legacy Claude", () => {
    for (const model of ["claude-sonnet-4.5", "claude-sonnet-4", "claude-3.7-sonnet"]) {
      expect(resolveKiroEffortPath(model)).toBeNull();
      expect(supportsKiroAdditionalModelRequestFields(model)).toBe(false);
    }
  });

  it("builds the full Claude field set", () => {
    expect(
      buildKiroAdditionalModelRequestFieldsForModel(
        { output_config: { effort: "xhigh" } },
        "claude-opus-4.7"
      )
    ).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "xhigh" },
    });
  });

  it("returns undefined when the model has no schema at all", () => {
    expect(
      buildKiroAdditionalModelRequestFieldsForModel(
        { output_config: { effort: "high" } },
        "claude-sonnet-4.5"
      )
    ).toBeUndefined();
  });

  it("drops xhigh on the 4.6 generation, which the catalog says stops at max", () => {
    expect(
      buildKiroAdditionalModelRequestFieldsForModel(
        { output_config: { effort: "xhigh" } },
        "claude-opus-4.6"
      )
    ).toBeUndefined();
    expect(
      buildKiroAdditionalModelRequestFieldsForModel(
        { output_config: { effort: "max" } },
        "claude-opus-4.6"
      )
    ).toEqual({
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "max" },
    });
  });

  it("keeps xhigh on every Claude generation after 4.6", () => {
    for (const model of ["claude-opus-4.7", "claude-opus-4.8", "claude-opus-5", "claude-sonnet-5"]) {
      expect(
        buildKiroAdditionalModelRequestFieldsForModel(
          { output_config: { effort: "xhigh" } },
          model
        ).output_config.effort
      ).toBe("xhigh");
    }
  });
});
