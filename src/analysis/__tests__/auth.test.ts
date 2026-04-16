import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { openSync, closeSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveAuth,
  buildHeaders,
  LLMConfigError,
  type AuthResolution,
} from "../llm-client.js";

// Helper: build an env with only the keys we want set.
function env(obj: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const noClaudeCli = { hasClaudeCli: () => false };
const yesClaudeCli = { hasClaudeCli: () => true };

describe("resolveAuth", () => {
  it("uses explicit apiKey option first", () => {
    const r = resolveAuth({ apiKey: "explicit-key" }, env({}), yesClaudeCli);
    expect(r.mode).toBe("api_key");
    expect(r.credential).toBe("explicit-key");
    expect(r.source).toBe("--api-key");
  });

  it("explicit apiKey beats env + oauth", () => {
    const r = resolveAuth(
      { apiKey: "explicit" },
      env({ ANTHROPIC_API_KEY: "env-key" }),
      yesClaudeCli
    );
    expect(r.credential).toBe("explicit");
  });

  it("auto: prefers ANTHROPIC_API_KEY env when available", () => {
    const r = resolveAuth(
      {},
      env({ ANTHROPIC_API_KEY: "env-key" }),
      yesClaudeCli
    );
    expect(r.mode).toBe("api_key");
    expect(r.credential).toBe("env-key");
  });

  it("auto: prefers claude CLI over OAuth FD when both available", () => {
    const tmpFile = join(tmpdir(), `beaver-oauth-${Date.now()}`);
    writeFileSync(tmpFile, "oauth-token");
    const fd = openSync(tmpFile, "r");
    try {
      const r = resolveAuth(
        {},
        env({ CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: String(fd) }),
        yesClaudeCli
      );
      expect(r.mode).toBe("claude_cli");
    } finally {
      closeSync(fd);
      unlinkSync(tmpFile);
    }
  });

  it("auto: falls through to OAuth FD when no api key and no claude CLI", () => {
    const tmpFile = join(tmpdir(), `beaver-oauth-${Date.now()}-b`);
    writeFileSync(tmpFile, "oauth-token-abc");
    const fd = openSync(tmpFile, "r");
    try {
      const r = resolveAuth(
        {},
        env({ CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: String(fd) }),
        noClaudeCli
      );
      expect(r.mode).toBe("oauth");
      expect(r.credential).toBe("oauth-token-abc");
      expect(r.source).toContain("OAuth");
    } finally {
      closeSync(fd);
      unlinkSync(tmpFile);
    }
  });

  it("auto: throws LLMConfigError when nothing is available", () => {
    expect(() => resolveAuth({}, env({}), noClaudeCli)).toThrow(LLMConfigError);
  });

  it("auto: uses claude_cli when only the binary is available", () => {
    const r = resolveAuth({}, env({}), yesClaudeCli);
    expect(r.mode).toBe("claude_cli");
    expect(r.credential).toBe("");
    expect(r.source).toContain("claude");
  });

  it("authMode=api_key: ignores OAuth FD even if set", () => {
    const tmpFile = join(tmpdir(), `beaver-oauth-${Date.now()}-2`);
    writeFileSync(tmpFile, "should-be-ignored");
    const fd = openSync(tmpFile, "r");
    try {
      expect(() =>
        resolveAuth(
          { authMode: "api_key" },
          env({ CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: String(fd) }),
          yesClaudeCli
        )
      ).toThrow(LLMConfigError);
    } finally {
      closeSync(fd);
      unlinkSync(tmpFile);
    }
  });

  it("authMode=oauth: ignores ANTHROPIC_API_KEY even if set", () => {
    expect(() =>
      resolveAuth(
        { authMode: "oauth" },
        env({ ANTHROPIC_API_KEY: "should-be-ignored" }),
        yesClaudeCli
      )
    ).toThrow(LLMConfigError);
  });

  it("authMode=oauth: reads from FD when present", () => {
    const tmpFile = join(tmpdir(), `beaver-oauth-${Date.now()}-3`);
    writeFileSync(tmpFile, "bearer-xyz\n"); // trailing newline trimmed
    const fd = openSync(tmpFile, "r");
    try {
      const r = resolveAuth(
        { authMode: "oauth" },
        env({
          CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: String(fd),
          ANTHROPIC_API_KEY: "not-used",
        }),
        noClaudeCli
      );
      expect(r.mode).toBe("oauth");
      expect(r.credential).toBe("bearer-xyz");
    } finally {
      closeSync(fd);
      unlinkSync(tmpFile);
    }
  });

  it("authMode=claude_cli: succeeds when binary is available", () => {
    const r = resolveAuth(
      { authMode: "claude_cli" },
      env({ ANTHROPIC_API_KEY: "ignored" }),
      yesClaudeCli
    );
    expect(r.mode).toBe("claude_cli");
  });

  it("authMode=claude_cli: throws when binary is unavailable", () => {
    expect(() =>
      resolveAuth({ authMode: "claude_cli" }, env({}), noClaudeCli)
    ).toThrow(LLMConfigError);
  });

  it("rejects non-integer FD values silently (falls through)", () => {
    expect(() =>
      resolveAuth(
        {},
        env({ CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: "not-a-number" }),
        noClaudeCli
      )
    ).toThrow(LLMConfigError);
  });
});

describe("buildHeaders", () => {
  it("sets x-api-key for api_key mode", () => {
    const auth: AuthResolution = {
      mode: "api_key",
      credential: "sk-test",
      source: "test",
    };
    const h = buildHeaders(auth);
    expect(h["x-api-key"]).toBe("sk-test");
    expect(h["authorization"]).toBeUndefined();
    expect(h["anthropic-beta"]).toBeUndefined();
    expect(h["anthropic-version"]).toBe("2023-06-01");
  });

  it("sets Authorization Bearer + anthropic-beta for oauth mode", () => {
    const auth: AuthResolution = {
      mode: "oauth",
      credential: "oauth-token",
      source: "test",
    };
    const h = buildHeaders(auth);
    expect(h["authorization"]).toBe("Bearer oauth-token");
    expect(h["anthropic-beta"]).toBe("oauth-2025-04-20");
    expect(h["x-api-key"]).toBeUndefined();
  });
});
