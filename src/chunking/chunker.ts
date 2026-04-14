/**
 * Session chunking.
 *
 * Splits a session into phases using simple heuristics:
 * - reads/search -> exploration
 * - writes -> implementation
 * - repeated edits/tests after failures -> debugging
 * - tests only -> verification
 */

import type { Session, Message } from "../types/session.js";
import type { SessionEvent } from "../types/events.js";
import type { Chunk, PhaseType } from "../types/chunks.js";

export function chunkSession(
  session: Session,
  events: SessionEvent[]
): Chunk[] {
  if (events.length === 0) {
    return [
      {
        phase: "exploration",
        startIndex: 0,
        endIndex: session.messages.length - 1,
        events: [],
        messages: session.messages,
      },
    ];
  }

  // Classify each event into a phase
  const classified = events.map((event) => ({
    event,
    phase: classifyEvent(event),
  }));

  // Group consecutive events of the same phase
  const chunks: Chunk[] = [];
  let currentPhase = classified[0].phase;
  let chunkEvents: SessionEvent[] = [classified[0].event];
  let startIndex = classified[0].event.messageIndex;

  for (let i = 1; i < classified.length; i++) {
    const { event, phase } = classified[i];

    if (phase !== currentPhase) {
      // Flush current chunk
      const endIndex = classified[i - 1].event.messageIndex;
      chunks.push({
        phase: currentPhase,
        startIndex,
        endIndex,
        events: chunkEvents,
        messages: getMessagesInRange(session.messages, startIndex, endIndex),
      });

      // Start new chunk
      currentPhase = phase;
      chunkEvents = [event];
      startIndex = event.messageIndex;
    } else {
      chunkEvents.push(event);
    }
  }

  // Flush final chunk
  const lastEvent = classified[classified.length - 1].event;
  chunks.push({
    phase: currentPhase,
    startIndex,
    endIndex: lastEvent.messageIndex,
    events: chunkEvents,
    messages: getMessagesInRange(
      session.messages,
      startIndex,
      lastEvent.messageIndex
    ),
  });

  // Post-process: merge very small chunks into neighbors
  return mergeSmallChunks(chunks);
}

function classifyEvent(event: SessionEvent): PhaseType {
  switch (event.type) {
    case "file_read":
    case "search":
      return "exploration";

    case "file_write":
      return "implementation";

    case "retry":
    case "plan_revision":
      return "debugging";

    case "test_run":
      return "verification";

    case "command_run": {
      // Commands could be any phase - use heuristics on the command string
      const data = event.data as { command?: string };
      const cmd = (data.command || "").toLowerCase();

      if (
        cmd.includes("git log") ||
        cmd.includes("git show") ||
        cmd.includes("ls") ||
        cmd.includes("cat") ||
        cmd.includes("find")
      ) {
        return "exploration";
      }
      if (
        cmd.includes("git add") ||
        cmd.includes("git commit") ||
        cmd.includes("mkdir") ||
        cmd.includes("npm install")
      ) {
        return "implementation";
      }
      if (
        cmd.includes("test") ||
        cmd.includes("check") ||
        cmd.includes("lint")
      ) {
        return "verification";
      }
      return "implementation";
    }

    case "tool_call":
      return "exploration";

    default:
      return "exploration";
  }
}

function getMessagesInRange(
  messages: Message[],
  startIndex: number,
  endIndex: number
): Message[] {
  return messages.filter(
    (m) => m.index >= startIndex && m.index <= endIndex
  );
}

/**
 * Merge chunks that are too small (< 2 events) into their neighbors.
 * Prevents noisy fragmentation.
 */
function mergeSmallChunks(chunks: Chunk[]): Chunk[] {
  if (chunks.length <= 1) return chunks;

  const merged: Chunk[] = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const prev = merged[merged.length - 1];

    // Merge if tiny chunk
    if (chunk.events.length < 2) {
      prev.endIndex = chunk.endIndex;
      prev.events.push(...chunk.events);
      prev.messages = [
        ...prev.messages,
        ...chunk.messages.filter(
          (m) => !prev.messages.some((pm) => pm.index === m.index)
        ),
      ];
    } else {
      merged.push(chunk);
    }
  }

  return merged;
}
