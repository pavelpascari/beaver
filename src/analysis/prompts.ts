/**
 * LLM prompt templates for chunk and finalizer analysis.
 *
 * These are structured prompts designed to be sent to Claude or another LLM.
 * In the MVP, these serve as documentation and are ready for when
 * LLM-powered analysis is enabled.
 */

import type { Chunk } from "../types/chunks.js";
import type { ChunkAnalysis } from "../types/chunks.js";
import type { SessionEvent } from "../types/events.js";
import type { KeySignals, GitContext } from "../types/report.js";

/**
 * Generate a prompt for analyzing a single session chunk.
 */
export function buildChunkAnalysisPrompt(chunk: Chunk): string {
  const eventSummary = chunk.events
    .map(
      (e) =>
        `- [${e.type}] ${summarizeEventData(e)}`
    )
    .join("\n");

  const messageExcerpts = chunk.messages
    .filter((m) => m.role === "assistant")
    .slice(0, 5)
    .map((m) => `[assistant]: ${m.content.slice(0, 200)}...`)
    .join("\n");

  return `You are analyzing a chunk of a coding agent session. This chunk represents the "${chunk.phase}" phase.

## Events in this chunk (${chunk.events.length} total)

${eventSummary}

## Assistant message excerpts

${messageExcerpts}

## Your task

Analyze this chunk and produce a JSON object with these fields:

{
  "summary": "A 1-2 sentence description of what happened in this phase",
  "effortSignals": [
    {
      "type": "signal_type",
      "description": "What effort was spent and why",
      "weight": "low|medium|high"
    }
  ],
  "frictionClassification": ["category_name"],
  "patterns": ["observed pattern description"]
}

## Friction categories to consider

- discovery_friction: Agent spent too long finding relevant code
- interpretation_friction: Agent misunderstood requirements or code
- tooling_friction: Tools failed or required workarounds
- verification_friction: Testing/validation was harder than expected
- boundary_friction: Change crossed too many module boundaries
- spec_friction: Requirements were unclear or incomplete
- retrieval_friction: Agent couldn't efficiently find information

## Guidelines

- Focus on AVOIDABLE effort, not just activity
- Compare expected vs observed complexity
- Be specific — reference actual files and operations
- Only flag friction if there's clear evidence
- Empty frictionClassification is fine if the phase went smoothly

Respond with only the JSON object, no markdown fences.`;
}

/**
 * Generate a prompt for the finalizer analysis.
 */
export function buildFinalizerPrompt(
  chunkAnalyses: ChunkAnalysis[],
  keySignals: KeySignals,
  gitContext: GitContext,
  taskDescription: string
): string {
  const chunkSummaries = chunkAnalyses
    .map(
      (c, i) =>
        `### Phase ${i + 1}: ${c.phase}\n- Summary: ${c.summary}\n- Effort signals: ${c.effortSignals.map((s) => s.description).join("; ") || "none"}\n- Friction: ${c.frictionClassification.join(", ") || "none"}\n- Patterns: ${c.patterns.join("; ") || "none"}`
    )
    .join("\n\n");

  return `You are the finalizer for a Beaver session analysis. You've received chunk-level analyses and must produce a cohesive final report.

## Task description
${taskDescription}

## Chunk analyses
${chunkSummaries}

## Key signals
- Files read: ${keySignals.filesRead}
- Files written: ${keySignals.filesWritten}
- Searches: ${keySignals.searches}
- Retries: ${keySignals.retries}
- Test runs: ${keySignals.testRuns}
- Commands: ${keySignals.commands}
- Unique files touched: ${keySignals.uniqueFilesTouched.length}

## Git context
- Type: ${gitContext.type}
${gitContext.repos.map((r) => `- Repo: ${r.path}, Branch: ${r.branch || "unknown"}`).join("\n")}

## Your task

Produce a JSON report with these fields:

{
  "taskSummary": "2-3 sentence summary of the entire task",
  "primaryFriction": {
    "category": "friction_category",
    "description": "Why this was the biggest source of friction",
    "severity": "low|medium|high",
    "evidence": ["specific evidence point 1", "specific evidence point 2"]
  },
  "secondaryFrictions": [...same format...],
  "recommendations": [
    {
      "title": "Short actionable title",
      "description": "Specific recommendation with context",
      "impact": "low|medium|high",
      "effort": "low|medium|high",
      "category": "which friction this addresses"
    }
  ],
  "evidence": [
    {
      "claim": "What we observed",
      "support": "Why this matters",
      "phase": "which phase"
    }
  ]
}

## Quality bar

A good report makes an engineer say: "Yeah... that was more painful than it should have been."

## Guidelines

1. Focus on avoidable effort, not just activity
2. Compare expected vs observed complexity
3. Always provide specific evidence
4. Make recommendations actionable and specific
5. Avoid generic advice like "improve documentation" — say WHAT to document and WHERE
6. If the session went smoothly, say so — don't manufacture friction

Respond with only the JSON object, no markdown fences.`;
}

// --- Helpers ---

function summarizeEventData(event: SessionEvent): string {
  const data = event.data as Record<string, unknown>;

  switch (event.type) {
    case "file_read":
      return `Read ${data.path || "unknown file"}`;
    case "file_write":
      return `Wrote ${data.path || "unknown file"}${data.isCreation ? " (new)" : ""}`;
    case "search":
      return `Search: "${data.query || ""}" via ${data.tool || "unknown"}`;
    case "test_run":
      return `Test: ${data.command || "unknown"} — ${data.passed ? "passed" : "failed"}`;
    case "command_run":
      return `Command: ${(data.command as string || "").slice(0, 80)}`;
    case "retry":
      return `Retry: ${data.reason || "unknown reason"}`;
    case "plan_revision":
      return `Plan revision: ${data.summary || ""}`;
    default:
      return JSON.stringify(data).slice(0, 100);
  }
}
