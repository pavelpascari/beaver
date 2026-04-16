/**
 * Minimal Anthropic Messages client.
 *
 * Uses native fetch — no SDK dependency. Designed to be tiny and replaceable.
 * Exposes a single `callLLM` function that takes a prompt and returns the
 * text response plus token usage metadata.
 */

export interface LLMClientOptions {
  /** Anthropic API key. Defaults to env ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Model id. Defaults to claude-sonnet-4-6. */
  model?: string;
  /** Max tokens for the response. */
  maxTokens?: number;
  /** Override base URL (useful for proxies). */
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
}

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 2;

export function createLLMClient(options: LLMClientOptions = {}): LLMClient {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new LLMConfigError(
      "Missing ANTHROPIC_API_KEY. Set the env var or pass --api-key."
    );
  }
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = options.baseUrl ?? "https://api.anthropic.com";
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  return {
    model,
    async call(prompt, callOpts) {
      const maxTokens =
        callOpts?.maxTokens ?? options.maxTokens ?? DEFAULT_MAX_TOKENS;

      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await performCall(
            baseUrl,
            apiKey,
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
  apiKey: string,
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
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
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
