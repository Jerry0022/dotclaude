# dotclaude setup — deploy global Claude Code configuration from this repo to ~/.claude/
# PowerShell script for native Windows (non-Git-Bash) usage.
$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
$ClaudeHome = Join-Path $env:USERPROFILE ".claude"

Write-Host "dotclaude setup" -ForegroundColor Cyan
Write-Host "==============="
Write-Host "Source:      $ScriptDir"
Write-Host "Destination: $ClaudeHome"
Write-Host ""

function Copy-TrackedFile {
    param([string]$Src, [string]$Dst)
    $DstDir = Split-Path $Dst -Parent
    if (-not (Test-Path $DstDir)) { New-Item -ItemType Directory -Path $DstDir -Force | Out-Null }
    if (Test-Path $Dst) {
        $srcHash = (Get-FileHash $Src -Algorithm MD5).Hash
        $dstHash = (Get-FileHash $Dst -Algorithm MD5).Hash
        if ($srcHash -eq $dstHash) {
            Write-Host "  [skip]   $Dst (identical)"
            return
        }
        Write-Host "  [update] $Dst"
    } else {
        Write-Host "  [create] $Dst"
    }
    Copy-Item $Src $Dst -Force
}

# 0. Plan selection
Write-Host "Which Claude plan do you have?" -ForegroundColor Yellow
Write-Host ""
Write-Host "  [1] Free   - token-optimized: no hooks, 2 skills, lite instructions"
Write-Host "  [2] Pro    - balanced: dashboard, 5 skills, full instructions"
Write-Host "  [3] Max    - full: all hooks, all skills, drift detection, cost guard"
Write-Host ""
$planChoice = Read-Host "Select plan [1/2/3] (default: 1)"
if ([string]::IsNullOrWhiteSpace($planChoice)) { $planChoice = "1" }

switch ($planChoice) {
    "1" { $Plan = "free" }
    "2" { $Plan = "pro" }
    "3" { $Plan = "max" }
    default { Write-Host "Invalid choice. Defaulting to free."; $Plan = "free" }
}

Write-Host ""
Write-Host "Selected plan: $Plan" -ForegroundColor Green
Write-Host ""

# Load plan config
$planConfig = Get-Content "$ScriptDir\templates\plan-config.json" | ConvertFrom-Json
$claudeMdFile = $planConfig.plans.$Plan.claudeMd
$planSkills = $planConfig.plans.$Plan.skills

# 1. Core config
Write-Host "1. Deploying core config files..."
Copy-TrackedFile "$ScriptDir\$claudeMdFile" "$ClaudeHome\CLAUDE.md"

# 2. Commands
Write-Host "2. Deploying commands..."
Get-ChildItem "$ScriptDir\commands\*.md" -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-TrackedFile $_.FullName "$ClaudeHome\commands\$($_.Name)"
}

# 3. Skills (plan-filtered)
Write-Host "3. Deploying skills ($Plan plan)..."
Get-ChildItem "$ScriptDir\skills" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $skillName = $_.Name
    $skillFile = Join-Path $_.FullName "SKILL.md"
    if ($planSkills -contains $skillName) {
        if (Test-Path $skillFile) {
            Copy-TrackedFile $skillFile "$ClaudeHome\skills\$skillName\SKILL.md"
        }
    } else {
        Write-Host "  [skip]  $skillName (not in $Plan plan)"
        $existingSkill = "$ClaudeHome\skills\$skillName\SKILL.md"
        if (Test-Path $existingSkill) {
            Remove-Item $existingSkill -Force
            $skillDir = "$ClaudeHome\skills\$skillName"
            if ((Get-ChildItem $skillDir -ErrorAction SilentlyContinue | Measure-Object).Count -eq 0) {
                Remove-Item $skillDir -Force -ErrorAction SilentlyContinue
            }
            Write-Host "  [remove] $skillName (cleaned up from previous install)"
        }
    }
}

# 4. Scripts
Write-Host "4. Deploying scripts..."
Get-ChildItem "$ScriptDir\scripts\*.js" -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-TrackedFile $_.FullName "$ClaudeHome\scripts\$($_.Name)"
}
Copy-TrackedFile "$ScriptDir\scripts\package.json" "$ClaudeHome\scripts\package.json"
Copy-TrackedFile "$ScriptDir\scripts\package-lock.json" "$ClaudeHome\scripts\package-lock.json"

# Diagram template
$diagramTemplate = "$ScriptDir\scripts\diagrams\template.html"
if (Test-Path $diagramTemplate) {
    $diagramDir = "$ClaudeHome\scripts\diagrams"
    if (-not (Test-Path $diagramDir)) { New-Item -ItemType Directory -Path $diagramDir -Force | Out-Null }
    Copy-TrackedFile $diagramTemplate "$diagramDir\template.html"
}

# 5. Plugins
Write-Host "5. Deploying plugin config..."
Copy-TrackedFile "$ScriptDir\plugins\blocklist.json" "$ClaudeHome\plugins\blocklist.json"

# 6. Settings.json (plan-specific)
Write-Host "6. Deploying settings.json ($Plan plan)..."
$settingsTemplate = "$ScriptDir\templates\settings.$Plan.json"
if (-not (Test-Path $settingsTemplate)) {
    $settingsTemplate = "$ScriptDir\templates\settings.template.json"
}
$settingsPath = "$ClaudeHome\settings.json"
if (Test-Path $settingsPath) {
    Write-Host "  [warn]  settings.json already exists - creating backup"
    Copy-Item $settingsPath "$settingsPath.backup" -Force
}
Copy-Item $settingsTemplate $settingsPath -Force

# 7. Config.json
Write-Host "7. Deploying config.json..."
$configPath = "$ClaudeHome\scripts\config.json"
if (Test-Path $configPath) {
    Write-Host "  [skip]  config.json already exists (runtime data preserved)"
} else {
    Copy-TrackedFile "$ScriptDir\templates\config.template.json" $configPath
}

# 8. Store repo path and plan
Write-Host "8. Storing repo path and plan..."
$ScriptDir | Out-File -FilePath "$ClaudeHome\scripts\dotclaude-repo-path" -Encoding utf8 -NoNewline
$Plan | Out-File -FilePath "$ClaudeHome\scripts\dotclaude-plan" -Encoding utf8 -NoNewline
Write-Host "  [create] dotclaude-repo-path"
Write-Host "  [create] dotclaude-plan ($Plan)"

# 9. npm install
Write-Host "9. Installing script dependencies..."
$npmPath = Get-Command npm -ErrorAction SilentlyContinue
if ($npmPath) {
    Push-Location "$ClaudeHome\scripts"
    try {
        npm ci --silent 2>$null
        Write-Host "  [done]  npm ci"
    } catch {
        npm install --silent 2>$null
        Write-Host "  [done]  npm install"
    }
    Pop-Location
} else {
    Write-Host "  [warn]  npm not found - install Node.js and run 'npm ci' in $ClaudeHome\scripts\"
}

# 10. Taskbar shortcut (Windows only)
Write-Host "10. Creating taskbar shortcut..."
$shortcutScript = "$ScriptDir\scripts\create-taskbar-shortcut.ps1"
if (Test-Path $shortcutScript) {
    & $shortcutScript -Force
} else {
    Write-Host "  [skip]  create-taskbar-shortcut.ps1 not found"
}

# 11. Summary
Write-Host ""
Write-Host "Setup complete! (plan: $Plan)" -ForegroundColor Green
Write-Host ""

switch ($Plan) {
    "free" {
        Write-Host "Token-optimized setup deployed:"
        Write-Host "  - Lite instructions (CLAUDE-lite.md) - reduced context overhead"
        Write-Host "  - 2 skills: commit, debug"
        Write-Host "  - No hooks - maximum token budget for your work"
        Write-Host ""
        Write-Host "Next steps:"
        Write-Host "  1. Start a Claude Code session - you're ready to go"
        Write-Host "  2. To upgrade later, re-run setup and select a different plan"
    }
    "pro" {
        Write-Host "Balanced setup deployed:"
        Write-Host "  - Full instructions (CLAUDE.md)"
        Write-Host "  - 5 skills: commit, debug, explain, readme, ship-dotclaude"
        Write-Host "  - SessionStart dashboard hook"
        Write-Host ""
        Write-Host "Next steps:"
        Write-Host "  1. Add MCP server permissions to settings.json if needed"
        Write-Host "  2. Start a Claude Code session to verify"
    }
    "max" {
        Write-Host "Full setup deployed:"
        Write-Host "  - Full instructions (CLAUDE.md)"
        Write-Host "  - All 7 skills"
        Write-Host "  - All hooks: dashboard, drift detection, cost guard"
        Write-Host ""
        Write-Host "Next steps:"
        Write-Host "  1. Add MCP server permissions to settings.json"
        Write-Host "     (see templates/plugins-manifest.json for patterns)"
        Write-Host "  2. Install plugins (see templates/plugins-manifest.json)"
        Write-Host "  3. Start a Claude Code session to verify"
    }
}

Write-Host ""
