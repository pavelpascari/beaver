/**
 * CLI pretty-print renderer.
 *
 * Renders a Report as a colorful, readable terminal output.
 */

import type {
  Report,
  FrictionItem,
  Recommendation,
  Evidence,
} from "../types/report.js";
import type { FrictionScore } from "../types/scoring.js";
import type { ExpectedVsObserved } from "../types/expectations.js";

// ANSI color helpers (no dependencies needed)
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export function renderCli(report: Report): string {
  const lines: string[] = [];
  const w = 60; // width for bars

  lines.push("");
  lines.push(bold("  BEAVER SESSION ANALYSIS"));
  lines.push(dim(`  Generated ${report.metadata.generatedAt}`));
  const modeLabel =
    report.metadata.analysisMode +
    (report.metadata.llmModel ? ` (${report.metadata.llmModel})` : "");
  lines.push(dim(`  Mode: ${modeLabel} | Provider: ${report.metadata.sessionProvider}`));
  if (report.metadata.llmFallback && report.metadata.llmFallbackReason) {
    lines.push(
      dim(`  LLM fallback: ${report.metadata.llmFallbackReason}`)
    );
  }
  lines.push("");

  // ── Headline & Friction Score ──
  if (report.headline) {
    lines.push(`  ${bold(report.headline)}`);
    lines.push("");
  }

  lines.push(sectionHeader("FRICTION SCORE"));
  lines.push(renderFrictionScore(report.frictionScore, w));
  lines.push("");

  // ── Task Summary ──
  lines.push(sectionHeader("TASK SUMMARY"));
  for (const line of report.taskSummary.split("\n")) {
    lines.push(`  ${line}`);
  }
  lines.push("");

  // ── Expected vs Observed ──
  lines.push(sectionHeader("EXPECTED vs OBSERVED"));
  lines.push(renderExpectedVsObserved(report.expectedVsObserved));
  lines.push("");

  // ── Effort Breakdown ──
  lines.push(sectionHeader("EFFORT BREAKDOWN"));
  lines.push(
    effortBar("Exploration", report.effortBreakdown.exploration, blue, w)
  );
  lines.push(
    effortBar("Implementation", report.effortBreakdown.implementation, green, w)
  );
  lines.push(effortBar("Debugging", report.effortBreakdown.debugging, red, w));
  lines.push(
    effortBar("Verification", report.effortBreakdown.verification, yellow, w)
  );
  lines.push("");

  // ── Key Signals ──
  lines.push(sectionHeader("KEY SIGNALS"));
  const ks = report.keySignals;
  lines.push(`  Files read:     ${cyan(String(ks.filesRead))}`);
  lines.push(`  Files written:  ${cyan(String(ks.filesWritten))}`);
  lines.push(`  Searches:       ${cyan(String(ks.searches))}`);
  lines.push(`  Edits:          ${cyan(String(ks.edits))}`);
  lines.push(
    `  Retries:        ${ks.retries > 0 ? red(String(ks.retries)) : dim("0")}`
  );
  lines.push(`  Test runs:      ${cyan(String(ks.testRuns))}`);
  lines.push(`  Commands:       ${cyan(String(ks.commands))}`);
  if (ks.uniqueFilesTouched.length > 0) {
    lines.push(`  Unique files:   ${cyan(String(ks.uniqueFilesTouched.length))}`);
  }
  lines.push("");

  // ── Friction Analysis ──
  lines.push(sectionHeader("FRICTION ANALYSIS"));
  lines.push(renderFrictionItem("PRIMARY", report.frictionAnalysis.primary));
  for (const secondary of report.frictionAnalysis.secondary) {
    lines.push(renderFrictionItem("SECONDARY", secondary));
  }
  lines.push("");

  // ── Evidence ──
  if (report.evidence.length > 0) {
    lines.push(sectionHeader("EVIDENCE"));
    for (const ev of report.evidence.slice(0, 10)) {
      lines.push(renderEvidence(ev));
    }
    if (report.evidence.length > 10) {
      lines.push(dim(`  ... and ${report.evidence.length - 10} more`));
    }
    lines.push("");
  }

  // ── Recommendations ──
  if (report.recommendations.length > 0) {
    lines.push(sectionHeader("RECOMMENDATIONS"));
    for (let i = 0; i < report.recommendations.length; i++) {
      lines.push(renderRecommendation(i + 1, report.recommendations[i]));
    }
    lines.push("");
  }

  // ── Git Context ──
  if (report.gitContext.detected) {
    lines.push(sectionHeader("GIT CONTEXT"));
    lines.push(`  Type: ${report.gitContext.type}`);
    for (const repo of report.gitContext.repos) {
      lines.push(`  Repo: ${repo.path}`);
      if (repo.branch) lines.push(`  Branch: ${repo.branch}`);
      if (repo.hasUncommittedChanges) {
        lines.push(`  ${yellow("Has uncommitted changes")}`);
      }
    }
    lines.push("");
  }

  // ── Phase Details ──
  lines.push(sectionHeader("PHASE DETAILS"));
  for (const chunk of report.chunks) {
    lines.push(
      `  ${phaseIcon(chunk.phase)} ${bold(chunk.phase.toUpperCase())} ${dim(`(${chunk.eventCount} events)`)}`
    );
    lines.push(`    ${chunk.summary}`);
    if (chunk.insight) {
      lines.push(`    ${cyan("✦")} ${chunk.insight}`);
    }
    if (chunk.effortSignals.length > 0) {
      for (const signal of chunk.effortSignals) {
        const color =
          signal.weight === "high"
            ? red
            : signal.weight === "medium"
              ? yellow
              : dim;
        lines.push(`    ${color(`[${signal.weight}]`)} ${signal.description}`);
      }
    }
    if (chunk.patterns.length > 0) {
      for (const pattern of chunk.patterns) {
        lines.push(`    ${magenta("→")} ${pattern}`);
      }
    }
    lines.push("");
  }

  lines.push(dim("  ─".repeat(30)));
  lines.push(
    dim(
      `  Beaver v${report.metadata.beaverVersion} — Compounding improvement, one session at a time.`
    )
  );
  if (report.metadata.llmTokensUsed) {
    lines.push(dim(`  LLM tokens: ${report.metadata.llmTokensUsed}`));
  }
  lines.push("");

  return lines.join("\n");
}

// --- New sections ---

function renderFrictionScore(score: FrictionScore, width: number): string {
  const lines: string[] = [];
  const color = scoreColor(score.overall);
  const gradeColor = gradeDisplayColor(score.grade);

  lines.push(`  ${color(String(score.overall) + "/100")}  ${gradeColor("grade " + score.grade)}  ${dim(score.headline)}`);
  lines.push(`  ${scoreBar(score.overall, width, color)}`);

  if (Object.keys(score.byCategory).length > 0) {
    lines.push("");
    const entries = Object.entries(score.byCategory).sort((a, b) => b[1] - a[1]);
    for (const [cat, pts] of entries) {
      lines.push(
        `    ${dim("•")} ${formatCategory(cat)}: ${scoreColor(pts)(String(pts) + " pts")}`
      );
    }
  }

  if (score.contributors.length > 0) {
    lines.push("");
    lines.push(`    ${dim("Top contributors:")}`);
    for (const c of score.contributors.slice(0, 3)) {
      lines.push(
        `    ${red("+" + c.points)} ${c.rationale}`
      );
    }
  }

  return lines.join("\n");
}

function renderExpectedVsObserved(e: ExpectedVsObserved): string {
  const lines: string[] = [];
  lines.push(
    `  ${bold("Complexity:")} ${cyan(e.taskComplexity ?? "unknown")}`
  );
  lines.push(`  ${green("Expected:")} ${e.expectedNarrative}`);
  lines.push(`  ${yellow("Observed:")} ${e.observedNarrative}`);
  if (e.biggestDivergence) {
    lines.push(`  ${magenta("Biggest gap:")} ${e.biggestDivergence}`);
  }

  lines.push("");
  lines.push(
    `    ${dim("metric".padEnd(26))} ${dim("expected".padStart(10))} ${dim("observed".padStart(10))} ${dim("Δ".padStart(6))}`
  );
  for (const d of e.deltas) {
    const arrow =
      d.direction === "over"
        ? red("▲")
        : d.direction === "under"
          ? blue("▼")
          : green("=");
    const delta = d.delta > 0 ? "+" + d.delta : String(d.delta);
    lines.push(
      `    ${d.metric.padEnd(26)} ${String(d.expected).padStart(10)} ${String(d.observed).padStart(10)} ${arrow} ${dim(delta.padStart(4))}`
    );
  }
  return lines.join("\n");
}

// --- Existing helpers ---

function sectionHeader(title: string): string {
  return `  ${bold("─── " + title + " " + "─".repeat(Math.max(0, 50 - title.length)))}`;
}

function effortBar(
  label: string,
  pct: number,
  colorFn: (s: string) => string,
  width: number
): string {
  const barWidth = Math.max(0, Math.round((pct / 100) * (width - 20)));
  const bar =
    colorFn("█".repeat(barWidth)) +
    dim("░".repeat(Math.max(0, width - 20 - barWidth)));
  const padLabel = label.padEnd(16);
  return `  ${padLabel} ${bar} ${pct}%`;
}

function scoreBar(
  score: number,
  width: number,
  colorFn: (s: string) => string
): string {
  const barWidth = Math.max(0, Math.round((score / 100) * (width - 10)));
  return (
    colorFn("█".repeat(barWidth)) +
    dim("░".repeat(Math.max(0, width - 10 - barWidth)))
  );
}

function scoreColor(score: number): (s: string) => string {
  if (score < 10) return green;
  if (score < 25) return cyan;
  if (score < 45) return yellow;
  if (score < 70) return (s: string) => `\x1b[38;5;208m${s}\x1b[0m`;
  return red;
}

function gradeDisplayColor(g: string): (s: string) => string {
  switch (g) {
    case "A":
      return green;
    case "B":
      return cyan;
    case "C":
      return yellow;
    case "D":
      return (s: string) => `\x1b[38;5;208m${s}\x1b[0m`;
    case "F":
      return red;
    default:
      return dim;
  }
}

function renderFrictionItem(level: string, item: FrictionItem): string {
  const severityColor =
    item.severity === "high" ? red : item.severity === "medium" ? yellow : dim;

  const lines: string[] = [];
  lines.push(
    `  ${severityColor(`[${level}]`)} ${bold(formatCategory(item.category))} ${severityColor(`(${item.severity})`)}`
  );
  lines.push(`    ${item.description}`);
  if (item.evidence.length > 0) {
    for (const ev of item.evidence.slice(0, 3)) {
      lines.push(`    ${dim("•")} ${dim(ev)}`);
    }
  }
  return lines.join("\n");
}

function renderEvidence(ev: Evidence): string {
  return [`  ${yellow("●")} ${ev.claim}`, `    ${dim(ev.support)}`].join("\n");
}

function renderRecommendation(num: number, rec: Recommendation): string {
  const impactColor =
    rec.impact === "high" ? green : rec.impact === "medium" ? yellow : dim;

  const lines: string[] = [
    `  ${cyan(String(num) + ".")} ${bold(rec.title)}${rec.source === "llm" ? dim(" (llm)") : ""}`,
    `    ${rec.description}`,
  ];

  if (rec.targets && rec.targets.length > 0) {
    lines.push(`    ${dim("Targets:")} ${rec.targets.map((t) => cyan(t)).join(", ")}`);
  }
  if (rec.successMetric) {
    lines.push(`    ${dim("Success:")} ${rec.successMetric}`);
  }
  if (rec.snippet) {
    lines.push(`    ${dim("Snippet:")}`);
    for (const line of rec.snippet.split("\n").slice(0, 6)) {
      lines.push(`      ${dim(line)}`);
    }
  }
  lines.push(
    `    ${impactColor(`Impact: ${rec.impact}`)} | Effort: ${rec.effort} | ${dim(formatCategory(rec.category))}`
  );
  lines.push("");
  return lines.join("\n");
}

function formatCategory(cat: string): string {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function phaseIcon(phase: string): string {
  const icons: Record<string, string> = {
    exploration: blue("◆"),
    implementation: green("◆"),
    debugging: red("◆"),
    verification: yellow("◆"),
  };
  return icons[phase] || "◆";
}
