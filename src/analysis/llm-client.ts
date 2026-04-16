/**
 * Minimal Anthropic Messages client.
 *
 * Uses native fetch — no SDK dependency. Designed to be tiny and replaceable.
 * Exposes a single `callLLM` function that takes a prompt and returns the
 * text response plus token usage metadata.
 *
 * Supports two auth modes:
 *   - "api_key": sends `x-api-key` header. Typical for users with an Anthropic
 *     API key in `ANTHROPIC_API_KEY`.
 *   - "oauth":   sends `Authorization: Bearer <token>`. Used when running
 *     inside the Claude Code harness, where the OAuth token is exposed on a
 *     file descriptor (`CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR`). This lets
 *     Beaver analyze sessions without requiring a second credential.
 *
 * Resolution order (first match wins):
 *   1. Explicit `apiKey` option or "api_key" authMode with provided key
 *   2. "oauth" authMode if `CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR` is set
 *   3. `ANTHROPIC_API_KEY` env var
 *   4. OAuth FD fallback
 */

import { readSync, fstatSync } from "node:fs";

export type AuthMode = "api_key" | "oauth" | "auto";

export interface LLMClientOptions {
  /** Anthropic API key. Defaults to env ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Auth mode preference. "auto" picks the first available credential. */
  authMode?: AuthMode;
  /** Model id. Defaults to claude-sonnet-4-6. */
  model?: string;
  /** Max tokens for the response. */
  maxTokens?: number;
  /** Override base URL. Defaults to ANTHROPIC_BASE_URL env or api.anthropic.com. */
  baseUrl?: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
  /** How many times to retry on transient errors (5xx, network). */
  retries?: number;
}

export interface LLMResponse {
  text: string;
  tokensUsed: number;
  model: string;
}

export interface LLMClient {
  call(prompt: string, options?: { maxTokens?: number }): Promise<LLMResponse>;
  model: string;
  authMode: Exclude<AuthMode, "auto">;
  baseUrl: string;
}

export interface AuthResolution {
  mode: Exclude<AuthMode, "auto">;
  /** Credential value (secret — never log this). */
  credential: string;
  /** Human-readable description of where the credential came from. */
  source: string;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 2;
const OAUTH_ANTHROPIC_BETA = "oauth-2025-04-20";

/**
 * Resolve the effective auth credential + mode based on options and env.
 * Exported for testing — safe to call without network.
 */
export function resolveAuth(
  options: LLMClientOptions = {},
  env: NodeJS.ProcessEnv = process.env
): AuthResolution {
  const preferred: AuthMode = options.authMode ?? "auto";

  // 1. Explicit apiKey option wins unconditionally.
  if (options.apiKey) {
    return {
      mode: "api_key",
      credential: options.apiKey,
      source: "--api-key",
    };
  }

  // 2. If user explicitly asked for oauth, only try oauth.
  if (preferred === "oauth") {
    const oauth = readOAuthToken(env);
    if (oauth) return oauth;
    throw new LLMConfigError(
      "OAuth auth requested but CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR is unset or unreadable."
    );
  }

  // 3. If user explicitly asked for api_key, only try env key.
  if (preferred === "api_key") {
    if (env.ANTHROPIC_API_KEY) {
      return {
        mode: "api_key",
        credential: env.ANTHROPIC_API_KEY,
        source: "ANTHROPIC_API_KEY env",
      };
    }
    throw new LLMConfigError(
      "api_key auth requested but ANTHROPIC_API_KEY env var is not set."
    );
  }

  // 4. Auto mode: env key first, then OAuth FD.
  if (env.ANTHROPIC_API_KEY) {
    return {
      mode: "api_key",
      credential: env.ANTHROPIC_API_KEY,
      source: "ANTHROPIC_API_KEY env",
    };
  }

  const oauth = readOAuthToken(env);
  if (oauth) return oauth;

  throw new LLMConfigError(
    "No credential available. Set ANTHROPIC_API_KEY, pass --api-key, or run inside a Claude Code session with CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR."
  );
}

/**
 * OAuth tokens are short (<= a few KB). We perform a bounded single-shot
 * read rather than readFileSync, because the FD may be a pipe whose writer
 * never closes — readFileSync would block waiting for EOF.
 */
const OAUTH_FD_MAX_BYTES = 8192;

function readOAuthToken(env: NodeJS.ProcessEnv): AuthResolution | null {
  const fdStr = env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR;
  if (!fdStr) return null;
  const fd = Number.parseInt(fdStr, 10);
  if (!Number.isInteger(fd) || fd < 0) return null;

  try {
    // Use fstat size when available (regular file). For pipes it's 0 and we
    // rely on the max buffer bound.
    let size = OAUTH_FD_MAX_BYTES;
    try {
      const stat = fstatSync(fd);
      if (stat.size > 0 && stat.size <= OAUTH_FD_MAX_BYTES) {
        size = stat.size;
      }
    } catch {
      // fstat failures on pipes are fine — fall through to bounded read.
    }

    const buf = Buffer.alloc(size);
    const bytesRead = readSync(fd, buf, 0, buf.length, null);
    if (bytesRead <= 0) return null;
    const raw = buf.slice(0, bytesRead).toString("utf-8").trim();
    if (!raw) return null;
    return {
      mode: "oauth",
      credential: raw,
      source: `OAuth token (fd ${fd})`,
    };
  } catch {
    return null;
  }
}

export function createLLMClient(options: LLMClientOptions = {}): LLMClient {
  const auth = resolveAuth(options);
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl =
    options.baseUrl ??
    process.env.ANTHROPIC_BASE_URL ??
    "https://api.anthropic.com";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  return {
    model,
    authMode: auth.mode,
    baseUrl,
    async call(prompt, callOpts) {
      const maxTokens =
        callOpts?.maxTokens ?? options.maxTokens ?? DEFAULT_MAX_TOKENS;

      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await performCall(
            baseUrl,
            auth,
            model,
            prompt,
            maxTokens,
            timeoutMs
          );
        } catch (err) {
          lastErr = err;
          if (!isRetryable(err) || attempt === retries) break;
          await sleep(backoffMs(attempt));
        }
      }
      throw lastErr;
    },
  };
}

async function performCall(
  baseUrl: string,
  auth: AuthResolution,
  model: string,
  prompt: string,
  maxTokens: number,
  timeoutMs: number
): Promise<LLMResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: buildHeaders(auth),
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await safeReadBody(res);
      const err = new LLMAPIError(
        `Anthropic API error ${res.status}: ${body}`,
        res.status
      );
      throw err;
    }

    const json = (await res.json()) as AnthropicMessagesResponse;
    const text = extractText(json);
    const tokensUsed =
      (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0);
    return { text, tokensUsed, model: json.model ?? model };
  } finally {
    clearTimeout(timer);
  }
}

export function buildHeaders(auth: AuthResolution): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (auth.mode === "oauth") {
    headers["authorization"] = `Bearer ${auth.credential}`;
    headers["anthropic-beta"] = OAUTH_ANTHROPIC_BETA;
  } else {
    headers["x-api-key"] = auth.credential;
  }
  return headers;
}

function extractText(json: AnthropicMessagesResponse): string {
  if (!json.content || json.content.length === 0) return "";
  const textParts = json.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "");
  return textParts.join("").trim();
}

/**
 * Extract a JSON object from LLM text output, tolerant to:
 * - leading/trailing whitespace
 * - markdown code fences (```json ... ```)
 * - preamble/trailing commentary around the object
 */
export function parseJsonFromLLM<T = unknown>(text: string): T {
  const cleaned = stripCodeFences(text.trim());

  // Try whole-string parse first.
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall through to brace-balancing parse.
  }

  const extracted = extractBalancedJson(cleaned);
  if (!extracted) {
    throw new LLMParseError(
      `LLM response was not valid JSON: ${cleaned.slice(0, 200)}`
    );
  }

  try {
    return JSON.parse(extracted) as T;
  } catch (err) {
    throw new LLMParseError(
      `Failed to parse extracted JSON: ${(err as Error).message}. Snippet: ${extracted.slice(0, 200)}`
    );
  }
}

function stripCodeFences(s: string): string {
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/;
  const m = s.match(fence);
  return m ? m[1].trim() : s;
}

function extractBalancedJson(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// --- Errors ---

export class LLMConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigError";
  }
}

export class LLMAPIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "LLMAPIError";
    this.status = status;
  }
}

export class LLMParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMParseError";
  }
}

// --- Internals ---

interface AnthropicMessagesResponse {
  id?: string;
  model?: string;
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string;
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<unreadable body>";
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof LLMAPIError) return err.status >= 500 || err.status === 429;
  // Network / abort errors are retryable.
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TypeError")) {
    return true;
  }
  return false;
}

function backoffMs(attempt: number): number {
  return 500 * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
