/**
 * Git context detection.
 *
 * Detects whether the session operated in a git repo,
 * and collects basic repo information.
 */

import { execSync } from "child_process";
import type { GitContext, RepoInfo } from "../types/report.js";

export async function detectGitContext(
  workingDirectory?: string
): Promise<GitContext> {
  const cwd = workingDirectory || process.cwd();

  try {
    // Check if we're in a git repo
    const gitRoot = execSafe("git rev-parse --show-toplevel", cwd);
    if (!gitRoot) {
      return { detected: false, type: "no_repo", repos: [] };
    }

    const branch = execSafe("git rev-parse --abbrev-ref HEAD", cwd);
    const status = execSafe("git status --porcelain", cwd);

    const repos: RepoInfo[] = [
      {
        path: gitRoot,
        branch: branch || undefined,
        hasUncommittedChanges: (status || "").length > 0,
      },
    ];

    return {
      detected: true,
      type: "single_repo",
      repos,
    };
  } catch {
    return { detected: false, type: "no_repo", repos: [] };
  }
}

function execSafe(command: string, cwd: string): string | null {
  try {
    return execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}
