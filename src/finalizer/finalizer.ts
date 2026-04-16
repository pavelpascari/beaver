/**
 * Finalizer.
 *
 * Aggregates chunk analyses into a complete report.
 * Integrates the friction score, expected-vs-observed, and
 * (optionally) LLM-produced insight.
 */

import type { Session } from "../types/session.js";
import type {
  SessionEvent,
  FileWriteEvent,
  FileReadEvent,
  SearchEvent,
} from "../types/events.js";
import type {
  ChunkAnalysis,
  FrictionCategory,
  PhaseType,
} from "../types/chunks.js";
import type {
  Report,
  EffortBreakdown,
  KeySignals,
  FrictionAnalysis,
  FrictionItem,
  Evidence,
  Recommendation,
  GitContext,
} from "../types/report.js";
import type { FrictionScore } from "../types/scoring.js";
import type { ExpectedVsObserved } from "../types/expectations.js";
import type { LLMInsight } from "../analysis/llm-insight.js";
import { computeFrictionScore } from "../analysis/scoring.js";
import { computeExpectedVsObserved } from "../analysis/expectations.js";

export interface FinalizeOptions {
  llmInsight?: LLMInsight;
  llmFallbackReason?: string;
  llmRequested?: boolean;
}

export function finalize(
  session: Session,
  chunkAnalyses: ChunkAnalysis[],
  events: SessionEvent[],
  gitContext: GitContext,
  options: FinalizeOptions = {}
): Report {
  const keySignals = buildKeySignals(events);
  const effortBreakdown = buildEffortBreakdown(chunkAnalyses);
  const frictionScore = computeFrictionScore({
    chunkAnalyses,
    events,
    keySignals,
  });
  const expectedVsObserved = computeExpectedVsObserved({
    session,
    keySignals,
    chunkAnalyses,
    complexityOverride: options.llmInsight?.taskComplexity,
  });

  // Merge LLM insight into expected vs observed narratives if present.
  const mergedExpectations = mergeExpectations(expectedVsObserved, options.llmInsight);

  // Weave phase insights into chunk analyses.
  const enrichedChunks = options.llmInsight
    ? applyPhaseInsights(chunkAnalyses, options.llmInsight)
    : chunkAnalyses;

  const heuristicFriction = buildFrictionAnalysis(enrichedChunks);
  const frictionAnalysis = options.llmInsight?.primaryFriction
    ? overridePrimaryFriction(heuristicFriction, options.llmInsight.primaryFriction)
    : heuristicFriction;

  const heuristicRecommendations = buildRecommendations(enrichedChunks, events);
  const recommendations = options.llmInsight?.recommendations?.length
    ? dedupeRecommendations([
        ...options.llmInsight.recommendations,
        ...heuristicRecommendations,
      ])
    : heuristicRecommendations;

  const taskSummary =
    options.llmInsight?.taskSummary ?? buildTaskSummary(session, enrichedChunks);
  const headline = options.llmInsight?.headline ?? frictionScore.headline;

  const analysisMode: Report["metadata"]["analysisMode"] = options.llmInsight
    ? "hybrid"
    : "heuristic";

  return {
    taskSummary,
    headline,
    effortBreakdown,
    keySignals,
    frictionScore,
    expectedVsObserved: mergedExpectations,
    frictionAnalysis,
    evidence: buildEvidence(enrichedChunks),
    recommendations,
    chunks: enrichedChunks,
    gitContext,
    metadata: {
      generatedAt: new Date().toISOString(),
      beaverVersion: "0.2.0",
      sessionProvider: session.provider,
      analysisMode,
      llmModel: options.llmInsight?.model,
      llmTokensUsed: options.llmInsight?.tokensUsed,
      llmFallback: options.llmRequested === true && !options.llmInsight,
      llmFallbackReason: options.llmFallbackReason,
    },
  };
}

// --- Task summary ---

function buildTaskSummary(
  session: Session,
  chunks: ChunkAnalysis[]
): string {
  const totalEvents = chunks.reduce((sum, c) => sum + c.eventCount, 0);
  const phases = chunks.map((c) => c.phase).join(" → ");
  const duration = session.metadata.durationMs
    ? formatDuration(session.metadata.durationMs)
    : "unknown duration";

  const firstUserMsg = session.messages.find((m) => m.role === "user");
  const taskHint = firstUserMsg ? truncate(firstUserMsg.content, 120) : "Unknown task";

  return [
    `Task: ${taskHint}`,
    `Session: ${totalEvents} events across ${chunks.length} phase(s) (${phases})`,
    `Duration: ${duration}`,
    `Model: ${session.metadata.model || "unknown"}`,
    `Tool calls: ${session.metadata.totalToolCalls}`,
  ].join("\n");
}

// --- Effort breakdown ---

function buildEffortBreakdown(chunks: ChunkAnalysis[]): EffortBreakdown {
  const totals: Record<PhaseType, number> = {
    exploration: 0,
    implementation: 0,
    debugging: 0,
    verification: 0,
  };

  const totalEvents = chunks.reduce((sum, c) => sum + c.eventCount, 0);

  for (const chunk of chunks) {
    totals[chunk.phase] += chunk.eventCount;
  }

  if (totalEvents === 0) {
    return { exploration: 25, implementation: 25, debugging: 25, verification: 25 };
  }

  return {
    exploration: Math.round((totals.exploration / totalEvents) * 100),
    implementation: Math.round((totals.implementation / totalEvents) * 100),
    debugging: Math.round((totals.debugging / totalEvents) * 100),
    verification: Math.round((totals.verification / totalEvents) * 100),
  };
}

// --- Key signals ---

function buildKeySignals(events: SessionEvent[]): KeySignals {
  const files = new Set<string>();
  let filesRead = 0;
  let filesWritten = 0;
  let searches = 0;
  let edits = 0;
  let retries = 0;
  let testRuns = 0;
  let commands = 0;

  for (const event of events) {
    const data = event.data as Record<string, unknown>;
    const path = typeof data.path === "string" ? data.path : "";

    switch (event.type) {
      case "file_read":
        filesRead++;
        if (path) files.add(path);
        break;
      case "file_write":
        filesWritten++;
        edits++;
        if (path) files.add(path);
        break;
      case "search":
        searches++;
        break;
      case "test_run":
        testRuns++;
        break;
      case "command_run":
        commands++;
        break;
      case "retry":
        retries++;
        break;
    }
  }

  return {
    filesRead,
    filesWritten,
    searches,
    edits,
    retries,
    testRuns,
    commands,
    uniqueFilesTouched: Array.from(files),
  };
}

// --- Friction analysis ---

function buildFrictionAnalysis(chunks: ChunkAnalysis[]): FrictionAnalysis {
  const frictionCounts = new Map<FrictionCategory, number>();
  const frictionEvidence = new Map<FrictionCategory, string[]>();

  for (const chunk of chunks) {
    for (const friction of chunk.frictionClassification) {
      frictionCounts.set(friction, (frictionCounts.get(friction) || 0) + 1);
      if (!frictionEvidence.has(friction)) frictionEvidence.set(friction, []);
      frictionEvidence
        .get(friction)!
        .push(`Detected in ${chunk.phase} phase: ${chunk.summary}`);
    }
  }

  for (const chunk of chunks) {
    for (const pattern of chunk.patterns) {
      for (const friction of chunk.frictionClassification) {
        frictionEvidence.get(friction)?.push(pattern);
      }
    }
  }

  const sorted = Array.from(frictionCounts.entries()).sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    return {
      primary: {
        category: "discovery_friction",
        description: "No significant friction detected. Session ran smoothly.",
        severity: "low",
        evidence: ["All phases completed without notable friction signals."],
      },
      secondary: [],
    };
  }

  const primary = sorted[0];
  const secondary = sorted.slice(1);

  return {
    primary: {
      category: primary[0],
      description: describeFriction(primary[0]),
      severity: primary[1] > 2 ? "high" : primary[1] > 1 ? "medium" : "low",
      evidence: frictionEvidence.get(primary[0]) || [],
    },
    secondary: secondary.map(([cat, count]) => ({
      category: cat,
      description: describeFriction(cat),
      severity: (count > 2 ? "high" : count > 1 ? "medium" : "low") as
        | "high"
        | "medium"
        | "low",
      evidence: frictionEvidence.get(cat) || [],
    })),
  };
}

function describeFriction(category: FrictionCategory): string {
  const descriptions: Record<FrictionCategory, string> = {
    discovery_friction:
      "Agent spent significant effort finding relevant code. Codebase may lack clear entry points, documentation, or conventional structure.",
    interpretation_friction:
      "Agent had to revise its approach, suggesting the task requirements or codebase patterns were initially misunderstood.",
    tooling_friction:
      "Tools failed or required retries. Build tools, tests, or development environment may need attention.",
    verification_friction:
      "Testing and validation took more effort than expected. Test setup, feedback loops, or CI may be slow or fragile.",
    boundary_friction:
      "Task touched many files/modules. Responsibilities may not be well-encapsulated, or the change is inherently cross-cutting.",
    spec_friction:
      "Task specification was ambiguous or incomplete, requiring the agent to make assumptions or seek clarification.",
    retrieval_friction:
      "Agent struggled to find specific information through search. Code organization or naming may not support efficient retrieval.",
  };
  return descriptions[category];
}

function overridePrimaryFriction(
  base: FrictionAnalysis,
  primary: NonNullable<LLMInsight["primaryFriction"]>
): FrictionAnalysis {
  // If LLM's primary matches current primary, keep existing secondaries.
  // Otherwise, demote current primary into secondaries.
  if (base.primary.category === primary.category) {
    return {
      primary: {
        category: primary.category,
        description: primary.description,
        severity: primary.severity,
        evidence:
          primary.evidence.length > 0 ? primary.evidence : base.primary.evidence,
      },
      secondary: base.secondary,
    };
  }
  const newSecondary: FrictionItem[] = [
    base.primary,
    ...base.secondary.filter((s) => s.category !== primary.category),
  ];
  return {
    primary: {
      category: primary.category,
      description: primary.description,
      severity: primary.severity,
      evidence: primary.evidence,
    },
    secondary: newSecondary,
  };
}

// --- Evidence ---

function buildEvidence(chunks: ChunkAnalysis[]): Evidence[] {
  const evidence: Evidence[] = [];

  for (const chunk of chunks) {
    for (const signal of chunk.effortSignals) {
      if (signal.weight === "high" || signal.weight === "medium") {
        evidence.push({
          claim: signal.description,
          support: `Detected during ${chunk.phase} phase (${chunk.eventCount} events)`,
          phase: chunk.phase,
        });
      }
    }

    for (const pattern of chunk.patterns) {
      evidence.push({
        claim: pattern,
        support: `Observed in ${chunk.phase} phase`,
        phase: chunk.phase,
      });
    }
  }

  return evidence;
}

// --- Recommendations ---

function buildRecommendations(
  chunks: ChunkAnalysis[],
  events: SessionEvent[]
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const frictions = new Set<FrictionCategory>();

  for (const chunk of chunks) {
    for (const f of chunk.frictionClassification) frictions.add(f);
  }

  if (frictions.has("discovery_friction")) {
    const readFiles = events
      .filter((e) => e.type === "file_read")
      .map((e) => (e.data as FileReadEvent).path)
      .filter(Boolean);

    recommendations.push({
      title: "Add a CLAUDE.md or AGENTS.md file",
      description: `The agent read ${readFiles.length} files to understand the codebase. A top-level agent guidance file listing key entry points, architecture, and conventions would reduce exploration time significantly.`,
      impact: "high",
      effort: "low",
      category: "discovery_friction",
      targets: topFiles(readFiles, 5),
      successMetric: "exploration share drops below 25% in next session",
      source: "heuristic",
    });
  }

  if (frictions.has("retrieval_friction")) {
    const searches = events
      .filter((e) => e.type === "search")
      .map((e) => (e.data as SearchEvent).query)
      .filter(Boolean);

    recommendations.push({
      title: "Improve code organization for searchability",
      description: `Agent performed ${searches.length} searches. Consider using consistent naming conventions, co-locating related code, and adding clear module-level documentation.`,
      impact: "medium",
      effort: "medium",
      category: "retrieval_friction",
      targets: searches.slice(0, 5),
      successMetric: "searches reduced by ~50% for similar tasks",
      source: "heuristic",
    });
  }

  if (frictions.has("verification_friction")) {
    recommendations.push({
      title: "Streamline test feedback loop",
      description:
        "Multiple test runs suggest the test cycle is slow or flaky. Consider faster unit tests, watch mode, or focused test commands.",
      impact: "medium",
      effort: "medium",
      category: "verification_friction",
      successMetric: "first test run passes on next session",
      source: "heuristic",
    });
  }

  if (frictions.has("interpretation_friction")) {
    recommendations.push({
      title: "Clarify task specifications upfront",
      description:
        "The agent had to revise its plan mid-task. Providing clearer requirements, examples, or acceptance criteria reduces wasted effort.",
      impact: "high",
      effort: "low",
      category: "interpretation_friction",
      successMetric: "zero plan revisions in next session",
      source: "heuristic",
    });
  }

  if (frictions.has("tooling_friction")) {
    recommendations.push({
      title: "Fix unreliable tooling",
      description:
        "Tool retries indicate flaky builds, tests, or development tools. Investing in reliable tooling reduces agent iteration cycles.",
      impact: "high",
      effort: "medium",
      category: "tooling_friction",
      successMetric: "zero retries in next session",
      source: "heuristic",
    });
  }

  if (frictions.has("boundary_friction")) {
    const writeFiles = events
      .filter((e) => e.type === "file_write")
      .map((e) => (e.data as FileWriteEvent).path)
      .filter(Boolean);

    recommendations.push({
      title: "Review module boundaries",
      description: `Changes touched ${new Set(writeFiles).size} files. If this is a common pattern, consider whether module boundaries could be refactored to reduce cross-cutting changes.`,
      impact: "medium",
      effort: "high",
      category: "boundary_friction",
      targets: topFiles(writeFiles, 5),
      source: "heuristic",
    });
  }

  const retryCount = events.filter((e) => e.type === "retry").length;
  if (retryCount > 0 && !frictions.has("tooling_friction")) {
    recommendations.push({
      title: "Reduce iteration cycles",
      description: `${retryCount} retries detected. Consider what information or structure would help the agent succeed on the first attempt.`,
      impact: "medium",
      effort: "low",
      category: "tooling_friction",
      source: "heuristic",
    });
  }

  return recommendations;
}

// --- Merging helpers ---

function mergeExpectations(
  base: ExpectedVsObserved,
  insight: LLMInsight | undefined
): ExpectedVsObserved {
  if (!insight) return base;
  return {
    ...base,
    expectedNarrative: insight.expectedNarrative ?? base.expectedNarrative,
    observedNarrative: insight.observedNarrative ?? base.observedNarrative,
    biggestDivergence: insight.biggestDivergence ?? base.biggestDivergence,
    taskComplexity: insight.taskComplexity ?? base.taskComplexity,
  };
}

function applyPhaseInsights(
  chunks: ChunkAnalysis[],
  insight: LLMInsight
): ChunkAnalysis[] {
  if (!insight.insightByPhase || insight.insightByPhase.length === 0) {
    return chunks;
  }
  const byPhase = new Map<PhaseType, string>();
  for (const p of insight.insightByPhase) {
    if (!byPhase.has(p.phase)) byPhase.set(p.phase, p.insight);
  }
  return chunks.map((c) => ({
    ...c,
    insight: byPhase.get(c.phase) ?? c.insight,
    source: byPhase.has(c.phase) ? ("hybrid" as const) : c.source,
  }));
}

function dedupeRecommendations(recs: Recommendation[]): Recommendation[] {
  const seen = new Set<string>();
  const out: Recommendation[] = [];
  for (const r of recs) {
    // De-dupe by normalized title per category.
    const key = `${r.category}:${r.title.toLowerCase().replace(/\s+/g, " ").trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// --- Small utils ---

function topFiles(paths: string[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const p of paths) counts.set(p, (counts.get(p) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([p]) => p);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function truncate(str: string, maxLen: number): string {
  const firstLine = str.split("\n")[0].trim();
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 3) + "...";
}
