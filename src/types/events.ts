/**
 * Structured events extracted from sessions.
 */

export type EventType =
  | "file_read"
  | "file_write"
  | "search"
  | "tool_call"
  | "test_run"
  | "command_run"
  | "retry"
  | "plan_revision";

export interface SessionEvent {
  type: EventType;
  index: number;
  messageIndex: number;
  timestamp?: string;
  data: EventData;
}

export interface FileReadEvent {
  [key: string]: unknown;
  path: string;
  linesRead?: number;
}

export interface FileWriteEvent {
  [key: string]: unknown;
  path: string;
  linesChanged?: number;
  isCreation: boolean;
}

export interface SearchEvent {
  [key: string]: unknown;
  query: string;
  tool: string;
  resultsCount?: number;
}

export interface TestRunEvent {
  [key: string]: unknown;
  command: string;
  passed: boolean;
  output?: string;
}

export interface CommandRunEvent {
  [key: string]: unknown;
  command: string;
  exitCode?: number;
  output?: string;
}

export interface RetryEvent {
  [key: string]: unknown;
  originalIndex: number;
  reason: string;
  tool: string;
}

export interface PlanRevisionEvent {
  [key: string]: unknown;
  summary: string;
}

export type EventData =
  | FileReadEvent
  | FileWriteEvent
  | SearchEvent
  | TestRunEvent
  | CommandRunEvent
  | RetryEvent
  | PlanRevisionEvent;
