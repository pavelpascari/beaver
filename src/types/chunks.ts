/**
 * Session phases (chunks) and their analysis.
 */

export type PhaseType =
  | "exploration"
  | "implementation"
  | "debugging"
  | "verification";

export interface Chunk {
  phase: PhaseType;
  startIndex: number;
  endIndex: number;
  events: import("./events.js").SessionEvent[];
  messages: import("./session.js").Message[];
}

export interface ChunkAnalysis {
  phase: PhaseType;
  summary: string;
  effortSignals: EffortSignal[];
  frictionClassification: FrictionCategory[];
  patterns: string[];
  eventCount: number;
}

export interface EffortSignal {
  type: string;
  description: string;
  weight: "low" | "medium" | "high";
}

export type FrictionCategory =
  | "discovery_friction"
  | "interpretation_friction"
  | "tooling_friction"
  | "verification_friction"
  | "boundary_friction"
  | "spec_friction"
  | "retrieval_friction";
