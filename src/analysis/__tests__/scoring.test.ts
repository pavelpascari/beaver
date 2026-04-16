import { describe, it, expect } from "vitest";
import { computeFrictionScore, gradeFromScore } from "../scoring.js";
import type { ChunkAnalysis } from "../../types/chunks.js";
import type { SessionEvent } from "../../types/events.js";
import type { KeySignals } from "../../types/report.js";

function mkEvent(
  type: SessionEvent["type"],
  data: Record<string, unknown> = {},
  idx = 0
): SessionEvent {
  return {
    type,
    index: idx,
    messageIndex: 0,
    data: data as SessionEvent["data"],
  };
}

function mkSignals(overrides: Partial<KeySignals> = {}): KeySignals {
  return {
    filesRead: 0,
    filesWritten: 0,
    searches: 0,
    edits: 0,
    retries: 0,
    testRuns: 0,
    commands: 0,
    uniqueFilesTouched: [],
    ...overrides,
  };
}

describe("computeFrictionScore", () => {
  it("returns a clean score of 0 for a quiet session", () => {
    const score = computeFrictionScore({
      chunkAnalyses: [],
      events: [],
      keySignals: mkSignals(),
    });
    expect(score.overall).toBe(0);
    expect(score.grade).toBe("A");
    expect(score.contributors).toHaveLength(0);
    expect(score.headline.toLowerCase()).toContain("clean");
  });

  it("scales overall score up with friction signals and caps at 100", () => {
    const events: SessionEvent[] = [
      ...Array.from({ length: 5 }, (_, i) => mkEvent("retry", {}, i)),
      ...Array.from({ length: 3 }, (_, i) =>
        mkEvent("plan_revision", { summary: "s" }, i + 10)
      ),
    ];
    const score = computeFrictionScore({
      chunkAnalyses: [],
      events,
      keySignals: mkSignals({
        filesRead: 30,
        searches: 15,
        retries: 5,
        testRuns: 10,
        uniqueFilesTouched: Array.from({ length: 25 }, (_, i) => `f${i}.ts`),
      }),
    });

    expect(score.overall).toBeGreaterThan(40);
    expect(score.overall).toBeLessThanOrEqual(100);
    expect(score.contributors.length).toBeGreaterThan(0);
    // Must be sorted by points desc.
    for (let i = 1; i < score.contributors.length; i++) {
      expect(score.contributors[i - 1].points).toBeGreaterThanOrEqual(
        score.contributors[i].points
      );
    }
  });

  it("attributes contributors to the correct friction categories", () => {
    const score = computeFrictionScore({
      chunkAnalyses: [],
      events: [mkEvent("plan_revision", { summary: "s" })],
      keySignals: mkSignals({
        filesRead: 12, // discovery
        searches: 10, // retrieval
        retries: 3, // tooling
        testRuns: 5, // verification
      }),
    });

    const cats = new Set(score.contributors.map((c) => c.category));
    expect(cats.has("discovery_friction")).toBe(true);
    expect(cats.has("retrieval_friction")).toBe(true);
    expect(cats.has("tooling_friction")).toBe(true);
    expect(cats.has("verification_friction")).toBe(true);
    expect(cats.has("interpretation_friction")).toBe(true);
  });

  it("rolls up per-category points", () => {
    const score = computeFrictionScore({
      chunkAnalyses: [],
      events: [],
      keySignals: mkSignals({
        searches: 10,
      }),
    });
    expect(score.byCategory.retrieval_friction).toBeGreaterThan(0);
  });

  it("respects rule caps so any single rule can't dominate", () => {
    // Absurd search count; retrieval_friction cap is 18.
    const score = computeFrictionScore({
      chunkAnalyses: [],
      events: [],
      keySignals: mkSignals({ searches: 10_000 }),
    });
    expect(score.byCategory.retrieval_friction).toBeLessThanOrEqual(18);
  });

  it("attributes repeated writes to tooling_friction", () => {
    // Two writes to the same path → 1 repeated file.
    const events: SessionEvent[] = [
      mkEvent("file_write", { path: "a.ts", isCreation: false }, 0),
      mkEvent("file_write", { path: "a.ts", isCreation: false }, 1),
    ];
    const score = computeFrictionScore({
      chunkAnalyses: [] as ChunkAnalysis[],
      events,
      keySignals: mkSignals({ filesWritten: 2 }),
    });
    const repeated = score.contributors.find((c) => c.signal === "repeated_edits");
    expect(repeated).toBeDefined();
    expect(repeated?.category).toBe("tooling_friction");
  });
});

describe("gradeFromScore", () => {
  it("maps score ranges to grades", () => {
    expect(gradeFromScore(0)).toBe("A");
    expect(gradeFromScore(9)).toBe("A");
    expect(gradeFromScore(10)).toBe("B");
    expect(gradeFromScore(24)).toBe("B");
    expect(gradeFromScore(25)).toBe("C");
    expect(gradeFromScore(44)).toBe("C");
    expect(gradeFromScore(45)).toBe("D");
    expect(gradeFromScore(69)).toBe("D");
    expect(gradeFromScore(70)).toBe("F");
    expect(gradeFromScore(100)).toBe("F");
  });
});
