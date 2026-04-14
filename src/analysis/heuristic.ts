/**
 * Heuristic chunk analysis.
 *
 * Analyzes each chunk without LLM calls, using pattern matching
 * and heuristics to detect friction and effort signals.
 */

import type { Chunk, ChunkAnalysis, EffortSignal, FrictionCategory } from "../types/chunks.js";
import type {
  SessionEvent,
  FileReadEvent,
  FileWriteEvent,
  SearchEvent,
  RetryEvent,
  CommandRunEvent,
  TestRunEvent,
} from "../types/events.js";

export function analyzeHeuristic(chunk: Chunk): ChunkAnalysis {
  const summary = generateSummary(chunk);
  const effortSignals = detectEffortSignals(chunk);
  const frictionClassification = detectFriction(chunk);
  const patterns = detectPatterns(chunk);

  return {
    phase: chunk.phase,
    summary,
    effortSignals,
    frictionClassification,
    patterns,
    eventCount: chunk.events.length,
  };
}

// --- Summary generation ---

function generateSummary(chunk: Chunk): string {
  const counts = countEventTypes(chunk.events);
  const files = getUniqueFiles(chunk.events);
  const parts: string[] = [];

  parts.push(`${chunk.phase} phase with ${chunk.events.length} events`);

  if (counts.file_read > 0) parts.push(`${counts.file_read} file reads`);
  if (counts.file_write > 0) parts.push(`${counts.file_write} file writes`);
  if (counts.search > 0) parts.push(`${counts.search} searches`);
  if (counts.test_run > 0) parts.push(`${counts.test_run} test runs`);
  if (counts.retry > 0) parts.push(`${counts.retry} retries`);
  if (counts.command_run > 0) parts.push(`${counts.command_run} commands`);

  if (files.length > 0) {
    parts.push(`across ${files.length} file(s)`);
  }

  return parts.join(", ");
}

// --- Effort signal detection ---

function detectEffortSignals(chunk: Chunk): EffortSignal[] {
  const signals: EffortSignal[] = [];
  const counts = countEventTypes(chunk.events);

  // High read count = lots of exploration
  if (counts.file_read > 5) {
    signals.push({
      type: "excessive_exploration",
      description: `Read ${counts.file_read} files — agent may have been unsure where to look`,
      weight: counts.file_read > 10 ? "high" : "medium",
    });
  }

  // Many searches = difficulty finding things
  if (counts.search > 3) {
    signals.push({
      type: "search_heavy",
      description: `${counts.search} searches performed — codebase may lack discoverable structure`,
      weight: counts.search > 8 ? "high" : "medium",
    });
  }

  // Retries = something went wrong
  if (counts.retry > 0) {
    signals.push({
      type: "retries_detected",
      description: `${counts.retry} retries detected — earlier attempts failed or were incomplete`,
      weight: counts.retry > 3 ? "high" : "medium",
    });
  }

  // Repeated writes to same file
  const repeatedFiles = getRepeatedWriteFiles(chunk.events);
  if (repeatedFiles.length > 0) {
    signals.push({
      type: "repeated_edits",
      description: `Files edited multiple times: ${repeatedFiles.join(", ")}`,
      weight: "medium",
    });
  }

  // Many test runs = possibly struggling with verification
  if (counts.test_run > 2) {
    signals.push({
      type: "test_heavy",
      description: `${counts.test_run} test runs — may indicate trial-and-error debugging`,
      weight: counts.test_run > 5 ? "high" : "medium",
    });
  }

  // Plan revisions
  if (counts.plan_revision > 0) {
    signals.push({
      type: "plan_changes",
      description: `${counts.plan_revision} plan revision(s) — approach had to change mid-task`,
      weight: "high",
    });
  }

  return signals;
}

// --- Friction detection ---

function detectFriction(chunk: Chunk): FrictionCategory[] {
  const frictions: FrictionCategory[] = [];
  const counts = countEventTypes(chunk.events);

  // Discovery friction: lots of reads + searches
  if (counts.file_read + counts.search > 8) {
    frictions.push("discovery_friction");
  }

  // Retrieval friction: many searches with possibly poor results
  if (counts.search > 5) {
    frictions.push("retrieval_friction");
  }

  // Verification friction: many test runs or retries after tests
  if (counts.test_run > 2 || (counts.test_run > 0 && counts.retry > 0)) {
    frictions.push("verification_friction");
  }

  // Tooling friction: retries on tool calls
  if (counts.retry > 2) {
    frictions.push("tooling_friction");
  }

  // Interpretation friction: plan revisions indicate misunderstanding
  if (counts.plan_revision > 0) {
    frictions.push("interpretation_friction");
  }

  // Boundary friction: if we see both reads and writes across many files
  const files = getUniqueFiles(chunk.events);
  if (files.length > 10) {
    frictions.push("boundary_friction");
  }

  return frictions;
}

// --- Pattern detection ---

function detectPatterns(chunk: Chunk): string[] {
  const patterns: string[] = [];
  const counts = countEventTypes(chunk.events);
  const events = chunk.events;

  // Read-then-search pattern (agent reading then searching = lost)
  const readSearchPairs = countSequentialPairs(events, "file_read", "search");
  if (readSearchPairs > 2) {
    patterns.push(
      `Read-then-search pattern (${readSearchPairs}x) — agent repeatedly read files then searched for more context`
    );
  }

  // Edit-test-edit cycle (debugging loop)
  const editTestCycles = countEditTestCycles(events);
  if (editTestCycles > 1) {
    patterns.push(
      `Edit-test-edit cycle (${editTestCycles}x) — trial-and-error debugging loop`
    );
  }

  // Broad exploration pattern
  const uniqueReadFiles = getUniqueFilesByType(events, "file_read");
  if (uniqueReadFiles.length > 8) {
    patterns.push(
      `Broad exploration — read ${uniqueReadFiles.length} different files (may indicate unclear entry point)`
    );
  }

  // Focused implementation
  const writeFiles = getUniqueFilesByType(events, "file_write");
  if (writeFiles.length > 0 && writeFiles.length <= 3 && counts.file_write > 3) {
    patterns.push(
      `Focused implementation — ${counts.file_write} edits concentrated in ${writeFiles.length} file(s)`
    );
  }

  // Scattered implementation
  if (writeFiles.length > 5) {
    patterns.push(
      `Scattered implementation — writes spread across ${writeFiles.length} files (may indicate cross-cutting change)`
    );
  }

  return patterns;
}

// --- Helpers ---

function countEventTypes(
  events: SessionEvent[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  return counts;
}

function getUniqueFiles(events: SessionEvent[]): string[] {
  const files = new Set<string>();
  for (const e of events) {
    const data = e.data as Record<string, unknown>;
    if (typeof data.path === "string" && data.path) {
      files.add(data.path);
    }
  }
  return Array.from(files);
}

function getUniqueFilesByType(
  events: SessionEvent[],
  type: string
): string[] {
  const files = new Set<string>();
  for (const e of events) {
    if (e.type !== type) continue;
    const data = e.data as Record<string, unknown>;
    if (typeof data.path === "string" && data.path) {
      files.add(data.path);
    }
  }
  return Array.from(files);
}

function getRepeatedWriteFiles(events: SessionEvent[]): string[] {
  const writeCounts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "file_write") continue;
    const path = (e.data as FileWriteEvent).path;
    if (path) {
      writeCounts.set(path, (writeCounts.get(path) || 0) + 1);
    }
  }
  return Array.from(writeCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([path]) => path);
}

function countSequentialPairs(
  events: SessionEvent[],
  typeA: string,
  typeB: string
): number {
  let count = 0;
  for (let i = 0; i < events.length - 1; i++) {
    if (events[i].type === typeA && events[i + 1].type === typeB) {
      count++;
    }
  }
  return count;
}

function countEditTestCycles(events: SessionEvent[]): number {
  let cycles = 0;
  for (let i = 0; i < events.length - 2; i++) {
    if (
      events[i].type === "file_write" &&
      events[i + 1].type === "test_run" &&
      events[i + 2].type === "file_write"
    ) {
      cycles++;
    }
  }
  return cycles;
}
