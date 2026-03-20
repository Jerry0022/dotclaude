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

# 1. Core config
Write-Host "1. Deploying core config files..."
Copy-TrackedFile "$ScriptDir\CLAUDE.md" "$ClaudeHome\CLAUDE.md"

# 2. Commands
Write-Host "2. Deploying commands..."
Get-ChildItem "$ScriptDir\commands\*.md" -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-TrackedFile $_.FullName "$ClaudeHome\commands\$($_.Name)"
}

# 3. Skills
Write-Host "3. Deploying skills..."
Get-ChildItem "$ScriptDir\skills" -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $skillFile = Join-Path $_.FullName "SKILL.md"
    if (Test-Path $skillFile) {
        Copy-TrackedFile $skillFile "$ClaudeHome\skills\$($_.Name)\SKILL.md"
    }
}

# 4. Scripts
Write-Host "4. Deploying scripts..."
Get-ChildItem "$ScriptDir\scripts\*.js" -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-TrackedFile $_.FullName "$ClaudeHome\scripts\$($_.Name)"
}
Copy-TrackedFile "$ScriptDir\scripts\package.json" "$ClaudeHome\scripts\package.json"
Copy-TrackedFile "$ScriptDir\scripts\package-lock.json" "$ClaudeHome\scripts\package-lock.json"

# 5. Plugins
Write-Host "5. Deploying plugin config..."
Copy-TrackedFile "$ScriptDir\plugins\blocklist.json" "$ClaudeHome\plugins\blocklist.json"

# 6. Settings.json
Write-Host "6. Deploying settings.json..."
$settingsPath = "$ClaudeHome\settings.json"
if (Test-Path $settingsPath) {
    Write-Host "  [warn]  settings.json already exists - creating backup"
    Copy-Item $settingsPath "$settingsPath.backup" -Force
}
Copy-Item "$ScriptDir\templates\settings.template.json" $settingsPath -Force

# 7. Config.json
Write-Host "7. Deploying config.json..."
$configPath = "$ClaudeHome\scripts\config.json"
if (Test-Path $configPath) {
    Write-Host "  [skip]  config.json already exists (runtime data preserved)"
} else {
    Copy-TrackedFile "$ScriptDir\templates\config.template.json" $configPath
}

# 8. Store repo path
Write-Host "8. Storing repo path for sync-check..."
$repoPathFile = "$ClaudeHome\scripts\dotclaude-repo-path"
$ScriptDir | Out-File -FilePath $repoPathFile -Encoding utf8 -NoNewline
Write-Host "  [create] $repoPathFile"

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

Write-Host ""
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Review settings.json - add MCP server permissions for connected services"
Write-Host "  2. Install plugins (see templates/plugins-manifest.json)"
Write-Host "  3. Start a new Claude Code session to verify"
Write-Host ""
