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

const program = new Command();

program
  .name("beaver")
  .description(
    "Analyze coding agent sessions, detect friction, suggest improvements."
  )
  .version("0.1.0");

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
  .action(async (sessionFile: string, options: AnalyzeOptions) => {
    try {
      const filePath = resolve(sessionFile);
      const raw = await readFile(filePath, "utf-8");

      // Parse session
      const session = parseClaudeSession(raw);

      // Extract events
      const events = extractEvents(session);

      // Chunk into phases
      const chunks = chunkSession(session, events);

      // Analyze each chunk (heuristic mode for MVP)
      const chunkAnalyses = chunks.map((chunk) => analyzeHeuristic(chunk));

      // Detect git context
      const gitContext = await detectGitContext(
        session.metadata.workingDirectory
      );

      // Finalize into report
      const report = finalize(session, chunkAnalyses, events, gitContext);

      // Render
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

interface AnalyzeOptions {
  format: "cli" | "markdown";
  output?: string;
  provider?: string;
}

program.parse();
