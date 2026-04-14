/**
 * Markdown renderer.
 *
 * Renders a Report as a clean Markdown document.
 */

import type { Report, FrictionItem, Recommendation, Evidence } from "../types/report.js";

export function renderMarkdown(report: Report): string {
  const lines: string[] = [];

  lines.push("# Beaver Session Analysis");
  lines.push("");
  lines.push(`> Generated: ${report.metadata.generatedAt}`);
  lines.push(`> Mode: ${report.metadata.analysisMode} | Provider: ${report.metadata.sessionProvider}`);
  lines.push("");

  // Task Summary
  lines.push("## Task Summary");
  lines.push("");
  lines.push("```");
  lines.push(report.taskSummary);
  lines.push("```");
  lines.push("");

  // Effort Breakdown
  lines.push("## Effort Breakdown");
  lines.push("");
  lines.push("| Phase | Effort |");
  lines.push("|-------|--------|");
  lines.push(`| Exploration | ${report.effortBreakdown.exploration}% ${progressBar(report.effortBreakdown.exploration)} |`);
  lines.push(`| Implementation | ${report.effortBreakdown.implementation}% ${progressBar(report.effortBreakdown.implementation)} |`);
  lines.push(`| Debugging | ${report.effortBreakdown.debugging}% ${progressBar(report.effortBreakdown.debugging)} |`);
  lines.push(`| Verification | ${report.effortBreakdown.verification}% ${progressBar(report.effortBreakdown.verification)} |`);
  lines.push("");

  // Key Signals
  lines.push("## Key Signals");
  lines.push("");
  const ks = report.keySignals;
  lines.push(`| Signal | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Files read | ${ks.filesRead} |`);
  lines.push(`| Files written | ${ks.filesWritten} |`);
  lines.push(`| Searches | ${ks.searches} |`);
  lines.push(`| Edits | ${ks.edits} |`);
  lines.push(`| Retries | ${ks.retries} |`);
  lines.push(`| Test runs | ${ks.testRuns} |`);
  lines.push(`| Commands | ${ks.commands} |`);
  lines.push(`| Unique files touched | ${ks.uniqueFilesTouched.length} |`);
  lines.push("");

  if (ks.uniqueFilesTouched.length > 0) {
    lines.push("<details>");
    lines.push("<summary>Files touched</summary>");
    lines.push("");
    for (const f of ks.uniqueFilesTouched) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  // Friction Analysis
  lines.push("## Friction Analysis");
  lines.push("");
  lines.push("### Primary Friction");
  lines.push("");
  lines.push(renderFrictionItemMd(report.frictionAnalysis.primary));
  lines.push("");

  if (report.frictionAnalysis.secondary.length > 0) {
    lines.push("### Secondary Friction");
    lines.push("");
    for (const item of report.frictionAnalysis.secondary) {
      lines.push(renderFrictionItemMd(item));
      lines.push("");
    }
  }

  // Evidence
  if (report.evidence.length > 0) {
    lines.push("## Evidence");
    lines.push("");
    for (const ev of report.evidence) {
      lines.push(renderEvidenceMd(ev));
    }
    lines.push("");
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push("## Recommendations");
    lines.push("");
    for (let i = 0; i < report.recommendations.length; i++) {
      lines.push(renderRecommendationMd(i + 1, report.recommendations[i]));
      lines.push("");
    }
  }

  // Git Context
  if (report.gitContext.detected) {
    lines.push("## Git Context");
    lines.push("");
    lines.push(`- **Type:** ${report.gitContext.type}`);
    for (const repo of report.gitContext.repos) {
      lines.push(`- **Repo:** \`${repo.path}\``);
      if (repo.branch) lines.push(`- **Branch:** \`${repo.branch}\``);
      if (repo.hasUncommittedChanges) {
        lines.push("- **Status:** Has uncommitted changes");
      }
    }
    lines.push("");
  }

  // Phase Details
  lines.push("## Phase Details");
  lines.push("");
  for (const chunk of report.chunks) {
    lines.push(`### ${phaseEmoji(chunk.phase)} ${capitalize(chunk.phase)} (${chunk.eventCount} events)`);
    lines.push("");
    lines.push(chunk.summary);
    lines.push("");

    if (chunk.effortSignals.length > 0) {
      lines.push("**Effort signals:**");
      for (const signal of chunk.effortSignals) {
        lines.push(`- \`[${signal.weight}]\` ${signal.description}`);
      }
      lines.push("");
    }

    if (chunk.patterns.length > 0) {
      lines.push("**Patterns:**");
      for (const pattern of chunk.patterns) {
        lines.push(`- ${pattern}`);
      }
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("*Beaver v0.1.0 — Compounding improvement, one session at a time.*");
  lines.push("");

  return lines.join("\n");
}

// --- Helpers ---

function progressBar(pct: number): string {
  const filled = Math.round(pct / 5);
  const empty = 20 - filled;
  return "`" + "█".repeat(filled) + "░".repeat(empty) + "`";
}

function renderFrictionItemMd(item: FrictionItem): string {
  const lines: string[] = [];
  const severity = item.severity === "high" ? "🔴" : item.severity === "medium" ? "🟡" : "🟢";
  lines.push(`${severity} **${formatCategory(item.category)}** (${item.severity})`);
  lines.push("");
  lines.push(item.description);

  if (item.evidence.length > 0) {
    lines.push("");
    for (const ev of item.evidence.slice(0, 5)) {
      lines.push(`> ${ev}`);
    }
  }

  return lines.join("\n");
}

function renderEvidenceMd(ev: Evidence): string {
  return `- **${ev.claim}**\n  ${ev.support} _(${ev.phase})_\n`;
}

function renderRecommendationMd(num: number, rec: Recommendation): string {
  const impact = rec.impact === "high" ? "🟢" : rec.impact === "medium" ? "🟡" : "⚪";
  return [
    `### ${num}. ${rec.title}`,
    "",
    rec.description,
    "",
    `${impact} **Impact:** ${rec.impact} | **Effort:** ${rec.effort} | _${formatCategory(rec.category)}_`,
  ].join("\n");
}

function formatCategory(cat: string): string {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function phaseEmoji(phase: string): string {
  const emojis: Record<string, string> = {
    exploration: "🔍",
    implementation: "🛠️",
    debugging: "🐛",
    verification: "✅",
  };
  return emojis[phase] || "📋";
}
