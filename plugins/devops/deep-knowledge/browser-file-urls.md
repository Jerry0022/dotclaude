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

- `devops-autonomous` (AUTONOMOUS-REPORT.html)
- `devops-concept` (concept pages)
- `devops-repo-health` (interactive branch report)
- any future skill that writes an HTML file and opens it in a browser

## Cross-platform note

On macOS/Linux `$(pwd)` already returns an absolute POSIX path, so
`file://$(pwd)/foo.html` works. The trap is Windows-specific. Skills that run
on both platforms should branch on `$OSTYPE` or unconditionally use
`cygpath -m` (no-op on systems where `cygpath` is absent — guard with
`command -v cygpath`).
