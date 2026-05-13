import { execFileSync } from "node:child_process"

// No cache: long-lived MCP server could see git init / remote changes
// between calls. Each detectRepoMode runs <5ms; staleness is the bigger risk.

export function detectRepoMode(cwd) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd, encoding: "utf8", stdio: "ignore",
    })
  } catch {
    return "none"
  }

  try {
    execFileSync("git", ["remote", "get-url", "origin"], {
      cwd, encoding: "utf8", stdio: "ignore",
    })
    return "git"
  } catch {
    return "git-no-remote"
  }
}

export function isGitRepo(cwd) {
  const mode = detectRepoMode(cwd)
  return mode === "git" || mode === "git-no-remote"
}
