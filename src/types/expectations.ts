/**
 * Expected vs Observed reasoning.
 *
 * A baseline of what a "reasonable" session for a task would look like,
 * compared to what actually happened. The delta is where insight lives.
 */

import type { PhaseType } from "./chunks.js";

export interface ExpectedVsObserved {
  /** 1-2 sentences: what was expected. */
  expectedNarrative: string;
  /** 1-2 sentences: what was observed, in contrast. */
  observedNarrative: string;
  /** Per-signal numeric comparison. */
  deltas: ExpectationDelta[];
  /** The most interesting divergence between expectation and reality. */
  biggestDivergence?: string;
  /** Optional task complexity classification driving the expectation. */
  taskComplexity?: TaskComplexity;
}

export type TaskComplexity = "trivial" | "small" | "medium" | "large" | "unknown";

export interface ExpectationDelta {
  /** What was measured, e.g. "file_reads", "searches", "exploration_share". */
  metric: string;
  /** Expected value given the task. */
  expected: number;
  /** Observed value. */
  observed: number;
  /** observed - expected, signed. */
  delta: number;
  /** "over" = observed exceeded expected, "under" = less than expected. */
  direction: "over" | "under" | "on_target";
  /** Optional phase this delta is anchored to. */
  phase?: PhaseType;
  /** Short interpretation of the delta. */
  interpretation: string;
}
