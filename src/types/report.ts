/**
 * Final report structure.
 */

import type { ChunkAnalysis, FrictionCategory, PhaseType } from "./chunks.js";

export interface Report {
  taskSummary: string;
  effortBreakdown: EffortBreakdown;
  keySignals: KeySignals;
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
  analysisMode: "heuristic" | "llm";
}
