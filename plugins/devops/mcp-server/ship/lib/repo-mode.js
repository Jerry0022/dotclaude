import { execFileSync } from "node:child_process"

const cache = new Map()

export function detectRepoMode(cwd) {
  if (cache.has(cwd)) return cache.get(cwd)

  let mode
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd, encoding: "utf8", stdio: "ignore",
    })
  } catch {
    mode = "none"
    cache.set(cwd, mode)
    return mode
  }

  try {
    execFileSync("git", ["remote", "get-url", "origin"], {
      cwd, encoding: "utf8", stdio: "ignore",
    })
    mode = "git"
  } catch {
    mode = "git-no-remote"
  }

  cache.set(cwd, mode)
  return mode
}

export function isGitRepo(cwd) {
  const mode = detectRepoMode(cwd)
  return mode === "git" || mode === "git-no-remote"
}
