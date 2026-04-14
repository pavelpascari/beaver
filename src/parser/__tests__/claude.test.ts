import { describe, it, expect } from "vitest";
import { parseClaudeSession } from "../claude.js";

describe("parseClaudeSession", () => {
  describe("simple JSON array format", () => {
    it("parses a basic JSON array session", () => {
      const raw = JSON.stringify([
        { role: "user", content: "Fix the bug", timestamp: "2025-01-01T00:00:00Z" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll fix that." },
            { type: "tool_use", name: "Read", input: { file_path: "src/main.ts" } },
          ],
          timestamp: "2025-01-01T00:00:05Z",
        },
      ]);

      const session = parseClaudeSession(raw);

      expect(session.provider).toBe("claude");
      expect(session.messages.length).toBe(2);
      expect(session.messages[0].role).toBe("user");
      expect(session.messages[0].content).toBe("Fix the bug");
      expect(session.messages[1].role).toBe("assistant");
      expect(session.messages[1].content).toContain("I'll fix that.");
      expect(session.toolCalls.length).toBe(1);
      expect(session.toolCalls[0].name).toBe("Read");
      expect(session.toolCalls[0].input).toEqual({ file_path: "src/main.ts" });
    });

    it("extracts multiple tool calls from one message", () => {
      const raw = JSON.stringify([
        {
          role: "assistant",
          content: [
            { type: "tool_use", name: "Grep", input: { pattern: "foo" } },
            { type: "tool_use", name: "Glob", input: { pattern: "*.ts" } },
          ],
        },
      ]);

      const session = parseClaudeSession(raw);
      expect(session.toolCalls.length).toBe(2);
      expect(session.toolCalls[0].name).toBe("Grep");
      expect(session.toolCalls[1].name).toBe("Glob");
    });

    it("handles string content on messages", () => {
      const raw = JSON.stringify([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ]);

      const session = parseClaudeSession(raw);
      expect(session.messages[0].content).toBe("Hello");
      expect(session.messages[1].content).toBe("Hi there");
    });

    it("computes duration from timestamps", () => {
      const raw = JSON.stringify([
        { role: "user", content: "Start", timestamp: "2025-01-01T10:00:00Z" },
        { role: "assistant", content: "Done", timestamp: "2025-01-01T10:05:30Z" },
      ]);

      const session = parseClaudeSession(raw);
      expect(session.metadata.durationMs).toBe(5 * 60 * 1000 + 30 * 1000);
      expect(session.startTime).toBe("2025-01-01T10:00:00Z");
      expect(session.endTime).toBe("2025-01-01T10:05:30Z");
    });
  });

  describe("Claude Code NDJSON format", () => {
    function ndjson(...entries: object[]): string {
      return entries.map((e) => JSON.stringify(e)).join("\n");
    }

    it("parses real Claude Code NDJSON entries", () => {
      const raw = ndjson(
        {
          type: "user",
          message: { role: "user", content: "Fix the login bug" },
          timestamp: "2025-03-15T10:00:00Z",
          cwd: "/home/user/project",
          sessionId: "abc-123",
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            model: "claude-opus-4-6",
            content: [
              { type: "text", text: "Let me look at the code." },
              { type: "tool_use", name: "Read", input: { file_path: "src/login.ts" } },
            ],
          },
          timestamp: "2025-03-15T10:00:05Z",
          sessionId: "abc-123",
        }
      );

      const session = parseClaudeSession(raw);

      expect(session.id).toBe("abc-123");
      expect(session.messages.length).toBe(2);
      expect(session.messages[0].role).toBe("user");
      expect(session.messages[0].content).toBe("Fix the login bug");
      expect(session.messages[1].role).toBe("assistant");
      expect(session.messages[1].content).toContain("Let me look at the code.");
      expect(session.metadata.model).toBe("claude-opus-4-6");
      expect(session.metadata.workingDirectory).toBe("/home/user/project");
      expect(session.toolCalls.length).toBe(1);
      expect(session.toolCalls[0].name).toBe("Read");
    });

    it("skips queue-operation entries", () => {
      const raw = ndjson(
        {
          type: "queue-operation",
          operation: "enqueue",
          timestamp: "2025-03-15T10:00:00Z",
          sessionId: "abc-123",
          content: "some prompt text",
        },
        {
          type: "queue-operation",
          operation: "dequeue",
          timestamp: "2025-03-15T10:00:01Z",
          sessionId: "abc-123",
        },
        {
          type: "user",
          message: { role: "user", content: "Fix the bug" },
          timestamp: "2025-03-15T10:00:02Z",
          sessionId: "abc-123",
        }
      );

      const session = parseClaudeSession(raw);
      expect(session.messages.length).toBe(1);
      expect(session.messages[0].role).toBe("user");
      expect(session.messages[0].content).toBe("Fix the bug");
    });

    it("skips attachment entries", () => {
      const raw = ndjson(
        {
          type: "user",
          message: { role: "user", content: "Analyze this" },
          timestamp: "2025-03-15T10:00:00Z",
        },
        {
          type: "attachment",
          attachment: { type: "file", path: "/some/file.txt" },
          timestamp: "2025-03-15T10:00:01Z",
        },
        {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "Sure." }] },
          timestamp: "2025-03-15T10:00:02Z",
        }
      );

      const session = parseClaudeSession(raw);
      expect(session.messages.length).toBe(2);
      expect(session.messages[0].role).toBe("user");
      expect(session.messages[1].role).toBe("assistant");
    });

    it("skips ai-title entries", () => {
      const raw = ndjson(
        {
          type: "ai-title",
          title: "Fix login bug",
          timestamp: "2025-03-15T10:00:00Z",
        },
        {
          type: "user",
          message: { role: "user", content: "Fix the bug" },
          timestamp: "2025-03-15T10:00:01Z",
        }
      );

      const session = parseClaudeSession(raw);
      expect(session.messages.length).toBe(1);
    });

    it("classifies user entries with tool_result as tool role", () => {
      const raw = ndjson(
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", name: "Bash", input: { command: "ls" } },
            ],
          },
          timestamp: "2025-03-15T10:00:00Z",
        },
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                tool_use_id: "toolu_123",
                type: "tool_result",
                content: "file1.ts\nfile2.ts",
                is_error: false,
              },
            ],
          },
          toolUseResult: {
            stdout: "file1.ts\nfile2.ts",
            stderr: "",
            interrupted: false,
          },
          timestamp: "2025-03-15T10:00:05Z",
        }
      );

      const session = parseClaudeSession(raw);
      expect(session.messages.length).toBe(2);
      expect(session.messages[0].role).toBe("assistant");
      expect(session.messages[1].role).toBe("tool");
      expect(session.messages[1].content).toContain("file1.ts");
    });

    it("extracts tool calls from nested message.content", () => {
      const raw = ndjson({
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-opus-4-6",
          content: [
            { type: "thinking", thinking: "Let me think about this..." },
            { type: "text", text: "I'll search for the file." },
            { type: "tool_use", name: "Grep", input: { pattern: "login", path: "src/" } },
            { type: "tool_use", name: "Read", input: { file_path: "src/auth.ts" } },
          ],
        },
        timestamp: "2025-03-15T10:00:00Z",
      });

      const session = parseClaudeSession(raw);
      expect(session.toolCalls.length).toBe(2);
      expect(session.toolCalls[0].name).toBe("Grep");
      expect(session.toolCalls[0].input).toEqual({ pattern: "login", path: "src/" });
      expect(session.toolCalls[1].name).toBe("Read");
      expect(session.toolCalls[1].input).toEqual({ file_path: "src/auth.ts" });
    });

    it("includes thinking blocks in content", () => {
      const raw = ndjson({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "I need to consider the edge cases here." },
            { type: "text", text: "Here's my analysis." },
          ],
        },
        timestamp: "2025-03-15T10:00:00Z",
      });

      const session = parseClaudeSession(raw);
      expect(session.messages[0].content).toContain("[Thinking]");
      expect(session.messages[0].content).toContain("edge cases");
      expect(session.messages[0].content).toContain("Here's my analysis.");
    });

    it("handles Write and Edit tool calls", () => {
      const raw = ndjson(
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                name: "Write",
                input: { file_path: "src/new.ts", content: "console.log('hello');" },
              },
            ],
          },
          timestamp: "2025-03-15T10:00:00Z",
        },
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                name: "Edit",
                input: { file_path: "src/old.ts", old_string: "foo", new_string: "bar" },
              },
            ],
          },
          timestamp: "2025-03-15T10:00:05Z",
        }
      );

      const session = parseClaudeSession(raw);
      expect(session.toolCalls.length).toBe(2);
      expect(session.toolCalls[0].name).toBe("Write");
      expect(session.toolCalls[0].input.file_path).toBe("src/new.ts");
      expect(session.toolCalls[1].name).toBe("Edit");
      expect(session.toolCalls[1].input.file_path).toBe("src/old.ts");
    });

    it("handles a full realistic NDJSON session", () => {
      const raw = ndjson(
        // Queue operations (should be skipped)
        {
          type: "queue-operation",
          operation: "enqueue",
          timestamp: "2025-03-15T10:00:00Z",
          sessionId: "sess-full",
          content: "Fix the validation bug",
        },
        {
          type: "queue-operation",
          operation: "dequeue",
          timestamp: "2025-03-15T10:00:01Z",
          sessionId: "sess-full",
        },
        // User message
        {
          type: "user",
          message: { role: "user", content: "Fix the validation bug" },
          timestamp: "2025-03-15T10:00:02Z",
          cwd: "/home/user/app",
          sessionId: "sess-full",
        },
        // Attachment (should be skipped)
        {
          type: "attachment",
          attachment: { type: "context", content: "system prompt" },
          timestamp: "2025-03-15T10:00:02Z",
          sessionId: "sess-full",
        },
        // Assistant thinking + search
        {
          type: "assistant",
          message: {
            role: "assistant",
            model: "claude-opus-4-6",
            content: [
              { type: "thinking", thinking: "I need to find the validation code." },
              { type: "text", text: "Let me search for validation logic." },
              { type: "tool_use", name: "Grep", input: { pattern: "validate" } },
            ],
          },
          timestamp: "2025-03-15T10:00:05Z",
          sessionId: "sess-full",
        },
        // Tool result
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                tool_use_id: "toolu_001",
                type: "tool_result",
                content: "src/validate.ts:5: function validate(email)",
                is_error: false,
              },
            ],
          },
          toolUseResult: {
            stdout: "src/validate.ts:5: function validate(email)",
            stderr: "",
          },
          timestamp: "2025-03-15T10:00:08Z",
          sessionId: "sess-full",
        },
        // Assistant reads file
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "tool_use", name: "Read", input: { file_path: "src/validate.ts" } },
            ],
          },
          timestamp: "2025-03-15T10:00:10Z",
          sessionId: "sess-full",
        },
        // Tool result
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                tool_use_id: "toolu_002",
                type: "tool_result",
                content: "function validate(email) { return email.includes('@'); }",
                is_error: false,
              },
            ],
          },
          timestamp: "2025-03-15T10:00:12Z",
          sessionId: "sess-full",
        },
        // Assistant fixes code
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Found the bug. The regex is too permissive." },
              {
                type: "tool_use",
                name: "Edit",
                input: {
                  file_path: "src/validate.ts",
                  old_string: "email.includes('@')",
                  new_string: "/^[^@]+@[^@]+\\.[^@]+$/.test(email)",
                },
              },
            ],
          },
          timestamp: "2025-03-15T10:00:15Z",
          sessionId: "sess-full",
        },
        // Tool result
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                tool_use_id: "toolu_003",
                type: "tool_result",
                content: "File edited successfully",
                is_error: false,
              },
            ],
          },
          timestamp: "2025-03-15T10:00:16Z",
          sessionId: "sess-full",
        },
        // Assistant runs tests
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Let me verify with tests." },
              { type: "tool_use", name: "Bash", input: { command: "npm test" } },
            ],
          },
          timestamp: "2025-03-15T10:00:20Z",
          sessionId: "sess-full",
        },
        // Test result
        {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                tool_use_id: "toolu_004",
                type: "tool_result",
                content: "Tests: 5 passed, 0 failed",
                is_error: false,
              },
            ],
          },
          toolUseResult: {
            stdout: "Tests: 5 passed, 0 failed",
            stderr: "",
          },
          timestamp: "2025-03-15T10:00:25Z",
          sessionId: "sess-full",
        },
        // Assistant done
        {
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "All tests pass. The validation bug is fixed." },
            ],
          },
          timestamp: "2025-03-15T10:00:30Z",
          sessionId: "sess-full",
        }
      );

      const session = parseClaudeSession(raw);

      // Session metadata
      expect(session.id).toBe("sess-full");
      expect(session.provider).toBe("claude");
      expect(session.metadata.model).toBe("claude-opus-4-6");
      expect(session.metadata.workingDirectory).toBe("/home/user/app");

      // Messages: user, assistant(search), tool, assistant(read), tool,
      // assistant(edit), tool, assistant(test), tool, assistant(done)
      // queue-operation and attachment should be skipped
      const roles = session.messages.map((m) => m.role);
      expect(roles).not.toContain(undefined);
      expect(roles.filter((r) => r === "user")).toHaveLength(1); // Only the actual user message
      expect(roles.filter((r) => r === "tool")).toHaveLength(4); // 4 tool results (Grep, Read, Edit, Bash)
      expect(roles.filter((r) => r === "assistant")).toHaveLength(5); // 5 assistant messages

      // Tool calls: Grep, Read, Edit, Bash
      expect(session.toolCalls.length).toBe(4);
      expect(session.toolCalls.map((tc) => tc.name)).toEqual([
        "Grep",
        "Read",
        "Edit",
        "Bash",
      ]);

      // Duration
      expect(session.metadata.durationMs).toBe(30 * 1000);

      // Timestamps
      expect(session.startTime).toBe("2025-03-15T10:00:00Z");
      expect(session.endTime).toBe("2025-03-15T10:00:30Z");
    });
  });

  describe("edge cases", () => {
    it("throws on empty input", () => {
      expect(() => parseClaudeSession("")).toThrow();
    });

    it("throws on invalid JSON", () => {
      expect(() => parseClaudeSession("not json at all")).toThrow();
    });

    it("handles entries with no content gracefully", () => {
      const raw = JSON.stringify([
        { role: "user", content: "" },
        { role: "assistant" },
      ]);

      const session = parseClaudeSession(raw);
      expect(session.messages.length).toBe(2);
      expect(session.messages[0].content).toBe("");
      expect(session.messages[1].content).toBe("");
    });

    it("handles mixed NDJSON with malformed lines", () => {
      const raw = [
        JSON.stringify({ type: "user", message: { role: "user", content: "Hello" }, timestamp: "2025-01-01T00:00:00Z" }),
        "this is not json",
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Hi" }] }, timestamp: "2025-01-01T00:00:01Z" }),
      ].join("\n");

      const session = parseClaudeSession(raw);
      expect(session.messages.length).toBe(2);
    });

    it("generates a session ID when none is present", () => {
      const raw = JSON.stringify([
        { role: "user", content: "Hello" },
      ]);

      const session = parseClaudeSession(raw);
      expect(session.id).toMatch(/^session-\d+$/);
    });

    it("handles no timestamps gracefully", () => {
      const raw = JSON.stringify([
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ]);

      const session = parseClaudeSession(raw);
      expect(session.startTime).toBeUndefined();
      expect(session.endTime).toBeUndefined();
      expect(session.metadata.durationMs).toBeUndefined();
    });
  });

  describe("real session file", () => {
    it("parses the example session file", async () => {
      const { readFile } = await import("fs/promises");
      const { resolve } = await import("path");
      const raw = await readFile(
        resolve(process.cwd(), "example-session.json"),
        "utf-8"
      );

      const session = parseClaudeSession(raw);

      expect(session.provider).toBe("claude");
      expect(session.messages.length).toBeGreaterThan(0);
      expect(session.toolCalls.length).toBeGreaterThan(0);

      // Should find Read, Edit, Grep, Glob, Bash tools
      const toolNames = new Set(session.toolCalls.map((tc) => tc.name));
      expect(toolNames.has("Read")).toBe(true);
      expect(toolNames.has("Edit")).toBe(true);
      expect(toolNames.has("Bash")).toBe(true);
    });
  });
});
