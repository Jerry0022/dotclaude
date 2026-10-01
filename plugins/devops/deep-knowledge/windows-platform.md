# Windows Platform Work

Reference for Windows-specific implementation — system tray, native
notifications, installers and update mechanisms, registry, file associations,
startup behaviour, native API wrappers (Win32, .NET interop). Read it before
such work, whether it runs inline or in the `core` agent. (It replaced the
former `windows` role agent, which saw 8 spawns in 30 days: the domain is
real, but too rare to justify a role of its own.)

## Rules

- **Paths:** never hard-code separators or user folders. Use the platform API
  for `%APPDATA%`, `%LOCALAPPDATA%`, `%PROGRAMDATA%`; expect spaces and
  non-ASCII in every path; long paths (> 260 chars) need the `\\?\` prefix or
  the long-path manifest setting.
- **Privileges:** design for a non-admin user first. Anything that needs
  elevation (HKLM writes, Program Files, services) is a separate, explicit
  step with its own UAC prompt — never a silent requirement.
- **Registry and file operations are defensive:** missing keys, access
  denied, locked files (AV scanners, Explorer previews) and redirected
  folders (OneDrive Known Folder Move) are normal, not exceptions.
- **Tray and notifications:** one tray icon per app, a context menu reachable
  by keyboard, notifications through the app's identity (AUMID) so they group
  correctly; respect Focus Assist.
- **Startup behaviour:** opt-in, reversible from the app's own settings, via
  the Startup folder or `Run` key the user can see — never a hidden scheduled
  task.
- **Installers and auto-update:** per-user install by default; the updater
  must survive a locked file (running instance) and roll back on failure.
  Installer changes need a manual test on a clean machine/VM — CI cannot
  cover them; name that test in the completion card's `userFinalTest`.
- **Child processes:** `windowsHide: true` for every spawned console process,
  so no console window flashes.

## Collaboration

Platform code depends on core contracts and hands off to `qa` for
platform-specific testing, like any other `core` work.
