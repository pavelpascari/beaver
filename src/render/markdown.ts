/**
 * Markdown renderer.
 *
 * Renders a Report as a clean Markdown document.
 */

import type {
  Report,
  FrictionItem,
  Recommendation,
  Evidence,
} from "../types/report.js";
import type { FrictionScore } from "../types/scoring.js";
import type { ExpectedVsObserved } from "../types/expectations.js";

export function renderMarkdown(report: Report): string {
  const lines: string[] = [];

  lines.push("# Beaver Session Analysis");
  lines.push("");
  lines.push(`> Generated: ${report.metadata.generatedAt}`);
  const modeLabel =
    report.metadata.analysisMode +
    (report.metadata.llmModel ? ` (${report.metadata.llmModel})` : "");
  lines.push(
    `> Mode: ${modeLabel} | Provider: ${report.metadata.sessionProvider}`
  );
  if (report.metadata.llmFallback && report.metadata.llmFallbackReason) {
    lines.push(`> LLM fallback: ${report.metadata.llmFallbackReason}`);
  }
  lines.push("");

  // Headline
  if (report.headline) {
    lines.push(`## TL;DR`);
    lines.push("");
    lines.push(`**${report.headline}**`);
    lines.push("");
  }

  // Friction Score
  lines.push("## Friction Score");
  lines.push("");
  lines.push(renderFrictionScoreMd(report.frictionScore));
  lines.push("");

  // Task Summary
  lines.push("## Task Summary");
  lines.push("");
  lines.push("```");
  lines.push(report.taskSummary);
  lines.push("```");
  lines.push("");

  // Expected vs Observed
  lines.push("## Expected vs Observed");
  lines.push("");
  lines.push(renderExpectedVsObservedMd(report.expectedVsObserved));
  lines.push("");

  // Effort Breakdown
  lines.push("## Effort Breakdown");
  lines.push("");
  lines.push("| Phase | Effort |");
  lines.push("|-------|--------|");
  lines.push(
    `| Exploration | ${report.effortBreakdown.exploration}% ${progressBar(report.effortBreakdown.exploration)} |`
  );
  lines.push(
    `| Implementation | ${report.effortBreakdown.implementation}% ${progressBar(report.effortBreakdown.implementation)} |`
  );
  lines.push(
    `| Debugging | ${report.effortBreakdown.debugging}% ${progressBar(report.effortBreakdown.debugging)} |`
  );
  lines.push(
    `| Verification | ${report.effortBreakdown.verification}% ${progressBar(report.effortBreakdown.verification)} |`
  );
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
    lines.push(
      `### ${phaseEmoji(chunk.phase)} ${capitalize(chunk.phase)} (${chunk.eventCount} events)`
    );
    lines.push("");
    lines.push(chunk.summary);
    lines.push("");

    if (chunk.insight) {
      lines.push(`> ✦ ${chunk.insight}`);
      lines.push("");
    }

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
  lines.push(
    `*Beaver v${report.metadata.beaverVersion} — Compounding improvement, one session at a time.*`
  );
  if (report.metadata.llmTokensUsed) {
    lines.push(`*LLM tokens: ${report.metadata.llmTokensUsed}*`);
  }
  lines.push("");

  return lines.join("\n");
}

// --- New sections ---

function renderFrictionScoreMd(score: FrictionScore): string {
  const lines: string[] = [];
  const emoji = scoreEmoji(score.overall);
  lines.push(
    `**${score.overall}/100** ${emoji} — Grade **${score.grade}** — _${score.headline}_`
  );
  lines.push("");
  lines.push(`\`${scoreBarMd(score.overall)}\``);
  lines.push("");

  if (Object.keys(score.byCategory).length > 0) {
    lines.push("| Category | Points |");
    lines.push("|----------|--------|");
    const entries = Object.entries(score.byCategory).sort((a, b) => b[1] - a[1]);
    for (const [cat, pts] of entries) {
      lines.push(`| ${formatCategory(cat)} | ${pts} |`);
    }
    lines.push("");
  }

  if (score.contributors.length > 0) {
    lines.push("**Top contributors:**");
    lines.push("");
    for (const c of score.contributors.slice(0, 5)) {
      lines.push(`- \`+${c.points}\` ${c.rationale}`);
    }
  }

  return lines.join("\n");
}

function renderExpectedVsObservedMd(e: ExpectedVsObserved): string {
  const lines: string[] = [];
  lines.push(`**Task complexity:** \`${e.taskComplexity ?? "unknown"}\``);
  lines.push("");
  lines.push(`- **Expected:** ${e.expectedNarrative}`);
  lines.push(`- **Observed:** ${e.observedNarrative}`);
  if (e.biggestDivergence) {
    lines.push(`- **Biggest divergence:** ${e.biggestDivergence}`);
  }
  lines.push("");
  lines.push("| Metric | Expected | Observed | Δ | Interpretation |");
  lines.push("|--------|---------:|---------:|:-:|----------------|");
  for (const d of e.deltas) {
    const arrow = d.direction === "over" ? "🔺" : d.direction === "under" ? "🔻" : "✓";
    const delta = d.delta > 0 ? `+${d.delta}` : `${d.delta}`;
    lines.push(
      `| ${d.metric} | ${d.expected} | ${d.observed} | ${arrow} ${delta} | ${d.interpretation} |`
    );
  }
  return lines.join("\n");
}

// --- Helpers ---

function progressBar(pct: number): string {
  const filled = Math.round(pct / 5);
  const empty = 20 - filled;
  return "`" + "█".repeat(filled) + "░".repeat(empty) + "`";
}

function scoreBarMd(score: number): string {
  const filled = Math.round(score / 5);
  return "█".repeat(filled) + "░".repeat(20 - filled);
}

function scoreEmoji(score: number): string {
  if (score < 10) return "🟢";
  if (score < 25) return "🟢";
  if (score < 45) return "🟡";
  if (score < 70) return "🟠";
  return "🔴";
}

function renderFrictionItemMd(item: FrictionItem): string {
  const lines: string[] = [];
  const severity =
    item.severity === "high" ? "🔴" : item.severity === "medium" ? "🟡" : "🟢";
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
  const sourceTag = rec.source === "llm" ? " _(llm)_" : "";
  const lines: string[] = [
    `### ${num}. ${rec.title}${sourceTag}`,
    "",
    rec.description,
    "",
  ];

  if (rec.targets && rec.targets.length > 0) {
    lines.push(`**Targets:** ${rec.targets.map((t) => `\`${t}\``).join(", ")}`);
    lines.push("");
  }
  if (rec.successMetric) {
    lines.push(`**Success metric:** ${rec.successMetric}`);
    lines.push("");
  }
  if (rec.snippet) {
    lines.push("```");
    lines.push(rec.snippet);
    lines.push("```");
    lines.push("");
  }
  lines.push(
    `${impact} **Impact:** ${rec.impact} | **Effort:** ${rec.effort} | _${formatCategory(rec.category)}_`
  );
  return lines.join("\n");
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
