/**
 * Claude CLI delegating transport.
 *
 * Instead of calling /v1/messages directly, this spawns the local `claude`
 * binary in print mode (`claude -p --output-format json`) and uses its
 * existing auth (whatever the user has configured: OAuth, keychain, env, etc).
 *
 * Useful when:
 *   - Running inside the Claude Code harness, where the harness's OAuth token
 *     is scoped to /v1/code/sessions/* and won't authenticate against
 *     /v1/messages directly.
 *   - The user already has `claude` set up locally and would rather not
 *     manage a separate API key for Beaver.
 *
 * Trade-offs:
 *   - Adds shell-spawn latency and the system-prompt overhead Claude Code
 *     bakes into every call (visible as cache_creation_input_tokens). Fine
 *     for a single per-session analysis call.
 *   - Beaver never sees the user's credentials.
 */

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { LLMClient, LLMResponse } from "./llm-client.js";
import { LLMAPIError, LLMConfigError } from "./llm-client.js";

export interface ClaudeCliClientOptions {
  /** Path to the claude binary. Defaults to "claude" (resolved via PATH). */
  binary?: string;
  /** Model id passed to `--model`. */
  model?: string;
  /** Wall-clock timeout in ms. */
  timeoutMs?: number;
  /** Optional max-budget passed to `--max-budget-usd`. */
  maxBudgetUsd?: number;
  /**
   * Working directory for the child process. Defaults to os.tmpdir() to
   * avoid loading project context (CLAUDE.md, git status, etc) that would
   * push the model into multi-turn tool-using behavior. Overriding this is
   * for tests; in production the neutral cwd dramatically reduces latency.
   */
  cwd?: string;
  /**
   * System prompt sent to the spawned claude session. Defaults to a tight
   * "JSON-only generator" prompt that prevents tool use and explanatory
   * preamble. Replace with care.
   */
  systemPrompt?: string;
}

const DEFAULT_BINARY = "claude";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_SYSTEM_PROMPT =
  "You are a JSON-producing analysis engine. Read the user's prompt and return ONLY the requested JSON object. Do not call tools. Do not explain. Do not use markdown fences. Do not add commentary before or after the JSON.";

export function createClaudeCliClient(
  options: ClaudeCliClientOptions = {}
): LLMClient {
  const binary = options.binary ?? DEFAULT_BINARY;
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = options.cwd ?? tmpdir();
  const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  return {
    model,
    authMode: "claude_cli",
    baseUrl: `claude-cli://${binary}`,
    async call(prompt) {
      return runClaudeCli({
        binary,
        model,
        prompt,
        systemPrompt,
        timeoutMs,
        maxBudgetUsd: options.maxBudgetUsd,
        cwd,
      });
    },
  };
}

interface RunArgs {
  binary: string;
  model: string;
  prompt: string;
  systemPrompt: string;
  timeoutMs: number;
  maxBudgetUsd?: number;
  cwd: string;
}

interface ClaudeCliEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

async function runClaudeCli(args: RunArgs): Promise<LLMResponse> {
  const cliArgs = [
    "-p",
    "--output-format",
    "json",
    "--model",
    args.model,
    "--system-prompt",
    args.systemPrompt,
  ];
  if (args.maxBudgetUsd !== undefined) {
    cliArgs.push("--max-budget-usd", String(args.maxBudgetUsd));
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(args.binary, cliArgs, {
        cwd: args.cwd,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      reject(
        new LLMConfigError(
          `Failed to spawn ${args.binary}: ${(err as Error).message}`
        )
      );
      return;
    }

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new LLMAPIError(
          `claude CLI timed out after ${args.timeoutMs}ms`,
          0
        )
      );
    }, args.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        reject(
          new LLMConfigError(
            `claude binary not found on PATH (set --auth api_key or --api-key, or install Claude Code).`
          )
        );
      } else {
        reject(
          new LLMConfigError(`Failed to run ${args.binary}: ${err.message}`)
        );
      }
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new LLMAPIError(
            `claude CLI exited ${code}: ${stderr.slice(0, 500) || stdout.slice(0, 500)}`,
            code ?? 0
          )
        );
        return;
      }

      try {
        resolve(parseEnvelope(stdout, args.model));
      } catch (err) {
        reject(err);
      }
    });

    child.stdin.write(args.prompt);
    child.stdin.end();
  });
}

export function parseEnvelope(raw: string, fallbackModel: string): LLMResponse {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new LLMAPIError("claude CLI returned empty stdout", 0);
  }

  let parsed: ClaudeCliEnvelope;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new LLMAPIError(
      `claude CLI did not return JSON: ${(err as Error).message}. First 200 chars: ${trimmed.slice(0, 200)}`,
      0
    );
  }

  if (parsed.is_error || parsed.subtype !== "success") {
    throw new LLMAPIError(
      `claude CLI reported error: subtype=${parsed.subtype} type=${parsed.type}`,
      0
    );
  }

  const text = typeof parsed.result === "string" ? parsed.result.trim() : "";
  if (!text) {
    throw new LLMAPIError("claude CLI envelope had no `result` text", 0);
  }

  const inputTokens = parsed.usage?.input_tokens ?? 0;
  const outputTokens = parsed.usage?.output_tokens ?? 0;
  const cacheRead = parsed.usage?.cache_read_input_tokens ?? 0;
  const cacheCreate = parsed.usage?.cache_creation_input_tokens ?? 0;

  return {
    text,
    tokensUsed: inputTokens + outputTokens + cacheRead + cacheCreate,
    model: fallbackModel,
  };
}
