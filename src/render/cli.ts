/**
 * CLI pretty-print renderer.
 *
 * Renders a Report as a colorful, readable terminal output.
 */

import type { Report, FrictionItem, Recommendation, Evidence } from "../types/report.js";

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
  lines.push(dim(`  Mode: ${report.metadata.analysisMode} | Provider: ${report.metadata.sessionProvider}`));
  lines.push("");

  // ── Task Summary ──
  lines.push(sectionHeader("TASK SUMMARY"));
  for (const line of report.taskSummary.split("\n")) {
    lines.push(`  ${line}`);
  }
  lines.push("");

  // ── Effort Breakdown ──
  lines.push(sectionHeader("EFFORT BREAKDOWN"));
  lines.push(effortBar("Exploration", report.effortBreakdown.exploration, blue, w));
  lines.push(effortBar("Implementation", report.effortBreakdown.implementation, green, w));
  lines.push(effortBar("Debugging", report.effortBreakdown.debugging, red, w));
  lines.push(effortBar("Verification", report.effortBreakdown.verification, yellow, w));
  lines.push("");

  // ── Key Signals ──
  lines.push(sectionHeader("KEY SIGNALS"));
  const ks = report.keySignals;
  lines.push(`  Files read:     ${cyan(String(ks.filesRead))}`);
  lines.push(`  Files written:  ${cyan(String(ks.filesWritten))}`);
  lines.push(`  Searches:       ${cyan(String(ks.searches))}`);
  lines.push(`  Edits:          ${cyan(String(ks.edits))}`);
  lines.push(`  Retries:        ${ks.retries > 0 ? red(String(ks.retries)) : dim("0")}`);
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
    lines.push(`  ${phaseIcon(chunk.phase)} ${bold(chunk.phase.toUpperCase())} ${dim(`(${chunk.eventCount} events)`)}`);
    lines.push(`    ${chunk.summary}`);
    if (chunk.effortSignals.length > 0) {
      for (const signal of chunk.effortSignals) {
        const color = signal.weight === "high" ? red : signal.weight === "medium" ? yellow : dim;
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
  lines.push(dim("  Beaver v0.1.0 — Compounding improvement, one session at a time."));
  lines.push("");

  return lines.join("\n");
}

// --- Helpers ---

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
  const bar = colorFn("█".repeat(barWidth)) + dim("░".repeat(Math.max(0, width - 20 - barWidth)));
  const padLabel = label.padEnd(16);
  return `  ${padLabel} ${bar} ${pct}%`;
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
  return [
    `  ${yellow("●")} ${ev.claim}`,
    `    ${dim(ev.support)}`,
  ].join("\n");
}

function renderRecommendation(num: number, rec: Recommendation): string {
  const impactColor =
    rec.impact === "high" ? green : rec.impact === "medium" ? yellow : dim;

  return [
    `  ${cyan(String(num) + ".")} ${bold(rec.title)}`,
    `    ${rec.description}`,
    `    ${impactColor(`Impact: ${rec.impact}`)} | Effort: ${rec.effort} | ${dim(formatCategory(rec.category))}`,
    "",
  ].join("\n");
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
