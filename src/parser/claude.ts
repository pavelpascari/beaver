/**
 * Parser for Claude Code session files.
 *
 * Supports two formats:
 * 1. JSON array of messages (single JSON blob)
 * 2. NDJSON (one JSON object per line, as Claude Code exports)
 *
 * Normalizes into our canonical Session format.
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
  type?: string;
  role?: string;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
  };
  content?: unknown;
  content_block?: {
    type?: string;
    name?: string;
    input?: unknown;
    text?: string;
  };
  model?: string;
  timestamp?: string;
  // Claude Code NDJSON fields
  parentMessageId?: string;
  sessionId?: string;
  uuid?: string;
  cwd?: string;
  toolUseResult?: unknown;
  isSidechain?: boolean;
}

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

  // Try NDJSON
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
  // Direct role field
  if (entry.role === "user" || entry.role === "assistant" || entry.role === "system") {
    return entry.role;
  }

  // Nested message.role
  if (entry.message?.role) {
    const r = entry.message.role;
    if (r === "user" || r === "assistant" || r === "system") return r;
  }

  // Tool results
  if (entry.type === "tool_result" || entry.toolUseResult !== undefined) {
    return "tool";
  }

  // Content blocks from assistant
  if (entry.type === "content_block_delta" || entry.type === "content_block_start") {
    return "assistant";
  }

  return null;
}

function resolveContent(entry: RawEntry): string {
  // Direct string content
  if (typeof entry.content === "string") return entry.content;

  // Array of content blocks (Claude API format)
  if (Array.isArray(entry.content)) {
    return entry.content
      .map((block: { type?: string; text?: string }) => {
        if (typeof block === "string") return block;
        if (block.type === "text" && block.text) return block.text;
        if (block.type === "tool_use") return `[Tool: ${(block as Record<string, unknown>).name}]`;
        if (block.type === "tool_result") {
          const result = block as Record<string, unknown>;
          if (typeof result.content === "string") return result.content;
          return "[Tool Result]";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  // Nested message.content
  if (entry.message?.content) {
    if (typeof entry.message.content === "string") return entry.message.content;
    if (Array.isArray(entry.message.content)) {
      return (entry.message.content as Array<{ type?: string; text?: string }>)
        .map((block) => {
          if (typeof block === "string") return block;
          if (block.text) return block.text;
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
  }

  // Content block
  if (entry.content_block?.text) return entry.content_block.text;

  // Tool use result
  if (entry.toolUseResult !== undefined) {
    if (typeof entry.toolUseResult === "string") return entry.toolUseResult;
    return JSON.stringify(entry.toolUseResult);
  }

  return "";
}

// --- Tool call extraction ---

function resolveToolCallsFromEntry(
  entry: RawEntry,
  messageIndex: number
): ToolCall[] {
  const calls: ToolCall[] = [];

  // Content array with tool_use blocks
  if (Array.isArray(entry.content)) {
    let toolIndex = 0;
    for (const block of entry.content) {
      const b = block as Record<string, unknown>;
      if (b.type === "tool_use") {
        calls.push({
          index: toolIndex++,
          messageIndex,
          name: String(b.name || "unknown"),
          input: (b.input as Record<string, unknown>) || {},
        });
      }
    }
  }

  // Nested message.content with tool_use
  if (Array.isArray(entry.message?.content)) {
    let toolIndex = 0;
    for (const block of entry.message!.content as Array<Record<string, unknown>>) {
      if (block.type === "tool_use") {
        calls.push({
          index: toolIndex++,
          messageIndex,
          name: String(block.name || "unknown"),
          input: (block.input as Record<string, unknown>) || {},
        });
      }
    }
  }

  // Content block type tool_use
  if (entry.content_block?.type === "tool_use" && entry.content_block.name) {
    calls.push({
      index: 0,
      messageIndex,
      name: entry.content_block.name,
      input: (entry.content_block.input as Record<string, unknown>) || {},
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
  const model = entries.find((e) => e.message?.model)?.message?.model
    || entries.find((e) => e.model)?.model;

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
