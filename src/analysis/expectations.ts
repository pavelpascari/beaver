/**
 * Expected vs Observed reasoning.
 *
 * Produces a baseline of what a "well-run" session for a task of similar
 * complexity would look like, and diffs it against what actually happened.
 *
 * The heuristic baseline is deterministic (no LLM). Complexity is classified
 * from the first user message + observable session size. An LLM layer can
 * later override `taskComplexity` and enrich narratives.
 */

import type {
  ExpectedVsObserved,
  ExpectationDelta,
  TaskComplexity,
} from "../types/expectations.js";
import type { Session } from "../types/session.js";
import type { KeySignals } from "../types/report.js";
import type { ChunkAnalysis } from "../types/chunks.js";

export interface ExpectationsInput {
  session: Session;
  keySignals: KeySignals;
  chunkAnalyses: ChunkAnalysis[];
  /** Optional override (e.g. from LLM classification). */
  complexityOverride?: TaskComplexity;
}

interface Baseline {
  filesRead: number;
  filesWritten: number;
  searches: number;
  retries: number;
  testRuns: number;
  uniqueFilesTouched: number;
  explorationShare: number; // 0-100
}

const BASELINES: Record<TaskComplexity, Baseline> = {
  trivial: {
    filesRead: 2,
    filesWritten: 1,
    searches: 1,
    retries: 0,
    testRuns: 1,
    uniqueFilesTouched: 2,
    explorationShare: 20,
  },
  small: {
    filesRead: 5,
    filesWritten: 2,
    searches: 2,
    retries: 0,
    testRuns: 2,
    uniqueFilesTouched: 4,
    explorationShare: 30,
  },
  medium: {
    filesRead: 10,
    filesWritten: 4,
    searches: 4,
    retries: 1,
    testRuns: 3,
    uniqueFilesTouched: 8,
    explorationShare: 35,
  },
  large: {
    filesRead: 18,
    filesWritten: 8,
    searches: 6,
    retries: 2,
    testRuns: 5,
    uniqueFilesTouched: 14,
    explorationShare: 40,
  },
  unknown: {
    filesRead: 8,
    filesWritten: 3,
    searches: 3,
    retries: 1,
    testRuns: 2,
    uniqueFilesTouched: 6,
    explorationShare: 33,
  },
};

export function computeExpectedVsObserved(
  input: ExpectationsInput
): ExpectedVsObserved {
  const complexity =
    input.complexityOverride ?? classifyComplexity(input.session, input.keySignals);
  const baseline = BASELINES[complexity];

  const totalEvents = input.chunkAnalyses.reduce((s, c) => s + c.eventCount, 0);
  const explorationEvents = input.chunkAnalyses
    .filter((c) => c.phase === "exploration")
    .reduce((s, c) => s + c.eventCount, 0);
  const observedExplorationShare =
    totalEvents > 0 ? Math.round((explorationEvents / totalEvents) * 100) : 0;

  const k = input.keySignals;
  const deltas: ExpectationDelta[] = [
    makeDelta("file_reads", baseline.filesRead, k.filesRead, {
      over: "significantly more reads than expected — exploration went wide",
      under: "fewer reads than expected — the task was well-scoped or already familiar",
      on_target: "roughly as many reads as expected",
    }),
    makeDelta("file_writes", baseline.filesWritten, k.filesWritten, {
      over: "more writes than expected — change was larger or more iterative than needed",
      under: "fewer writes than expected — change was tightly scoped",
      on_target: "write count matches expectation",
    }),
    makeDelta("searches", baseline.searches, k.searches, {
      over: "more searches than expected — codebase was not discoverable for this task",
      under: "few searches — navigation was direct",
      on_target: "search count is unremarkable",
    }),
    makeDelta("retries", baseline.retries, k.retries, {
      over: "more retries than expected — tooling or edits were unreliable",
      under: "no unnecessary retries",
      on_target: "retry count is in line with expectations",
    }),
    makeDelta("test_runs", baseline.testRuns, k.testRuns, {
      over: "more test iterations than expected — feedback loop was noisy or slow",
      under: "fewer test runs than expected — verification may have been skipped or was trivial",
      on_target: "test run count matches expectation",
    }),
    makeDelta("unique_files_touched", baseline.uniqueFilesTouched, k.uniqueFilesTouched.length, {
      over: "touched more files than expected — change crossed more boundaries than needed",
      under: "touched fewer files than expected — change was well-localized",
      on_target: "file breadth matches expectation",
    }),
    makeDelta("exploration_share_pct", baseline.explorationShare, observedExplorationShare, {
      over: "more time spent exploring than expected — entry points were unclear",
      under: "less time exploring than expected — the agent moved to action quickly",
      on_target: "exploration share is balanced",
    }),
  ];

  const biggest = deltas
    .filter((d) => d.direction !== "on_target")
    .map((d) => ({ d, magnitude: relativeMagnitude(d) }))
    .sort((a, b) => b.magnitude - a.magnitude)[0];

  const expectedNarrative = buildExpectedNarrative(complexity, baseline);
  const observedNarrative = buildObservedNarrative(deltas, complexity);

  return {
    expectedNarrative,
    observedNarrative,
    deltas,
    biggestDivergence: biggest
      ? `${biggest.d.metric}: expected ~${biggest.d.expected}, observed ${biggest.d.observed} (${biggest.d.direction})`
      : undefined,
    taskComplexity: complexity,
  };
}

// --- Helpers ---

function makeDelta(
  metric: string,
  expected: number,
  observed: number,
  interpretations: Record<"over" | "under" | "on_target", string>
): ExpectationDelta {
  const delta = observed - expected;
  const direction = classifyDirection(expected, observed);
  return {
    metric,
    expected,
    observed,
    delta,
    direction,
    interpretation: interpretations[direction],
  };
}

function classifyDirection(
  expected: number,
  observed: number
): "over" | "under" | "on_target" {
  // Tolerance: within 25% or within ±1 absolute unit is "on target".
  const tolerance = Math.max(1, expected * 0.25);
  const diff = observed - expected;
  if (Math.abs(diff) <= tolerance) return "on_target";
  return diff > 0 ? "over" : "under";
}

function relativeMagnitude(d: ExpectationDelta): number {
  const denom = Math.max(1, d.expected);
  return Math.abs(d.delta) / denom;
}

export function classifyComplexity(
  session: Session,
  keySignals: KeySignals
): TaskComplexity {
  const firstUser = session.messages.find((m) => m.role === "user");
  const text = (firstUser?.content ?? "").toLowerCase();

  // Keyword-based hint: trivial requests for simple things.
  if (
    /\b(typo|rename|small fix|one.?liner|tweak|add a comment)\b/.test(text) &&
    text.length < 200
  ) {
    return "trivial";
  }

  // Large hint: sweeping verbs.
  if (
    /\b(refactor|migrate|rewrite|redesign|overhaul|integrate|implement .+ system)\b/.test(text)
  ) {
    return keySignals.filesWritten > 5 ? "large" : "medium";
  }

  // Fall back to observable size.
  const touched = keySignals.uniqueFilesTouched.length;
  if (touched <= 2 && keySignals.filesWritten <= 1) return "trivial";
  if (touched <= 5 && keySignals.filesWritten <= 3) return "small";
  if (touched <= 10) return "medium";
  if (touched > 10) return "large";
  return "unknown";
}

function buildExpectedNarrative(
  complexity: TaskComplexity,
  baseline: Baseline
): string {
  const noun =
    complexity === "trivial"
      ? "a trivial change"
      : complexity === "small"
        ? "a small, well-scoped task"
        : complexity === "medium"
          ? "a medium-sized task"
          : complexity === "large"
            ? "a large, cross-cutting task"
            : "a task of unclear scope";

  return `For ${noun}, a reasonable session would read ~${baseline.filesRead} files, write ~${baseline.filesWritten}, run ~${baseline.testRuns} tests, and spend roughly ${baseline.explorationShare}% on exploration.`;
}

function buildObservedNarrative(
  deltas: ExpectationDelta[],
  complexity: TaskComplexity
): string {
  const overs = deltas.filter((d) => d.direction === "over");
  const unders = deltas.filter((d) => d.direction === "under");

  if (overs.length === 0 && unders.length === 0) {
    return `The session tracked closely to expectations for ${complexity} work.`;
  }

  const parts: string[] = [];
  if (overs.length > 0) {
    parts.push(
      `overshot on ${overs.map((d) => d.metric).join(", ")}`
    );
  }
  if (unders.length > 0) {
    parts.push(
      `came in under expectation on ${unders.map((d) => d.metric).join(", ")}`
    );
  }
  return `The session ${parts.join("; ")}.`;
}
