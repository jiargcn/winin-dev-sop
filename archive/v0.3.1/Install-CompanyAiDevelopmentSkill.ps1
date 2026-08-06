[CmdletBinding()]
param(
    [ValidateSet("User", "Repository")]
    [string]$Scope = "User",
    [string]$RepositoryRoot,
    [switch]$ReplaceWithBackup
)

$ErrorActionPreference = "Stop"
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $workspaceRoot "skills\company-ai-development"
if (-not (Test-Path -LiteralPath (Join-Path $source "SKILL.md"))) {
    throw "Source Skill is incomplete: $source"
}

if ($Scope -eq "Repository") {
    if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
        throw "-RepositoryRoot is required for Repository scope"
    }
    $repositoryPath = [System.IO.Path]::GetFullPath($RepositoryRoot)
    if (-not (Test-Path -LiteralPath $repositoryPath -PathType Container)) {
        throw "Repository root does not exist: $repositoryPath"
    }
    $destination = Join-Path $repositoryPath ".agents\skills\company-ai-development"
}
else {
    $userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    $destination = Join-Path $userProfile ".agents\skills\company-ai-development"
}

$backup = $null
if (Test-Path -LiteralPath $destination) {
    if (-not $ReplaceWithBackup) {
        throw "Skill already exists. Use -ReplaceWithBackup to preserve the current version before installing: $destination"
    }
    $backup = "$destination.backup-$([DateTime]::Now.ToString('yyyyMMddHHmmss'))"
    Move-Item -LiteralPath $destination -Destination $backup
}

try {
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Recurse
    if (-not (Test-Path -LiteralPath (Join-Path $destination "agents\openai.yaml"))) {
        throw "Installed Skill is missing agents/openai.yaml"
    }
}
catch {
    if ((Test-Path -LiteralPath $destination) -and $destination.EndsWith("company-ai-development")) {
        Remove-Item -LiteralPath $destination -Recurse -Force
    }
    if ($backup -and (Test-Path -LiteralPath $backup)) {
        Move-Item -LiteralPath $backup -Destination $destination
    }
    throw
}

[PSCustomObject]@{
    scope = $Scope
    installedPath = $destination
    backupPath = if ($backup) { $backup } else { "" }
    restartHint = "If Codex does not show the Skill immediately, restart Codex or start a new task."
} | ConvertTo-Json -Depth 5
