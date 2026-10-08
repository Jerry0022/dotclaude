# Browser File URLs (Windows + Git-Bash)

Cross-cutting rule: whenever a skill opens a local HTML file in a browser
(Edge, Chrome, Firefox) via `start`, ensure the `file://` URL uses a **native
Windows path with drive colon**, not the MSYS-style path that Git-Bash returns
by default.

## The trap

In Git-Bash on Windows:

```bash
$(pwd)       # → /c/Users/Jerem/...    (MSYS path, no colon, lowercase drive)
pwd -W       # → C:/Users/Jerem/...    (native Windows path)
cygpath -m . # → C:/Users/Jerem/...    (same, portable)
```

Naive concatenation breaks:

```bash
# WRONG — produces file:///c/Users/... → ERR_FILE_NOT_FOUND
start msedge "file://$(pwd)/report.html"
```

Chromium/Edge parses `file:///c/Users/...` and treats `c` as the first path
segment, not a drive letter, because the colon is missing. The browser shows
"Die Datei wurde nicht gefunden" / `ERR_FILE_NOT_FOUND`.

## The rule

**Always** convert to a native Windows path before building the URL, and use
**three** slashes after `file:`:

```bash
# Preferred — cygpath is portable across Git-Bash and MSYS2
start msedge "file:///$(cygpath -m "$(pwd)")/report.html"

# Alternative — pwd -W (Git-Bash specific)
start msedge "file:///$(pwd -W)/report.html"
```

For arbitrary paths (not just `$(pwd)`):

```bash
start msedge "file:///$(cygpath -m "$abs_path")"
```

## Verification

Before shipping any skill that opens a local file, smoke-test the URL
construction:

```bash
echo "file:///$(cygpath -m "$(pwd)")/TEST.html"
# → file:///C:/Users/.../TEST.html   ✓ drive letter + colon
```

If the output shows `file:///c/Users/...` (no colon), the URL is broken.

## Skills that must follow this rule

- do-run autonomous mode (AUTONOMOUS-REPORT.html)
- `concept` (concept pages)
- `auto-cleanup` (interactive branch report)
- any future skill that writes an HTML file and opens it in a browser

## Pair every `file://` open with a tracker call (issue #160)

When the opened file lives inside a worktree, `/do-ship` will later
remove that worktree and the user's browser tab will 404. The session
tracker keeps a list of every file the session opened so the do-ship skill
can re-open it from the equivalent main-repo path post-cleanup:

```bash
start msedge "file:///$(cygpath -m "$ABS_PATH")"

# Track the open so /do-ship Step 5c can re-open from main repo after
# ship_cleanup nukes the worktree.
node "{PLUGIN_ROOT}/scripts/session-open-tracker.js" track \
  "$(cygpath -w "$ABS_PATH")" \
  --context=<short-tag>
```

`cygpath -w` produces the Windows-style absolute path (`C:\Users\…`) the
tracker compares against the worktree root. The `--context` flag is
optional but useful in `/do-ship` Step 5c logs (`concept`,
`autonomous-report`, `repo-health`, etc.).

## Files handed to the user (issue #595)

Not a browser open, but the same Windows path trap: an answer that hands the
user a file to run or open **themselves** — a `.cmd`/`.ps1` they must start
(an elevated script Claude may not run), a report, a log.

| Where the file lives | In the answer | Why |
|---|---|---|
| inside the session's working directory | relative markdown link, `[name](path/rel/to/cwd)` | the app's documented link format — it opens |
| outside the working directory | the absolute Windows path as a code span, `` `C:\Users\…\run.cmd` `` | a relative link climbs out of the cwd and resolves against a hidden workspace (broken); a `file:///C:/…` markdown link is not shown in the Desktop Code tab at all (user test, 2026-09-30) |

In the **same turn**, open Explorer with the file selected so the user can
double-click it straight away (Windows only; skip on macOS/Linux):

```powershell
explorer.exe /select,"C:\Users\Jerem\scripts\run.cmd"
```

From Git-Bash build the backslash path with `cygpath -w` instead of typing
it (the Bash tool halves backslashes in heredocs and `sed`):

```bash
explorer.exe /select,"$(cygpath -w "$ABS_PATH")"
```

`explorer.exe` exits with code 1 even on success — do not read that as a
failure. Open Explorer once per hand-off, not for every file an answer
merely mentions.

### Commands the user must run → always a file

A command Claude may not run itself (admin rights, Defender exclusions, other
security settings) is **never only a fenced code block** in the answer. On the
Desktop app the text before the completion-card widget is easy to miss; a user
asked "gib es mir" after the commands had been posted inline (2026-10-08).
Instead:

1. Write the commands to a script — a `.ps1` that re-launches itself elevated
   (`Start-Process powershell -Verb RunAs -ArgumentList "-File `"$PSCommandPath`""`)
   when admin is needed, ending with a verification print and a `Read-Host`
   so the window stays open.
2. Hand it over per the table above + `explorer.exe /select`.
3. Send it with `SendUserFile` (`display: "attach"`), caption naming how to
   start it ("Rechtsklick → Mit PowerShell ausführen").

A short inline code block may accompany the file, never replace it.

## Cross-platform note

On macOS/Linux `$(pwd)` already returns an absolute POSIX path, so
`file://$(pwd)/foo.html` works. The trap is Windows-specific. Skills that run
on both platforms should branch on `$OSTYPE` or unconditionally use
`cygpath -m` (no-op on systems where `cygpath` is absent — guard with
`command -v cygpath`).
