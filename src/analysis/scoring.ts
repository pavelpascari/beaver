/**
 * Friction scoring.
 *
 * Converts chunk analyses + raw events into a numeric score (0-100)
 * with a per-category breakdown and ranked contributor list.
 *
 * The scoring is deterministic and intentionally simple — it's an aggregate
 * of weighted "penalty points" from observable signals. It does NOT call an
 * LLM. The LLM layer consumes this score as input to produce better narrative.
 */

import type { ChunkAnalysis, FrictionCategory } from "../types/chunks.js";
import type { SessionEvent } from "../types/events.js";
import type { FrictionScore, FrictionGrade, ScoreContributor } from "../types/scoring.js";

/**
 * Contribution table. Each entry adds `points` (capped by `cap`) per unit
 * of the measured signal, attributed to `category`. Phrased as "friction
 * penalty per unit of avoidable activity".
 */
interface PenaltyRule {
  id: string;
  category: FrictionCategory;
  rationale: (units: number) => string;
  /** Soft threshold: units below this contribute nothing. */
  threshold: number;
  /** Points added per unit above the threshold. */
  pointsPerUnit: number;
  /** Maximum points this rule can contribute. */
  cap: number;
}

const RULES: PenaltyRule[] = [
  {
    id: "search_heavy",
    category: "retrieval_friction",
    threshold: 3,
    pointsPerUnit: 2,
    cap: 18,
    rationale: (n) =>
      `${n} searches — agent struggled to locate information efficiently`,
  },
  {
    id: "excessive_reads",
    category: "discovery_friction",
    threshold: 5,
    pointsPerUnit: 1.5,
    cap: 18,
    rationale: (n) =>
      `${n} file reads — excessive exploration suggests unclear entry points`,
  },
  {
    id: "retry_loops",
    category: "tooling_friction",
    threshold: 0,
    pointsPerUnit: 5,
    cap: 20,
    rationale: (n) => `${n} retries — tools or edits failed and had to be repeated`,
  },
  {
    id: "plan_revisions",
    category: "interpretation_friction",
    threshold: 0,
    pointsPerUnit: 10,
    cap: 25,
    rationale: (n) =>
      `${n} plan revision(s) — approach changed mid-task, indicating misunderstanding`,
  },
  {
    id: "test_thrash",
    category: "verification_friction",
    threshold: 2,
    pointsPerUnit: 3,
    cap: 15,
    rationale: (n) => `${n} test runs — feedback loop required many iterations`,
  },
  {
    id: "boundary_sprawl",
    category: "boundary_friction",
    threshold: 8,
    pointsPerUnit: 1.5,
    cap: 15,
    rationale: (n) =>
      `${n} unique files touched — change spread across many modules`,
  },
  {
    id: "repeated_edits",
    category: "tooling_friction",
    threshold: 0,
    pointsPerUnit: 3,
    cap: 9,
    rationale: (n) =>
      `${n} file(s) edited multiple times — iterative edits suggest unclear target state`,
  },
];

export interface ScoreInputs {
  chunkAnalyses: ChunkAnalysis[];
  events: SessionEvent[];
  keySignals: {
    filesRead: number;
    filesWritten: number;
    searches: number;
    retries: number;
    testRuns: number;
    uniqueFilesTouched: string[];
  };
}

export function computeFrictionScore(inputs: ScoreInputs): FrictionScore {
  const { keySignals, events } = inputs;

  const units: Record<string, number> = {
    search_heavy: keySignals.searches,
    excessive_reads: keySignals.filesRead,
    retry_loops: keySignals.retries,
    plan_revisions: events.filter((e) => e.type === "plan_revision").length,
    test_thrash: keySignals.testRuns,
    boundary_sprawl: keySignals.uniqueFilesTouched.length,
    repeated_edits: countRepeatedWrites(events),
  };

  const contributors: ScoreContributor[] = [];
  const byCategory: Partial<Record<FrictionCategory, number>> = {};
  let overall = 0;

  for (const rule of RULES) {
    const n = units[rule.id] ?? 0;
    if (n <= rule.threshold) continue;

    const rawPoints = (n - rule.threshold) * rule.pointsPerUnit;
    const points = Math.min(rule.cap, Math.round(rawPoints * 10) / 10);
    if (points <= 0) continue;

    overall += points;
    byCategory[rule.category] = (byCategory[rule.category] ?? 0) + points;
    contributors.push({
      signal: rule.id,
      points,
      rationale: rule.rationale(n),
      category: rule.category,
    });
  }

  overall = Math.min(100, Math.round(overall));

  // Round per-category values to 1 decimal for display stability.
  for (const k of Object.keys(byCategory) as FrictionCategory[]) {
    byCategory[k] = Math.round((byCategory[k] ?? 0) * 10) / 10;
  }

  contributors.sort((a, b) => b.points - a.points);

  return {
    overall,
    grade: gradeFromScore(overall),
    byCategory,
    contributors,
    headline: buildHeadline(overall, byCategory, contributors),
  };
}

export function gradeFromScore(score: number): FrictionGrade {
  if (score < 10) return "A";
  if (score < 25) return "B";
  if (score < 45) return "C";
  if (score < 70) return "D";
  return "F";
}

function buildHeadline(
  overall: number,
  byCategory: Partial<Record<FrictionCategory, number>>,
  contributors: ScoreContributor[]
): string {
  const qual =
    overall < 10
      ? "Clean run"
      : overall < 25
        ? "Light friction"
        : overall < 45
          ? "Moderate friction"
          : overall < 70
            ? "Heavy friction"
            : "Severe friction";

  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return `${qual} — nothing notable`;

  const top = entries[0][0] as FrictionCategory;
  const label = top.replace(/_friction$/, "").replace(/_/g, " ");
  const topContrib = contributors[0];
  const flavor = topContrib ? ` (${topContrib.signal})` : "";

  return `${qual} — ${label}-dominated${flavor}`;
}

function countRepeatedWrites(events: SessionEvent[]): number {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "file_write") continue;
    const path = (e.data as { path?: string }).path;
    if (!path) continue;
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  let repeated = 0;
  for (const c of counts.values()) if (c > 1) repeated++;
  return repeated;
}
