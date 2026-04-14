/**
 * Canonical internal session representation.
 * All parsers normalize into this format.
 */

export interface Session {
  id: string;
  provider: string;
  startTime?: string;
  endTime?: string;
  messages: Message[];
  toolCalls: ToolCall[];
  metadata: SessionMetadata;
}

export interface SessionMetadata {
  model?: string;
  totalMessages: number;
  totalToolCalls: number;
  durationMs?: number;
  workingDirectory?: string;
}

export interface Message {
  index: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  index: number;
  messageIndex: number;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  timestamp?: string;
  durationMs?: number;
}
