#!/usr/bin/env node

import { Command } from "commander";
import { readFile } from "fs/promises";
import { resolve } from "path";
import { parseClaudeSession } from "../parser/claude.js";
import { extractEvents } from "../events/extractor.js";
import { chunkSession } from "../chunking/chunker.js";
import { analyzeHeuristic } from "../analysis/heuristic.js";
import { finalize } from "../finalizer/finalizer.js";
import { detectGitContext } from "../analysis/git.js";
import { renderCli } from "../render/cli.js";
import { renderMarkdown } from "../render/markdown.js";
import { computeFrictionScore } from "../analysis/scoring.js";
import { computeExpectedVsObserved } from "../analysis/expectations.js";
import { createLLMClient, LLMConfigError } from "../analysis/llm-client.js";
import { runLLMInsight } from "../analysis/llm-insight.js";

const program = new Command();

program
  .name("beaver")
  .description(
    "Analyze coding agent sessions, detect friction, suggest improvements."
  )
  .version("0.2.0");

program
  .command("analyze")
  .description("Analyze a coding agent session file")
  .argument("<session_file>", "Path to the session file (JSON or NDJSON)")
  .option("-f, --format <format>", "Output format: cli or markdown", "cli")
  .option("-o, --output <path>", "Write report to file instead of stdout")
  .option(
    "--provider <provider>",
    "Session provider: claude (auto-detected if omitted)"
  )
  .option(
    "--llm",
    "Enable LLM-powered insight layer (uses ANTHROPIC_API_KEY or Claude Code OAuth)"
  )
  .option("--model <id>", "Override LLM model (default: claude-sonnet-4-6)")
  .option(
    "--api-key <key>",
    "Anthropic API key (defaults to ANTHROPIC_API_KEY env var)"
  )
  .option(
    "--auth <mode>",
    "Auth mode: auto | api_key | oauth (default: auto)",
    "auto"
  )
  .option(
    "--llm-timeout <ms>",
    "LLM request timeout in milliseconds",
    (v) => parseInt(v, 10),
    60_000
  )
  .action(async (sessionFile: string, options: AnalyzeOptions) => {
    try {
      const filePath = resolve(sessionFile);
      const raw = await readFile(filePath, "utf-8");

      const session = parseClaudeSession(raw);
      const events = extractEvents(session);
      const chunks = chunkSession(session, events);
      const chunkAnalyses = chunks.map((chunk) => analyzeHeuristic(chunk));
      const gitContext = await detectGitContext(
        session.metadata.workingDirectory
      );

      let llmInsight;
      let llmFallbackReason: string | undefined;

      if (options.llm) {
        try {
          const client = createLLMClient({
            apiKey: options.apiKey,
            authMode: options.auth,
            model: options.model,
            timeoutMs: options.llmTimeout,
          });
          process.stderr.write(
            `[beaver] auth=${client.authMode} base=${client.baseUrl}\n`
          );

          // Feed the LLM the deterministic signals it needs to reason.
          const keySignalsForLLM = deriveKeySignals(events);
          const score = computeFrictionScore({
            chunkAnalyses,
            events,
            keySignals: keySignalsForLLM,
          });
          const expectedVsObserved = computeExpectedVsObserved({
            session,
            keySignals: keySignalsForLLM,
            chunkAnalyses,
          });

          process.stderr.write(
            `[beaver] calling ${client.model} for insight layer...\n`
          );
          const result = await runLLMInsight(client, {
            session,
            events,
            chunkAnalyses,
            keySignals: keySignalsForLLM,
            gitContext,
            frictionScore: score,
            expectedVsObserved,
          });

          if (result.ok) {
            llmInsight = result.insight;
            process.stderr.write(
              `[beaver] insight layer ok (${result.insight.tokensUsed} tokens)\n`
            );
          } else {
            llmFallbackReason = result.reason;
            process.stderr.write(
              `[beaver] LLM insight failed, falling back to heuristic: ${result.reason}\n`
            );
          }
        } catch (err) {
          if (err instanceof LLMConfigError) {
            llmFallbackReason = err.message;
            process.stderr.write(
              `[beaver] LLM disabled: ${err.message}. Falling back to heuristic.\n`
            );
          } else {
            throw err;
          }
        }
      }

      const report = finalize(session, chunkAnalyses, events, gitContext, {
        llmInsight,
        llmFallbackReason,
        llmRequested: Boolean(options.llm),
      });

      const output =
        options.format === "markdown"
          ? renderMarkdown(report)
          : renderCli(report);

      if (options.output) {
        const { writeFile } = await import("fs/promises");
        await writeFile(resolve(options.output), output, "utf-8");
        console.log(`Report written to ${options.output}`);
      } else {
        console.log(output);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Error: ${message}`);
      process.exit(1);
    }
  });

// Minimal local copy to avoid circular import with finalizer — finalizer
// will recompute internally, we only use this for the LLM prompt inputs.
function deriveKeySignals(events: import("../types/events.js").SessionEvent[]) {
  const files = new Set<string>();
  let filesRead = 0,
    filesWritten = 0,
    searches = 0,
    retries = 0,
    testRuns = 0,
    commands = 0,
    edits = 0;
  for (const e of events) {
    const d = e.data as { path?: string };
    switch (e.type) {
      case "file_read":
        filesRead++;
        if (d.path) files.add(d.path);
        break;
      case "file_write":
        filesWritten++;
        edits++;
        if (d.path) files.add(d.path);
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

interface AnalyzeOptions {
  format: "cli" | "markdown";
  output?: string;
  provider?: string;
  llm?: boolean;
  model?: string;
  apiKey?: string;
  auth: "auto" | "api_key" | "oauth";
  llmTimeout: number;
}

program.parse();
