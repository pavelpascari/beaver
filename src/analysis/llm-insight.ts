/**
 * LLM insight orchestration.
 *
 * Runs a single high-leverage call against the LLM, passing all the
 * deterministic signals we've already computed. Returns a structured
 * `LLMInsight` that the finalizer merges into the final report.
 *
 * If the call fails or can't be configured, the orchestrator resolves
 * cleanly with `{ ok: false, reason }` so the CLI can fall back to
 * heuristic-only output without crashing.
 */

import type { ChunkAnalysis, FrictionCategory, PhaseType } from "../types/chunks.js";
import type { SessionEvent } from "../types/events.js";
import type { KeySignals, GitContext, Recommendation } from "../types/report.js";
import type { FrictionScore } from "../types/scoring.js";
import type { ExpectedVsObserved, TaskComplexity } from "../types/expectations.js";
import type { Session } from "../types/session.js";
import type { LLMClient } from "./llm-client.js";
import { LLMParseError, parseJsonFromLLM } from "./llm-client.js";
import { buildInsightPrompt } from "./prompts.js";

export interface LLMInsight {
  headline: string;
  taskSummary: string;
  taskComplexity?: TaskComplexity;
  expectedNarrative?: string;
  observedNarrative?: string;
  biggestDivergence?: string;
  primaryFriction?: {
    category: FrictionCategory;
    description: string;
    severity: "low" | "medium" | "high";
    evidence: string[];
  };
  insightByPhase: Array<{ phase: PhaseType; insight: string }>;
  recommendations: Recommendation[];
  tokensUsed: number;
  model: string;
}

export type LLMInsightResult =
  | { ok: true; insight: LLMInsight }
  | { ok: false; reason: string };

export interface InsightRunInputs {
  session: Session;
  events: SessionEvent[];
  chunkAnalyses: ChunkAnalysis[];
  keySignals: KeySignals;
  gitContext: GitContext;
  frictionScore: FrictionScore;
  expectedVsObserved: ExpectedVsObserved;
}

export async function runLLMInsight(
  client: LLMClient,
  inputs: InsightRunInputs
): Promise<LLMInsightResult> {
  try {
    const prompt = buildInsightPrompt({
      taskDescription: firstUserContent(inputs.session),
      chunkAnalyses: inputs.chunkAnalyses,
      keySignals: inputs.keySignals,
      gitContext: inputs.gitContext,
      frictionScore: inputs.frictionScore,
      expectedVsObserved: inputs.expectedVsObserved,
      firstUserMessage: firstUserContent(inputs.session),
      samplePaths: samplePaths(inputs.events, 15),
      sampleSearches: sampleSearches(inputs.events, 10),
      sampleAssistantExcerpts: sampleAssistantExcerpts(inputs.session, 4),
    });

    const response = await client.call(prompt, { maxTokens: 2048 });
    const raw = parseJsonFromLLM<RawInsight>(response.text);
    const insight = normalizeInsight(raw, response.tokensUsed, response.model);
    return { ok: true, insight };
  } catch (err) {
    return {
      ok: false,
      reason: describeError(err),
    };
  }
}

// --- Normalization ---

interface RawInsight {
  headline?: unknown;
  taskSummary?: unknown;
  taskComplexity?: unknown;
  expectedNarrative?: unknown;
  observedNarrative?: unknown;
  biggestDivergence?: unknown;
  primaryFriction?: {
    category?: unknown;
    description?: unknown;
    severity?: unknown;
    evidence?: unknown;
  };
  insightByPhase?: unknown;
  recommendations?: unknown;
}

const VALID_FRICTION: Set<FrictionCategory> = new Set([
  "discovery_friction",
  "retrieval_friction",
  "verification_friction",
  "tooling_friction",
  "interpretation_friction",
  "boundary_friction",
  "spec_friction",
]);
const VALID_PHASES: Set<PhaseType> = new Set([
  "exploration",
  "implementation",
  "debugging",
  "verification",
]);
const VALID_LEVEL: Set<string> = new Set(["low", "medium", "high"]);
const VALID_COMPLEXITY: Set<TaskComplexity> = new Set([
  "trivial",
  "small",
  "medium",
  "large",
  "unknown",
]);

function normalizeInsight(
  raw: RawInsight,
  tokensUsed: number,
  model: string
): LLMInsight {
  if (typeof raw !== "object" || raw === null) {
    throw new LLMParseError("LLM insight was not an object");
  }

  const headline = asString(raw.headline, "Session analysis");
  const taskSummary = asString(raw.taskSummary, "");
  if (!taskSummary) {
    throw new LLMParseError("LLM insight missing taskSummary");
  }

  const taskComplexity = asEnum<TaskComplexity>(raw.taskComplexity, VALID_COMPLEXITY);

  const primaryFriction = raw.primaryFriction
    ? normalizePrimaryFriction(raw.primaryFriction)
    : undefined;

  const insightByPhase = Array.isArray(raw.insightByPhase)
    ? raw.insightByPhase
        .map((item) => {
          if (typeof item !== "object" || item === null) return null;
          const rec = item as Record<string, unknown>;
          const phase = asEnum<PhaseType>(rec.phase, VALID_PHASES);
          const insight = asString(rec.insight, "");
          if (!phase || !insight) return null;
          return { phase, insight };
        })
        .filter((x): x is { phase: PhaseType; insight: string } => x !== null)
    : [];

  const recommendations = Array.isArray(raw.recommendations)
    ? raw.recommendations
        .map((r) => normalizeRecommendation(r))
        .filter((r): r is Recommendation => r !== null)
    : [];

  return {
    headline,
    taskSummary,
    taskComplexity,
    expectedNarrative: optionalString(raw.expectedNarrative),
    observedNarrative: optionalString(raw.observedNarrative),
    biggestDivergence: optionalString(raw.biggestDivergence),
    primaryFriction,
    insightByPhase,
    recommendations,
    tokensUsed,
    model,
  };
}

function normalizePrimaryFriction(
  raw: NonNullable<RawInsight["primaryFriction"]>
): LLMInsight["primaryFriction"] | undefined {
  const category = asEnum<FrictionCategory>(raw.category, VALID_FRICTION);
  const description = asString(raw.description, "");
  const severity = asEnum<"low" | "medium" | "high">(
    raw.severity,
    VALID_LEVEL as Set<"low" | "medium" | "high">
  );
  if (!category || !description || !severity) return undefined;

  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.filter((e): e is string => typeof e === "string" && e.length > 0)
    : [];

  return { category, description, severity, evidence };
}

function normalizeRecommendation(raw: unknown): Recommendation | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const title = asString(r.title, "");
  const description = asString(r.description, "");
  const impact = asEnum<"low" | "medium" | "high">(
    r.impact,
    VALID_LEVEL as Set<"low" | "medium" | "high">
  );
  const effort = asEnum<"low" | "medium" | "high">(
    r.effort,
    VALID_LEVEL as Set<"low" | "medium" | "high">
  );
  const category = asEnum<FrictionCategory>(r.category, VALID_FRICTION);
  if (!title || !description || !impact || !effort || !category) return null;

  const targets = Array.isArray(r.targets)
    ? r.targets.filter((t): t is string => typeof t === "string" && t.length > 0)
    : undefined;

  return {
    title,
    description,
    impact,
    effort,
    category,
    targets: targets && targets.length > 0 ? targets : undefined,
    successMetric: optionalString(r.successMetric),
    snippet: optionalString(r.snippet),
    source: "llm",
  };
}

// --- Validation helpers ---

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

function optionalString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asEnum<T extends string>(v: unknown, allowed: Set<T>): T | undefined {
  return typeof v === "string" && allowed.has(v as T) ? (v as T) : undefined;
}

// --- Input extraction helpers ---

function firstUserContent(session: Session): string {
  const m = session.messages.find((x) => x.role === "user");
  return m?.content ?? "";
}

function samplePaths(events: SessionEvent[], max: number): string[] {
  const seen = new Set<string>();
  for (const e of events) {
    const d = e.data as { path?: string };
    if (typeof d.path === "string" && d.path) seen.add(d.path);
    if (seen.size >= max) break;
  }
  return Array.from(seen);
}

function sampleSearches(events: SessionEvent[], max: number): string[] {
  const queries: string[] = [];
  for (const e of events) {
    if (e.type !== "search") continue;
    const q = (e.data as { query?: string }).query;
    if (typeof q === "string" && q) queries.push(q);
    if (queries.length >= max) break;
  }
  return queries;
}

function sampleAssistantExcerpts(session: Session, max: number): string[] {
  return session.messages
    .filter((m) => m.role === "assistant" && m.content.trim().length > 0)
    .slice(0, max)
    .map((m) => m.content);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
