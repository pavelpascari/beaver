/**
 * Final report structure.
 */

import type { ChunkAnalysis, FrictionCategory, PhaseType } from "./chunks.js";
import type { FrictionScore } from "./scoring.js";
import type { ExpectedVsObserved } from "./expectations.js";

export interface Report {
  taskSummary: string;
  /** Single-paragraph executive summary of the session. */
  headline?: string;
  effortBreakdown: EffortBreakdown;
  keySignals: KeySignals;
  /** Numeric friction scoring. */
  frictionScore: FrictionScore;
  /** Expected vs observed comparison — the core insight layer. */
  expectedVsObserved: ExpectedVsObserved;
  frictionAnalysis: FrictionAnalysis;
  evidence: Evidence[];
  recommendations: Recommendation[];
  chunks: ChunkAnalysis[];
  gitContext: GitContext;
  metadata: ReportMetadata;
}

export interface EffortBreakdown {
  exploration: number;
  implementation: number;
  debugging: number;
  verification: number;
}

export interface KeySignals {
  filesRead: number;
  filesWritten: number;
  searches: number;
  edits: number;
  retries: number;
  testRuns: number;
  commands: number;
  uniqueFilesTouched: string[];
}

export interface FrictionAnalysis {
  primary: FrictionItem;
  secondary: FrictionItem[];
}

export interface FrictionItem {
  category: FrictionCategory;
  description: string;
  severity: "low" | "medium" | "high";
  evidence: string[];
}

export interface Evidence {
  claim: string;
  support: string;
  phase: PhaseType;
}

export interface Recommendation {
  title: string;
  description: string;
  impact: "low" | "medium" | "high";
  effort: "low" | "medium" | "high";
  category: FrictionCategory;
  /** Concrete files, commands, or locations this recommendation should act on. */
  targets?: string[];
  /** What a successful follow-through looks like on the next session. */
  successMetric?: string;
  /** A short, drop-in snippet (e.g. AGENTS.md section, test command). */
  snippet?: string;
  /** Origin of the recommendation. */
  source?: "heuristic" | "llm";
}

export interface GitContext {
  detected: boolean;
  type: "single_repo" | "multi_repo" | "no_repo";
  repos: RepoInfo[];
}

export interface RepoInfo {
  path: string;
  branch?: string;
  hasUncommittedChanges?: boolean;
}

export interface ReportMetadata {
  generatedAt: string;
  beaverVersion: string;
  sessionProvider: string;
  analysisMode: "heuristic" | "llm" | "hybrid";
  /** LLM model name if analysisMode !== "heuristic". */
  llmModel?: string;
  /** Approximate tokens consumed by LLM analysis, if available. */
  llmTokensUsed?: number;
  /** True if LLM was requested but analysis fell back to heuristic. */
  llmFallback?: boolean;
  /** Reason for LLM fallback, if applicable. */
  llmFallbackReason?: string;
}
