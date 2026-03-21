# create-taskbar-shortcut.ps1 — Create/update a Windows taskbar shortcut for Claude Code
# Launches claude.exe with --dangerously-skip-permissions so all file/tool operations are auto-approved.
#
# Claude Code self-updates into versioned folders under %APPDATA%\Claude\claude-code\<version>\claude.exe.
# This script finds the latest version and creates a shortcut pointing to it.
# Re-run after Claude Code updates to refresh the shortcut target.

param(
    [switch]$Force  # Overwrite existing shortcut without prompting
)

$ErrorActionPreference = "Stop"

# ── Locate latest claude.exe ─────────────────────────────────────────────────

$claudeCodeDir = Join-Path $env:APPDATA "Claude\claude-code"
if (-not (Test-Path $claudeCodeDir)) {
    Write-Host "  [error] Claude Code not found at $claudeCodeDir" -ForegroundColor Red
    Write-Host "          Install Claude Code first: https://claude.ai/download"
    exit 1
}

# Find all version directories containing claude.exe, sort by version descending
$versionDirs = Get-ChildItem $claudeCodeDir -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName "claude.exe") } |
    Sort-Object { [version]$_.Name } -Descending

if ($versionDirs.Count -eq 0) {
    Write-Host "  [error] No claude.exe found in any version folder under $claudeCodeDir" -ForegroundColor Red
    exit 1
}

$latestDir = $versionDirs[0]
$claudeExe = Join-Path $latestDir.FullName "claude.exe"
$version = $latestDir.Name

Write-Host "  Claude Code v$version found at: $claudeExe"

# ── Create shortcut ──────────────────────────────────────────────────────────

$taskbarDir = Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
$shortcutPath = Join-Path $taskbarDir "Claude Code.lnk"

if ((Test-Path $shortcutPath) -and -not $Force) {
    Write-Host "  [skip]  Shortcut already exists: $shortcutPath"
    Write-Host "          Use -Force to overwrite"
    return
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $claudeExe
$shortcut.Arguments = "--dangerously-skip-permissions"
$shortcut.WorkingDirectory = $env:USERPROFILE
$shortcut.Description = "Claude Code (skip permissions)"
$shortcut.Save()

if (Test-Path $shortcutPath) {
    $action = if ($Force) { "update" } else { "create" }
    Write-Host "  [$action] $shortcutPath" -ForegroundColor Green
    Write-Host "          Target: $claudeExe --dangerously-skip-permissions"
} else {
    Write-Host "  [error] Failed to create shortcut" -ForegroundColor Red
    exit 1
}
