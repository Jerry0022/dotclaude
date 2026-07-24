# Claude Desktop App Setup (Windows)

Windows-specific reference for Claude Desktop App launcher configuration and bypass-permissions mode.
Referenced by `setup-project` Step 2c and any skill that touches permission mode.

## Which path applies to you?

```
Are you launching Claude Code from the Claude Desktop App (Electron)?
  YES → Read this document in full. The Desktop App controls the permission mode.
  NO  → You launch `claude.exe` directly from a terminal, shortcut, or scheduled task.
        The CLI-level flags in your launcher matter; see "CLI-launcher robustness" below.
        This doc is still worth reading for the Desktop App bypass-flags reference.
```

Confirm your launcher:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'claude.exe'" |
  Where-Object { $_.ExecutablePath -like "*claude-code*" } |
  Select-Object -ExpandProperty CommandLine
```

If the output contains `--permission-mode acceptEdits` and the parent is
`Claude.exe` from `Program Files\WindowsApps\Claude_*`, the Desktop App is
your launcher. Any `--dangerously-skip-permissions` flag on a shortcut or
`.cmd` wrapper is silently overridden.

---

## The three bypass-permissions toggles

The Desktop App stores its prefs in:
- `%APPDATA%\Claude\claude_desktop_config.json`
- Mirror (Store sandbox): `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`

All three keys live under `preferences`:

| Key | Shape | What it gates |
|-----|-------|---------------|
| `bypassPermissionsOptInByAccount` | `{ "<acctId>": true }` | Account-level opt-in (warn-dialog acknowledgement) |
| `bypassPermissionsGateByAccount` | `{ "<acctId>": true }` | Per-folder gate (per-folder warn acknowledgement) |
| **`bypassPermissionsModeEnabled`** | **boolean** | **Master switch — without this, every session is downgraded `bypassPermissions → acceptEdits` at start** |

The first two can be set through in-app flows (warning dialogs). The master
switch is only reachable via **Settings → Bypass permissions mode** in the
Desktop App UI. If it is `false` (or absent), the other two are irrelevant —
the session is always downgraded.

Read the current state:

```powershell
(Get-Content $env:APPDATA\Claude\claude_desktop_config.json -Raw |
  ConvertFrom-Json).preferences |
  Get-Member -MemberType NoteProperty |
  Where-Object { $_.Name -match 'bypass|permission' }
```

---

## Smoking-gun log line

`%APPDATA%\Claude\logs\main.log` records a downgrade on every affected session:

```
[info] [CCD] Downgrading session local_xxxx bypassPermissions → acceptEdits at start — bypassPermissionsModeEnabled pref is off
```

Check for recent occurrences (last 200 lines):

```powershell
Get-Content "$env:APPDATA\Claude\logs\main.log" -Tail 200 |
  Select-String "bypassPermissionsModeEnabled pref is off"
```

Any match means the master switch is off and every CLI session is running in
`acceptEdits` mode regardless of CLI-level flags.

---

## Fix procedure

### Preferred: UI toggle

1. Open the Claude Desktop App.
2. Go to **Settings → Bypass permissions mode**.
3. Enable the toggle.
4. Start a new Claude Code session — the downgrade line will no longer appear.

### Fallback: JSON patch (use only when the UI is unreachable)

Race-safe procedure — the app overwrites the file on exit, so patch order matters:

1. Quit the Desktop App completely (check system tray).
2. Open `%APPDATA%\Claude\claude_desktop_config.json`.
3. Under `preferences`, set `"bypassPermissionsModeEnabled": true`.
4. Apply the identical change to the Store mirror path:
   `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json`
   (path may vary by Store version — search for `claude_desktop_config.json`
   under `%LOCALAPPDATA%\Packages\`).
5. Restart the Desktop App.
6. Verify: `Get-Content "$env:APPDATA\Claude\logs\main.log" -Tail 50 | Select-String "Downgrading"` should return nothing.

Patching only one of the two paths is insufficient — the App reconciles them
on startup and may restore the old value.

---

## CLI-launcher robustness (Direct CLI, no Desktop App)

For users who invoke `claude.exe` directly, the Desktop App has no influence.
The `--dangerously-skip-permissions` flag on the launcher is what matters.
Common failure mode: a `.cmd` wrapper that uses `start ""` detaches the
process and can drop argv inheritance for child worktree tabs.

A robust setup:

- Create a version-stable junction:
  `%APPDATA%\Claude\claude-code\current\` → newest installed version directory.
- A Logon scheduled task refreshes the junction after auto-updates:
  ```powershell
  # Example task action (adjust paths)
  $target = (Get-ChildItem "$env:LOCALAPPDATA\AnthropicClaude" -Directory |
    Sort-Object Name -Descending | Select-Object -First 1).FullName
  cmd /c mklink /J "$env:APPDATA\Claude\claude-code\current" $target
  ```
- Point shortcuts and taskbar pins directly at
  `current\claude.exe --dangerously-skip-permissions`, not through a `.cmd`
  wrapper with `start ""`.

This setup survives auto-updates without relinking shortcuts manually.
