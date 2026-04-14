/**
 * Event extraction layer.
 *
 * Converts a parsed Session into a flat list of structured SessionEvents.
 * This is the bridge between raw session data and the analysis pipeline.
 */

import type { Session, ToolCall, Message } from "../types/session.js";
import type {
  SessionEvent,
  EventType,
  FileReadEvent,
  FileWriteEvent,
  SearchEvent,
  TestRunEvent,
  CommandRunEvent,
  RetryEvent,
  PlanRevisionEvent,
} from "../types/events.js";

export function extractEvents(session: Session): SessionEvent[] {
  const events: SessionEvent[] = [];
  let index = 0;

  // Extract events from tool calls
  for (const tc of session.toolCalls) {
    const extracted = toolCallToEvent(tc);
    if (extracted) {
      events.push({ ...extracted, index: index++ });
    }
  }

  // Detect retries (same tool on same file within close proximity)
  const retries = detectRetries(events);
  for (const retry of retries) {
    events.push({ ...retry, index: index++ });
  }

  // Detect plan revisions from assistant messages
  for (const msg of session.messages) {
    if (msg.role === "assistant") {
      const revision = detectPlanRevision(msg);
      if (revision) {
        events.push({ ...revision, index: index++ });
      }
    }
  }

  // Sort by messageIndex to maintain chronological order
  events.sort((a, b) => a.messageIndex - b.messageIndex);

  // Re-index
  events.forEach((e, i) => (e.index = i));

  return events;
}

// --- Tool call mapping ---

const FILE_READ_TOOLS = ["Read", "read", "cat", "head", "tail", "View"];
const FILE_WRITE_TOOLS = ["Write", "Edit", "write", "edit", "NotebookEdit"];
const SEARCH_TOOLS = ["Grep", "Glob", "grep", "rg", "find", "Search", "search_code"];
const COMMAND_TOOLS = ["Bash", "bash", "execute", "terminal", "shell"];

function toolCallToEvent(tc: ToolCall): Omit<SessionEvent, "index"> | null {
  const name = tc.name;

  // File reads
  if (FILE_READ_TOOLS.includes(name)) {
    return {
      type: "file_read",
      messageIndex: tc.messageIndex,
      timestamp: tc.timestamp,
      data: {
        path: extractPath(tc.input),
        linesRead: extractNumber(tc.input, "limit"),
      } as FileReadEvent,
    };
  }

  // File writes
  if (FILE_WRITE_TOOLS.includes(name)) {
    return {
      type: "file_write",
      messageIndex: tc.messageIndex,
      timestamp: tc.timestamp,
      data: {
        path: extractPath(tc.input),
        isCreation: name === "Write" || name === "write",
      } as FileWriteEvent,
    };
  }

  // Searches
  if (SEARCH_TOOLS.includes(name)) {
    return {
      type: "search",
      messageIndex: tc.messageIndex,
      timestamp: tc.timestamp,
      data: {
        query:
          extractString(tc.input, "pattern") ||
          extractString(tc.input, "query") ||
          extractString(tc.input, "command") ||
          "",
        tool: name,
        resultsCount: undefined,
      } as SearchEvent,
    };
  }

  // Commands (Bash)
  if (COMMAND_TOOLS.includes(name)) {
    const command = extractString(tc.input, "command") || "";

    // Check if it's a test run
    if (isTestCommand(command)) {
      return {
        type: "test_run",
        messageIndex: tc.messageIndex,
        timestamp: tc.timestamp,
        data: {
          command,
          passed: true, // Will be refined if we can parse output
          output: tc.output,
        } as TestRunEvent,
      };
    }

    return {
      type: "command_run",
      messageIndex: tc.messageIndex,
      timestamp: tc.timestamp,
      data: {
        command,
        output: tc.output,
      } as CommandRunEvent,
    };
  }

  // Generic tool call
  return {
    type: "tool_call",
    messageIndex: tc.messageIndex,
    timestamp: tc.timestamp,
    data: {
      path: "",
      linesRead: 0,
    } as FileReadEvent, // generic placeholder
  };
}

// --- Retry detection ---

function detectRetries(events: SessionEvent[]): Omit<SessionEvent, "index">[] {
  const retries: Omit<SessionEvent, "index">[] = [];

  for (let i = 1; i < events.length; i++) {
    const curr = events[i];
    const prev = events[i - 1];

    // Same type on same file within a short window = potential retry
    if (
      curr.type === prev.type &&
      curr.type === "file_write" &&
      getEventPath(curr) === getEventPath(prev) &&
      getEventPath(curr) !== ""
    ) {
      retries.push({
        type: "retry",
        messageIndex: curr.messageIndex,
        timestamp: curr.timestamp,
        data: {
          originalIndex: prev.index,
          reason: `Repeated ${curr.type} on ${getEventPath(curr)}`,
          tool: curr.type,
        } as RetryEvent,
      });
    }

    // Back-to-back search for similar queries
    if (
      curr.type === "search" &&
      prev.type === "search" &&
      areSimilarSearches(
        (curr.data as SearchEvent).query,
        (prev.data as SearchEvent).query
      )
    ) {
      retries.push({
        type: "retry",
        messageIndex: curr.messageIndex,
        timestamp: curr.timestamp,
        data: {
          originalIndex: prev.index,
          reason: `Repeated search: "${(curr.data as SearchEvent).query}"`,
          tool: "search",
        } as RetryEvent,
      });
    }
  }

  return retries;
}

// --- Plan revision detection ---

const PLAN_KEYWORDS = [
  "let me try a different approach",
  "instead, I'll",
  "actually, let me",
  "let me reconsider",
  "that didn't work",
  "different strategy",
  "new approach",
  "on second thought",
  "I need to rethink",
];

function detectPlanRevision(
  msg: Message
): Omit<SessionEvent, "index"> | null {
  const lower = msg.content.toLowerCase();
  const matched = PLAN_KEYWORDS.find((kw) => lower.includes(kw));

  if (matched) {
    return {
      type: "plan_revision",
      messageIndex: msg.index,
      timestamp: msg.timestamp,
      data: {
        summary: `Plan revision detected: "${matched}"`,
      } as PlanRevisionEvent,
    };
  }

  return null;
}

// --- Helpers ---

function extractPath(input: Record<string, unknown>): string {
  return (
    extractString(input, "file_path") ||
    extractString(input, "path") ||
    extractString(input, "file") ||
    ""
  );
}

function extractString(
  input: Record<string, unknown>,
  key: string
): string | undefined {
  const val = input[key];
  return typeof val === "string" ? val : undefined;
}

function extractNumber(
  input: Record<string, unknown>,
  key: string
): number | undefined {
  const val = input[key];
  return typeof val === "number" ? val : undefined;
}

function getEventPath(event: SessionEvent): string {
  const data = event.data as Record<string, unknown>;
  return typeof data.path === "string" ? data.path : "";
}

function isTestCommand(cmd: string): boolean {
  const lower = cmd.toLowerCase();
  return (
    lower.includes("npm test") ||
    lower.includes("npm run test") ||
    lower.includes("jest") ||
    lower.includes("pytest") ||
    lower.includes("cargo test") ||
    lower.includes("go test") ||
    lower.includes("vitest") ||
    lower.includes("mocha") ||
    lower.includes("make test")
  );
}

function areSimilarSearches(a: string, b: string): boolean {
  if (a === b) return true;
  // Check if one contains the other
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  return la.includes(lb) || lb.includes(la);
}
