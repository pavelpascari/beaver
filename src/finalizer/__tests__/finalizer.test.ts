import { describe, it, expect } from "vitest";
import { finalize } from "../finalizer.js";
import type { Session } from "../../types/session.js";
import type { SessionEvent } from "../../types/events.js";
import type { ChunkAnalysis } from "../../types/chunks.js";
import type { GitContext, Recommendation } from "../../types/report.js";
import type { LLMInsight } from "../../analysis/llm-insight.js";

function mkSession(): Session {
  return {
    id: "test",
    provider: "claude",
    messages: [
      {
        index: 0,
        role: "user",
        content: "Add a new API endpoint for listing widgets",
      },
      { index: 1, role: "assistant", content: "ok" },
    ],
    toolCalls: [],
    metadata: {
      totalMessages: 2,
      totalToolCalls: 0,
      model: "claude-sonnet-4-6",
    },
  };
}

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

function mkChunk(
  phase: ChunkAnalysis["phase"],
  eventCount = 5,
  frictions: ChunkAnalysis["frictionClassification"] = []
): ChunkAnalysis {
  return {
    phase,
    summary: `${phase} did stuff`,
    effortSignals: [],
    frictionClassification: frictions,
    patterns: [],
    eventCount,
  };
}

function mkGit(): GitContext {
  return { detected: false, type: "no_repo", repos: [] };
}

describe("finalize — heuristic-only mode", () => {
  it("always produces a friction score and expected-vs-observed", () => {
    const report = finalize(
      mkSession(),
      [mkChunk("exploration", 3), mkChunk("implementation", 2)],
      [mkEvent("file_read", { path: "a.ts" })],
      mkGit()
    );
    expect(report.frictionScore).toBeDefined();
    expect(typeof report.frictionScore.overall).toBe("number");
    expect(report.frictionScore.grade).toBeTruthy();
    expect(report.expectedVsObserved).toBeDefined();
    expect(report.expectedVsObserved.deltas.length).toBeGreaterThan(0);
    expect(report.metadata.analysisMode).toBe("heuristic");
    expect(report.headline).toBeTruthy();
  });

  it("builds heuristic recommendations with targets and success metrics", () => {
    const events = [
      ...Array.from({ length: 12 }, (_, i) =>
        mkEvent("file_read", { path: `file${i}.ts` }, i)
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        mkEvent("search", { query: `q${i}`, tool: "grep" }, i + 100)
      ),
    ];
    const report = finalize(
      mkSession(),
      [mkChunk("exploration", 18, ["discovery_friction", "retrieval_friction"])],
      events,
      mkGit()
    );
    const disc = report.recommendations.find(
      (r) => r.category === "discovery_friction"
    );
    expect(disc).toBeDefined();
    expect(disc?.successMetric).toBeTruthy();
    expect(disc?.targets?.length).toBeGreaterThan(0);
    expect(disc?.source).toBe("heuristic");
  });
});

describe("finalize — LLM-enriched (hybrid) mode", () => {
  it("marks mode as hybrid and includes LLM metadata", () => {
    const insight: LLMInsight = {
      headline: "A tight session with a sneaky search tax.",
      taskSummary:
        "The agent added a /widgets endpoint. Most work was concentrated in the handlers module.",
      taskComplexity: "small",
      expectedNarrative: "A well-run session would have been ~5 reads.",
      observedNarrative: "Observed overshot on searches.",
      biggestDivergence: "searches overshot by 6",
      primaryFriction: {
        category: "retrieval_friction",
        description: "Naming conventions in routes/ made grep noisy.",
        severity: "medium",
        evidence: ["12 searches for /widgets handlers"],
      },
      insightByPhase: [
        { phase: "exploration", insight: "Lots of grep churn in routes/." },
      ],
      recommendations: [
        {
          title: "Co-locate widgets handlers",
          description: "Move handler + types + tests together.",
          impact: "medium",
          effort: "low",
          category: "retrieval_friction",
          targets: ["routes/widgets.ts"],
          successMetric: "searches < 3 in next session",
          source: "llm",
        },
      ],
      tokensUsed: 1234,
      model: "claude-sonnet-4-6",
    };

    const report = finalize(
      mkSession(),
      [mkChunk("exploration", 10, ["retrieval_friction"])],
      [mkEvent("search", { query: "widget", tool: "grep" })],
      mkGit(),
      { llmInsight: insight, llmRequested: true }
    );

    expect(report.metadata.analysisMode).toBe("hybrid");
    expect(report.metadata.llmModel).toBe("claude-sonnet-4-6");
    expect(report.metadata.llmTokensUsed).toBe(1234);
    expect(report.metadata.llmFallback).toBe(false);
    expect(report.headline).toBe("A tight session with a sneaky search tax.");
    expect(report.taskSummary).toContain("widgets");
  });

  it("merges expected-vs-observed narratives from LLM", () => {
    const insight = makeMinimalInsight({
      expectedNarrative: "LLM-rewritten expected narrative.",
      observedNarrative: "LLM-rewritten observed narrative.",
      biggestDivergence: "LLM divergence",
      taskComplexity: "medium",
    });
    const report = finalize(mkSession(), [mkChunk("exploration", 3)], [], mkGit(), {
      llmInsight: insight,
      llmRequested: true,
    });
    expect(report.expectedVsObserved.expectedNarrative).toBe(
      "LLM-rewritten expected narrative."
    );
    expect(report.expectedVsObserved.observedNarrative).toBe(
      "LLM-rewritten observed narrative."
    );
    expect(report.expectedVsObserved.biggestDivergence).toBe("LLM divergence");
    expect(report.expectedVsObserved.taskComplexity).toBe("medium");
  });

  it("LLM primary friction overrides heuristic primary and demotes old primary", () => {
    const insight = makeMinimalInsight({
      primaryFriction: {
        category: "interpretation_friction",
        description: "LLM-identified spec ambiguity.",
        severity: "high",
        evidence: ["plan revision at message 5"],
      },
    });

    const report = finalize(
      mkSession(),
      [
        mkChunk("exploration", 5, ["discovery_friction"]),
        mkChunk("exploration", 5, ["discovery_friction"]),
      ],
      [],
      mkGit(),
      { llmInsight: insight, llmRequested: true }
    );

    expect(report.frictionAnalysis.primary.category).toBe(
      "interpretation_friction"
    );
    expect(
      report.frictionAnalysis.secondary.some((f) => f.category === "discovery_friction")
    ).toBe(true);
  });

  it("dedupes LLM + heuristic recommendations by title+category", () => {
    const insight = makeMinimalInsight({
      recommendations: [
        {
          title: "Add a CLAUDE.md or AGENTS.md file",
          description: "LLM version",
          impact: "high",
          effort: "low",
          category: "discovery_friction",
          source: "llm",
        },
      ],
    });
    const events = Array.from({ length: 12 }, (_, i) =>
      mkEvent("file_read", { path: `f${i}.ts` }, i)
    );
    const report = finalize(
      mkSession(),
      [mkChunk("exploration", 12, ["discovery_friction"])],
      events,
      mkGit(),
      { llmInsight: insight, llmRequested: true }
    );

    const matching = report.recommendations.filter(
      (r) => r.title.toLowerCase().includes("claude.md")
    );
    expect(matching.length).toBe(1);
    expect(matching[0].source).toBe("llm");
  });

  it("applies per-phase insights to matching chunks", () => {
    const insight = makeMinimalInsight({
      insightByPhase: [{ phase: "debugging", insight: "Trial-and-error was slow" }],
    });
    const report = finalize(
      mkSession(),
      [mkChunk("exploration", 3), mkChunk("debugging", 4)],
      [],
      mkGit(),
      { llmInsight: insight, llmRequested: true }
    );
    const dbg = report.chunks.find((c) => c.phase === "debugging");
    expect(dbg?.insight).toBe("Trial-and-error was slow");
    expect(dbg?.source).toBe("hybrid");
  });

  it("records llmFallback=true when requested but absent", () => {
    const report = finalize(mkSession(), [mkChunk("exploration", 3)], [], mkGit(), {
      llmRequested: true,
      llmFallbackReason: "Missing API key",
    });
    expect(report.metadata.llmFallback).toBe(true);
    expect(report.metadata.llmFallbackReason).toBe("Missing API key");
    expect(report.metadata.analysisMode).toBe("heuristic");
  });
});

// --- helpers ---

function makeMinimalInsight(overrides: Partial<LLMInsight>): LLMInsight {
  return {
    headline: "H",
    taskSummary: "T",
    insightByPhase: [],
    recommendations: [] as Recommendation[],
    tokensUsed: 100,
    model: "claude-sonnet-4-6",
    ...overrides,
  };
}
