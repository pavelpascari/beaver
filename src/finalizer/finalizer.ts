/**
 * Finalizer.
 *
 * Aggregates chunk analyses into a complete report.
 * This is the most important step — it synthesizes everything
 * into a coherent, actionable output.
 */

import type { Session } from "../types/session.js";
import type { SessionEvent, FileWriteEvent, FileReadEvent, SearchEvent } from "../types/events.js";
import type { ChunkAnalysis, FrictionCategory, PhaseType } from "../types/chunks.js";
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

export function finalize(
  session: Session,
  chunkAnalyses: ChunkAnalysis[],
  events: SessionEvent[],
  gitContext: GitContext
): Report {
  return {
    taskSummary: buildTaskSummary(session, chunkAnalyses),
    effortBreakdown: buildEffortBreakdown(chunkAnalyses),
    keySignals: buildKeySignals(events),
    frictionAnalysis: buildFrictionAnalysis(chunkAnalyses, events),
    evidence: buildEvidence(chunkAnalyses),
    recommendations: buildRecommendations(chunkAnalyses, events),
    chunks: chunkAnalyses,
    gitContext,
    metadata: {
      generatedAt: new Date().toISOString(),
      beaverVersion: "0.1.0",
      sessionProvider: session.provider,
      analysisMode: "heuristic",
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

  // Try to extract task description from first user message
  const firstUserMsg = session.messages.find((m) => m.role === "user");
  const taskHint = firstUserMsg
    ? truncate(firstUserMsg.content, 120)
    : "Unknown task";

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

  // Normalize to percentages
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

function buildFrictionAnalysis(
  chunks: ChunkAnalysis[],
  events: SessionEvent[]
): FrictionAnalysis {
  // Count friction categories across all chunks
  const frictionCounts = new Map<FrictionCategory, number>();
  const frictionEvidence = new Map<FrictionCategory, string[]>();

  for (const chunk of chunks) {
    for (const friction of chunk.frictionClassification) {
      frictionCounts.set(friction, (frictionCounts.get(friction) || 0) + 1);

      if (!frictionEvidence.has(friction)) {
        frictionEvidence.set(friction, []);
      }
      frictionEvidence.get(friction)!.push(
        `Detected in ${chunk.phase} phase: ${chunk.summary}`
      );
    }
  }

  // Add pattern-based friction evidence
  for (const chunk of chunks) {
    for (const pattern of chunk.patterns) {
      for (const friction of chunk.frictionClassification) {
        frictionEvidence.get(friction)?.push(pattern);
      }
    }
  }

  // Sort by frequency
  const sorted = Array.from(frictionCounts.entries())
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) {
    // No friction detected - this is good!
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
      severity: (count > 2 ? "high" : count > 1 ? "medium" : "low") as "high" | "medium" | "low",
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

// --- Evidence ---

function buildEvidence(chunks: ChunkAnalysis[]): Evidence[] {
  const evidence: Evidence[] = [];

  for (const chunk of chunks) {
    // High effort signals are evidence
    for (const signal of chunk.effortSignals) {
      if (signal.weight === "high" || signal.weight === "medium") {
        evidence.push({
          claim: signal.description,
          support: `Detected during ${chunk.phase} phase (${chunk.eventCount} events)`,
          phase: chunk.phase,
        });
      }
    }

    // Patterns are evidence
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
    for (const f of chunk.frictionClassification) {
      frictions.add(f);
    }
  }

  // Discovery friction recommendations
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
    });
  }

  // Always add a contextual recommendation based on session patterns
  const retryCount = events.filter((e) => e.type === "retry").length;
  if (retryCount > 0 && !frictions.has("tooling_friction")) {
    recommendations.push({
      title: "Reduce iteration cycles",
      description: `${retryCount} retries detected. Consider what information or structure would help the agent succeed on the first attempt.`,
      impact: "medium",
      effort: "low",
      category: "tooling_friction",
    });
  }

  return recommendations;
}

// --- Helpers ---

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function truncate(str: string, maxLen: number): string {
  // Take first line, truncate if needed
  const firstLine = str.split("\n")[0].trim();
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen - 3) + "...";
}
