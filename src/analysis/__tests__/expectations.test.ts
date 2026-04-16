import { describe, it, expect } from "vitest";
import {
  computeExpectedVsObserved,
  classifyComplexity,
} from "../expectations.js";
import type { Session } from "../../types/session.js";
import type { KeySignals } from "../../types/report.js";
import type { ChunkAnalysis } from "../../types/chunks.js";

function mkSession(firstUserMessage: string): Session {
  return {
    id: "test",
    provider: "claude",
    messages: [
      { index: 0, role: "user", content: firstUserMessage },
      { index: 1, role: "assistant", content: "ok" },
    ],
    toolCalls: [],
    metadata: {
      totalMessages: 2,
      totalToolCalls: 0,
    },
  };
}

function mkSignals(p: Partial<KeySignals> = {}): KeySignals {
  return {
    filesRead: 0,
    filesWritten: 0,
    searches: 0,
    edits: 0,
    retries: 0,
    testRuns: 0,
    commands: 0,
    uniqueFilesTouched: [],
    ...p,
  };
}

function mkChunk(phase: ChunkAnalysis["phase"], count: number): ChunkAnalysis {
  return {
    phase,
    summary: `${phase} chunk`,
    effortSignals: [],
    frictionClassification: [],
    patterns: [],
    eventCount: count,
  };
}

describe("classifyComplexity", () => {
  it("returns trivial for small keyword requests", () => {
    const s = mkSession("Fix a typo in the README");
    const c = classifyComplexity(s, mkSignals({ filesWritten: 1 }));
    expect(c).toBe("trivial");
  });

  it("returns large for sweeping refactor keywords with many writes", () => {
    const s = mkSession("Refactor the entire authentication subsystem");
    const c = classifyComplexity(
      s,
      mkSignals({ filesWritten: 10, uniqueFilesTouched: Array(15).fill("f.ts") })
    );
    expect(c).toBe("large");
  });

  it("falls back to observable size when no keywords match", () => {
    const s = mkSession("do something");
    const c = classifyComplexity(
      s,
      mkSignals({
        filesWritten: 3,
        uniqueFilesTouched: ["a.ts", "b.ts", "c.ts"],
      })
    );
    expect(c).toBe("small");
  });
});

describe("computeExpectedVsObserved", () => {
  it("reports 'on_target' when observed matches expected within tolerance", () => {
    const result = computeExpectedVsObserved({
      session: mkSession("small fix"),
      keySignals: mkSignals({
        filesRead: 2,
        filesWritten: 1,
        searches: 1,
        testRuns: 1,
        uniqueFilesTouched: ["a.ts", "b.ts"],
      }),
      chunkAnalyses: [mkChunk("implementation", 5)],
    });
    const reads = result.deltas.find((d) => d.metric === "file_reads");
    expect(reads?.direction).toBe("on_target");
    expect(result.taskComplexity).toBe("trivial");
  });

  it("flags 'over' when searches far exceed the baseline", () => {
    const result = computeExpectedVsObserved({
      session: mkSession("do something medium sized"),
      keySignals: mkSignals({
        filesRead: 20,
        searches: 25,
        filesWritten: 3,
        uniqueFilesTouched: Array.from({ length: 8 }, (_, i) => `f${i}`),
      }),
      chunkAnalyses: [mkChunk("exploration", 30), mkChunk("implementation", 5)],
    });
    const searches = result.deltas.find((d) => d.metric === "searches");
    expect(searches?.direction).toBe("over");
    expect(searches?.delta).toBeGreaterThan(0);
    expect(result.biggestDivergence).toBeDefined();
  });

  it("uses complexity override when provided", () => {
    const result = computeExpectedVsObserved({
      session: mkSession("trivial typo fix"),
      keySignals: mkSignals(),
      chunkAnalyses: [],
      complexityOverride: "large",
    });
    expect(result.taskComplexity).toBe("large");
    expect(result.expectedNarrative).toContain("large");
  });

  it("computes observed exploration share from chunks", () => {
    const result = computeExpectedVsObserved({
      session: mkSession("ambiguous"),
      keySignals: mkSignals(),
      chunkAnalyses: [
        mkChunk("exploration", 10),
        mkChunk("implementation", 10),
      ],
    });
    const share = result.deltas.find(
      (d) => d.metric === "exploration_share_pct"
    );
    expect(share?.observed).toBe(50);
  });

  it("gives a summary narrative even when nothing diverges", () => {
    const result = computeExpectedVsObserved({
      session: mkSession("small fix"),
      keySignals: mkSignals(),
      chunkAnalyses: [],
    });
    expect(result.expectedNarrative.length).toBeGreaterThan(0);
    expect(result.observedNarrative.length).toBeGreaterThan(0);
  });
});
