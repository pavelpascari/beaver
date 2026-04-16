/**
 * LLM prompt templates.
 *
 * The high-leverage prompt is `buildInsightPrompt` — it runs once per session
 * and is given every heuristic signal we've already computed, so the LLM can
 * spend its attention on producing narrative, specificity, and recommendations
 * rather than recomputing what we already know.
 *
 * `buildChunkAnalysisPrompt` remains for optional per-chunk deep analysis.
 */

import type { Chunk } from "../types/chunks.js";
import type { ChunkAnalysis } from "../types/chunks.js";
import type { SessionEvent } from "../types/events.js";
import type { KeySignals, GitContext } from "../types/report.js";
import type { FrictionScore } from "../types/scoring.js";
import type { ExpectedVsObserved } from "../types/expectations.js";

/**
 * High-leverage single-call insight prompt.
 *
 * Consumes everything the heuristic pipeline has already produced and asks
 * the LLM for narrative synthesis, expected-vs-observed refinement, and
 * specific, actionable recommendations.
 */
export function buildInsightPrompt(input: {
  taskDescription: string;
  chunkAnalyses: ChunkAnalysis[];
  keySignals: KeySignals;
  gitContext: GitContext;
  frictionScore: FrictionScore;
  expectedVsObserved: ExpectedVsObserved;
  firstUserMessage: string;
  samplePaths: string[];
  sampleSearches: string[];
  sampleAssistantExcerpts: string[];
  repoLanguage?: string;
}): string {
  const {
    taskDescription,
    chunkAnalyses,
    keySignals,
    frictionScore,
    expectedVsObserved,
    firstUserMessage,
    samplePaths,
    sampleSearches,
    sampleAssistantExcerpts,
  } = input;

  const chunkBlock = chunkAnalyses
    .map(
      (c, i) =>
        `#${i + 1} ${c.phase} (${c.eventCount} events)
  summary: ${c.summary}
  effort: ${c.effortSignals.map((s) => `[${s.weight}] ${s.description}`).join(" | ") || "none"}
  friction: ${c.frictionClassification.join(", ") || "none"}
  patterns: ${c.patterns.join(" | ") || "none"}`
    )
    .join("\n\n");

  const contribBlock = frictionScore.contributors
    .map((c) => `  - ${c.signal} (+${c.points}): ${c.rationale}`)
    .join("\n");

  const deltaBlock = expectedVsObserved.deltas
    .map(
      (d) =>
        `  - ${d.metric}: expected ${d.expected}, observed ${d.observed} (${d.direction}) — ${d.interpretation}`
    )
    .join("\n");

  return `You are Beaver, a staff-level code assistant whose job is to turn a raw coding agent session into sharp, actionable insight. The heuristic layer has already extracted signals. Your job is to add the judgment.

## Task description
${truncate(taskDescription, 500)}

## First user message (verbatim)
"""
${truncate(firstUserMessage, 800)}
"""

## Observable session snapshot
- files read: ${keySignals.filesRead}
- files written: ${keySignals.filesWritten}
- searches: ${keySignals.searches}
- retries: ${keySignals.retries}
- test runs: ${keySignals.testRuns}
- unique files touched: ${keySignals.uniqueFilesTouched.length}

## Sample paths touched
${samplePaths.slice(0, 15).map((p) => `- ${p}`).join("\n") || "(none)"}

## Sample searches
${sampleSearches.slice(0, 10).map((q) => `- "${q}"`).join("\n") || "(none)"}

## Assistant excerpts (for voice/tone signal)
${sampleAssistantExcerpts.slice(0, 4).map((m) => `> ${truncate(m, 240)}`).join("\n") || "(none)"}

## Phase chunks
${chunkBlock || "(no chunks)"}

## Deterministic friction score
- overall: ${frictionScore.overall}/100 (grade ${frictionScore.grade})
- headline: ${frictionScore.headline}
- contributors:
${contribBlock || "  (none)"}

## Expected vs observed (heuristic baseline, complexity=${expectedVsObserved.taskComplexity})
${expectedVsObserved.expectedNarrative}
Observed: ${expectedVsObserved.observedNarrative}
Deltas:
${deltaBlock}

## Your job

Respond with a single JSON object with EXACTLY these keys (no extras, no prose outside JSON, no markdown fences):

{
  "headline": "1-sentence punchy executive summary of the session. Should read like something a senior engineer would say to a teammate at standup.",
  "taskSummary": "2-3 sentences describing what the agent actually worked on and how it went. Concrete, not generic.",
  "taskComplexity": "trivial|small|medium|large|unknown",
  "expectedNarrative": "Refined 1-2 sentence version of what a well-run session for this task looks like. Use specifics.",
  "observedNarrative": "Refined 1-2 sentence version of what actually happened, contrasted against expected.",
  "biggestDivergence": "One sentence: the single most interesting gap between expected and observed.",
  "primaryFriction": {
    "category": "discovery_friction|retrieval_friction|verification_friction|tooling_friction|interpretation_friction|boundary_friction|spec_friction",
    "description": "2-3 sentences. Explain WHY this friction exists for THIS codebase/task, not generically.",
    "severity": "low|medium|high",
    "evidence": ["concrete observation #1 with specifics", "concrete observation #2"]
  },
  "insightByPhase": [
    {
      "phase": "exploration|implementation|debugging|verification",
      "insight": "1-2 sentence judgment about this phase. Cite file paths, searches, or tool calls when relevant."
    }
  ],
  "recommendations": [
    {
      "title": "Short imperative title, ≤ 60 chars",
      "description": "2-4 sentences. Be specific: reference concrete files, exact commands, or exact conventions. NEVER generic like 'improve docs'.",
      "impact": "low|medium|high",
      "effort": "low|medium|high",
      "category": "one of the friction categories above",
      "targets": ["file/path or command this applies to", "..."],
      "successMetric": "What measurable change would indicate success on the next session? e.g. 'exploration share < 25%', 'zero plan revisions', 'first test run passes'.",
      "snippet": "Optional short drop-in content (code, config, or markdown section). Leave empty string if not applicable."
    }
  ]
}

## Quality bar

A good report makes a senior engineer say: "Yeah, that was more painful than it should have been — and now I know what to change."

## Rules

1. Specificity beats length. Reference real file paths and real searches from above.
2. Do NOT invent facts. If you don't know, omit or say so.
3. Recommendations must be actionable TODAY, not aspirational. Tie each to an observable signal above.
4. 2-5 recommendations. Do not pad. One great one beats four generic ones.
5. If the session was actually clean (score < 10), say so — do not manufacture friction.
6. Respond with ONLY the JSON object.`;
}

/**
 * Generate a prompt for analyzing a single session chunk.
 * Kept for optional deep-dive mode.
 */
export function buildChunkAnalysisPrompt(chunk: Chunk): string {
  const eventSummary = chunk.events
    .map((e) => `- [${e.type}] ${summarizeEventData(e)}`)
    .join("\n");

  const messageExcerpts = chunk.messages
    .filter((m) => m.role === "assistant")
    .slice(0, 5)
    .map((m) => `[assistant]: ${truncate(m.content, 200)}`)
    .join("\n");

  return `You are analyzing a chunk of a coding agent session. This chunk is the "${chunk.phase}" phase.

## Events (${chunk.events.length} total)

${eventSummary}

## Assistant excerpts

${messageExcerpts}

## Your task

Analyze this chunk and produce a JSON object:

{
  "summary": "1-2 sentence description of what happened",
  "insight": "1 sentence judgment — what does this phase reveal about the session?",
  "effortSignals": [
    { "type": "signal_type", "description": "what effort was spent and why", "weight": "low|medium|high" }
  ],
  "frictionClassification": ["category_name"],
  "patterns": ["observed pattern"]
}

## Friction categories

- discovery_friction, interpretation_friction, tooling_friction,
  verification_friction, boundary_friction, spec_friction, retrieval_friction

## Guidelines

- Focus on AVOIDABLE effort, not just activity.
- Compare expected vs observed complexity.
- Be specific — reference actual files and operations.
- Only flag friction if there's clear evidence.
- Respond with ONLY the JSON object.`;
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
      return `Command: ${((data.command as string) || "").slice(0, 80)}`;
    case "retry":
      return `Retry: ${data.reason || "unknown reason"}`;
    case "plan_revision":
      return `Plan revision: ${data.summary || ""}`;
    default:
      return JSON.stringify(data).slice(0, 100);
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 3) + "...";
}
