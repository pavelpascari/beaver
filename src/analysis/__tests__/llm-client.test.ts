import { describe, it, expect } from "vitest";
import { parseJsonFromLLM, LLMParseError } from "../llm-client.js";

describe("parseJsonFromLLM", () => {
  it("parses clean JSON", () => {
    const out = parseJsonFromLLM<{ a: number }>('{"a": 1}');
    expect(out.a).toBe(1);
  });

  it("strips ```json code fences", () => {
    const fenced = "```json\n{\"a\": 2}\n```";
    const out = parseJsonFromLLM<{ a: number }>(fenced);
    expect(out.a).toBe(2);
  });

  it("strips plain ``` fences", () => {
    const fenced = "```\n{\"a\": 3}\n```";
    const out = parseJsonFromLLM<{ a: number }>(fenced);
    expect(out.a).toBe(3);
  });

  it("extracts JSON embedded in prose", () => {
    const msg =
      "Sure, here's the analysis:\n{\"a\": 4, \"b\": \"hi\"}\nLet me know!";
    const out = parseJsonFromLLM<{ a: number; b: string }>(msg);
    expect(out.a).toBe(4);
    expect(out.b).toBe("hi");
  });

  it("handles nested braces correctly", () => {
    const msg = `{"outer": {"inner": {"deep": 1}}}`;
    const out = parseJsonFromLLM<{ outer: { inner: { deep: number } } }>(msg);
    expect(out.outer.inner.deep).toBe(1);
  });

  it("tolerates braces inside strings", () => {
    const msg = `{"text": "contains } brace"}`;
    const out = parseJsonFromLLM<{ text: string }>(msg);
    expect(out.text).toBe("contains } brace");
  });

  it("throws LLMParseError on unrecoverable input", () => {
    expect(() => parseJsonFromLLM("definitely not json")).toThrow(LLMParseError);
  });
});
