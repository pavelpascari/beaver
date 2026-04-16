/**
 * Friction scoring model.
 *
 * A numeric, multi-dimensional view of how much avoidable effort
 * a session contained. Scores are on a 0-100 scale where:
 *   0   = no friction at all (perfect session)
 *   100 = catastrophic friction (agent is spinning out)
 */

import type { FrictionCategory } from "./chunks.js";

export interface FrictionScore {
  /** Overall session friction (0-100). */
  overall: number;
  /** Qualitative grade derived from overall. */
  grade: FrictionGrade;
  /** Per-category breakdown. A category missing from the map scored 0. */
  byCategory: Partial<Record<FrictionCategory, number>>;
  /** Contributing signals, ranked by weight. */
  contributors: ScoreContributor[];
  /** Human-readable one-liner (e.g. "Moderate — discovery-dominated"). */
  headline: string;
}

export type FrictionGrade = "A" | "B" | "C" | "D" | "F";

export interface ScoreContributor {
  /** Short label, e.g. "search_heavy", "plan_changes", "boundary_sprawl". */
  signal: string;
  /** Points this contributor added to the overall score. */
  points: number;
  /** Short explanation of why. */
  rationale: string;
  /** Which friction category this contributor rolls up under. */
  category: FrictionCategory;
}
