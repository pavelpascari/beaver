import { describe, it, expect } from "vitest";
import { parseEnvelope } from "../claude-cli-client.js";
import { LLMAPIError } from "../llm-client.js";

describe("parseEnvelope", () => {
  const goodEnvelope = JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: '{"headline": "ok"}',
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 200,
    },
  });

  it("extracts text and tokensUsed from a successful envelope", () => {
    const r = parseEnvelope(goodEnvelope, "claude-sonnet-4-6");
    expect(r.text).toBe('{"headline": "ok"}');
    expect(r.tokensUsed).toBe(100 + 50 + 10 + 200);
    expect(r.model).toBe("claude-sonnet-4-6");
  });

  it("trims surrounding whitespace from result", () => {
    const env = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "  hello  ",
    });
    expect(parseEnvelope(env, "m").text).toBe("hello");
  });

  it("throws on empty stdout", () => {
    expect(() => parseEnvelope("", "m")).toThrow(LLMAPIError);
    expect(() => parseEnvelope("   \n", "m")).toThrow(LLMAPIError);
  });

  it("throws on non-JSON stdout", () => {
    expect(() => parseEnvelope("not json at all", "m")).toThrow(LLMAPIError);
  });

  it("throws when envelope reports an error", () => {
    const errEnv = JSON.stringify({
      type: "result",
      subtype: "error",
      is_error: true,
      result: null,
    });
    expect(() => parseEnvelope(errEnv, "m")).toThrow(LLMAPIError);
  });

  it("throws when envelope is missing result text", () => {
    const noResult = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
    });
    expect(() => parseEnvelope(noResult, "m")).toThrow(LLMAPIError);
  });

  it("survives missing usage fields", () => {
    const env = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "ok",
    });
    const r = parseEnvelope(env, "m");
    expect(r.tokensUsed).toBe(0);
  });
});
