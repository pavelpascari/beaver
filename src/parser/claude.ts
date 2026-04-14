/**
 * Parser for Claude Code session files.
 *
 * Supports two formats:
 * 1. JSON array of messages (simple [{role, content}, ...])
 * 2. NDJSON (one JSON object per line — real Claude Code session format)
 *
 * Real Claude Code NDJSON entries have:
 * - Top-level `type`: "user" | "assistant" | "system" | "queue-operation" | "attachment" | "ai-title"
 * - `message.role` + `message.content` for user/assistant entries
 * - `message.content` is an array of blocks: {type: "text"|"tool_use"|"tool_result"|"thinking", ...}
 * - `toolUseResult` on user entries that carry tool output
 * - `cwd`, `sessionId`, `timestamp`, `uuid` at top level
 */

import type { Session, Message, ToolCall, SessionMetadata } from "../types/index.js";

export function parseClaudeSession(raw: string): Session {
  const entries = parseRawEntries(raw);
  const messages = extractMessages(entries);
  const toolCalls = extractToolCalls(messages);
  const metadata = buildMetadata(messages, toolCalls, entries);

  return {
    id: extractSessionId(entries) || `session-${Date.now()}`,
    provider: "claude",
    startTime: findTimestamp(entries, "first"),
    endTime: findTimestamp(entries, "last"),
    messages,
    toolCalls,
    metadata,
  };
}

// --- Raw entry parsing ---

interface RawEntry {
  // Claude Code NDJSON top-level fields
  type?: string;
  timestamp?: string;
  sessionId?: string;
  uuid?: string;
  cwd?: string;
  isSidechain?: boolean;
  toolUseResult?: Record<string, unknown>;
  sourceToolAssistantUUID?: string;

  // Simple format fields
  role?: string;
  content?: unknown;

  // Nested message (Claude Code NDJSON format)
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
    id?: string;
    usage?: Record<string, unknown>;
  };

  // Streaming format
  content_block?: {
    type?: string;
    name?: string;
    input?: unknown;
    text?: string;
  };
  model?: string;
}

const MESSAGE_TYPES = new Set(["user", "assistant", "system"]);
const SKIP_TYPES = new Set(["queue-operation", "attachment", "ai-title"]);

function parseRawEntries(raw: string): RawEntry[] {
  const trimmed = raw.trim();

  // Try JSON array first
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fall through to NDJSON
    }
  }

  // NDJSON
  const lines = trimmed.split("\n").filter((l) => l.trim());
  const entries: RawEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  if (entries.length === 0) {
    throw new Error(
      "Could not parse session file. Expected JSON array or NDJSON format."
    );
  }

  return entries;
}

// --- Message extraction ---

function extractMessages(entries: RawEntry[]): Message[] {
  const messages: Message[] = [];
  let index = 0;

  for (const entry of entries) {
    // Skip non-message entries
    if (entry.type && SKIP_TYPES.has(entry.type)) continue;

    const role = resolveRole(entry);
    if (!role) continue;

    const content = resolveContent(entry);
    const toolCalls = resolveToolCallsFromEntry(entry, index);

    messages.push({
      index,
      role,
      content,
      timestamp: entry.timestamp,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });
    index++;
  }

  return messages;
}

function resolveRole(
  entry: RawEntry
): "user" | "assistant" | "system" | "tool" | null {
  // Claude Code NDJSON: top-level `type` field is the entry type
  if (entry.type && MESSAGE_TYPES.has(entry.type)) {
    // But user entries carrying tool results are "tool" role messages
    if (entry.type === "user" && hasToolResults(entry)) {
      return "tool";
    }
    return entry.type as "user" | "assistant" | "system";
  }

  // Simple format: direct `role` field
  if (entry.role && MESSAGE_TYPES.has(entry.role)) {
    return entry.role as "user" | "assistant" | "system";
  }

  // Nested message.role (fallback)
  if (entry.message?.role && MESSAGE_TYPES.has(entry.message.role)) {
    if (entry.message.role === "user" && hasToolResults(entry)) {
      return "tool";
    }
    return entry.message.role as "user" | "assistant" | "system";
  }

  // Legacy tool result entries
  if (entry.type === "tool_result" || entry.toolUseResult !== undefined) {
    return "tool";
  }

  return null;
}

function hasToolResults(entry: RawEntry): boolean {
  // Check if this user entry is actually carrying tool_result content blocks
  const content = entry.message?.content ?? entry.content;
  if (Array.isArray(content)) {
    return content.some(
      (block: Record<string, unknown>) =>
        typeof block === "object" && block !== null && block.type === "tool_result"
    );
  }
  return entry.toolUseResult !== undefined;
}

// --- Content extraction ---

function resolveContent(entry: RawEntry): string {
  // Prefer message.content (Claude Code NDJSON format)
  const messageContent = entry.message?.content;
  if (messageContent !== undefined) {
    return contentToString(messageContent);
  }

  // Direct content field (simple format)
  if (entry.content !== undefined) {
    return contentToString(entry.content);
  }

  // toolUseResult on tool response entries
  if (entry.toolUseResult !== undefined) {
    const result = entry.toolUseResult;
    if (typeof result === "string") return result;
    if (typeof result.stdout === "string") return result.stdout as string;
    return JSON.stringify(result);
  }

  // Content block (streaming format)
  if (entry.content_block?.text) return entry.content_block.text;

  return "";
}

function contentToString(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((block: Record<string, unknown>) => {
        if (typeof block === "string") return block;
        if (!block || typeof block !== "object") return "";

        switch (block.type) {
          case "text":
            return typeof block.text === "string" ? block.text : "";
          case "thinking":
            // Include thinking as it shows reasoning
            return typeof block.thinking === "string"
              ? `[Thinking] ${(block.thinking as string).slice(0, 300)}`
              : "";
          case "tool_use":
            return `[Tool: ${block.name || "unknown"}]`;
          case "tool_result": {
            if (typeof block.content === "string") return block.content;
            if (block.is_error) return "[Tool Error]";
            return "[Tool Result]";
          }
          default:
            return "";
        }
      })
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

// --- Tool call extraction ---

function resolveToolCallsFromEntry(
  entry: RawEntry,
  messageIndex: number
): ToolCall[] {
  const calls: ToolCall[] = [];

  // Extract tool_use blocks from content arrays
  const sources: unknown[][] = [];

  if (Array.isArray(entry.message?.content)) {
    sources.push(entry.message!.content as unknown[]);
  }
  if (Array.isArray(entry.content)) {
    sources.push(entry.content as unknown[]);
  }

  let toolIndex = 0;
  for (const source of sources) {
    for (const block of source) {
      const b = block as Record<string, unknown>;
      if (b && typeof b === "object" && b.type === "tool_use") {
        calls.push({
          index: toolIndex++,
          messageIndex,
          name: String(b.name || "unknown"),
          input: (b.input as Record<string, unknown>) || {},
          timestamp: entry.timestamp,
        });
      }
    }
  }

  // Streaming content_block
  if (
    entry.content_block?.type === "tool_use" &&
    entry.content_block.name
  ) {
    calls.push({
      index: 0,
      messageIndex,
      name: entry.content_block.name,
      input: (entry.content_block.input as Record<string, unknown>) || {},
      timestamp: entry.timestamp,
    });
  }

  return calls;
}

function extractToolCalls(messages: Message[]): ToolCall[] {
  const calls: ToolCall[] = [];
  let globalIndex = 0;

  for (const msg of messages) {
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        calls.push({ ...tc, index: globalIndex++ });
      }
    }
  }

  return calls;
}

// --- Metadata ---

function buildMetadata(
  messages: Message[],
  toolCalls: ToolCall[],
  entries: RawEntry[]
): SessionMetadata {
  const model =
    entries.find((e) => e.message?.model)?.message?.model ||
    entries.find((e) => e.model)?.model;

  const cwd = entries.find((e) => e.cwd)?.cwd;

  const firstTs = findTimestamp(entries, "first");
  const lastTs = findTimestamp(entries, "last");
  let durationMs: number | undefined;
  if (firstTs && lastTs) {
    durationMs = new Date(lastTs).getTime() - new Date(firstTs).getTime();
  }

  return {
    model,
    totalMessages: messages.length,
    totalToolCalls: toolCalls.length,
    durationMs,
    workingDirectory: cwd,
  };
}

function extractSessionId(entries: RawEntry[]): string | undefined {
  return entries.find((e) => e.sessionId)?.sessionId;
}

function findTimestamp(
  entries: RawEntry[],
  which: "first" | "last"
): string | undefined {
  const withTimestamp = entries.filter((e) => e.timestamp);
  if (withTimestamp.length === 0) return undefined;
  return which === "first"
    ? withTimestamp[0].timestamp
    : withTimestamp[withTimestamp.length - 1].timestamp;
}
