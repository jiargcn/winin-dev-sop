[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$TaskId,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Title,

    [string]$RepositoryRoot = ".",
    [string]$StatePath,
    [switch]$InitializeProjectProfile,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Invoke-TextCommand {
    param([string]$Command, [string[]]$Arguments)

    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        return $null
    }

    $result = & $Command @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) {
        return $null
    }
    return (($result | Out-String).Trim())
}

$repositoryPath = [System.IO.Path]::GetFullPath($RepositoryRoot)
if (-not (Test-Path -LiteralPath $repositoryPath -PathType Container)) {
    throw "Repository root does not exist: $repositoryPath"
}

if ([string]::IsNullOrWhiteSpace($StatePath)) {
    $StatePath = Join-Path $repositoryPath ".ai-sop\task-state.json"
}
else {
    $StatePath = [System.IO.Path]::GetFullPath($StatePath)
}

$replacedTaskId = ""
if ((Test-Path -LiteralPath $StatePath) -and -not $Force) {
    try {
        $existingState = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
    }
    catch {
        throw "Existing task state is invalid and will not be replaced automatically: $StatePath"
    }
    $canRollForward = $existingState.status -in @("ready_for_review", "cancelled") -and $existingState.taskId -ne $TaskId
    if (-not $canRollForward) {
        throw "An active or same-id task state already exists. Use a separate branch/worktree, or use -Force only after confirming replacement is safe: $StatePath"
    }
    $replacedTaskId = [string]$existingState.taskId
}

$templatePath = Join-Path $PSScriptRoot "..\assets\task-state.template.json"
$profileTemplatePath = Join-Path $PSScriptRoot "..\assets\project-profile.template.json"
if (-not (Test-Path -LiteralPath $templatePath)) {
    throw "Task state template not found: $templatePath"
}

$stateDirectory = Split-Path -Parent $StatePath
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null

$state = Get-Content -LiteralPath $templatePath -Raw | ConvertFrom-Json
$baselineCommit = Invoke-TextCommand -Command "git" -Arguments @("-C", $repositoryPath, "rev-parse", "HEAD")
$gitStatus = Invoke-TextCommand -Command "git" -Arguments @("-C", $repositoryPath, "status", "--porcelain")

$state.taskId = $TaskId
$state.title = $Title
$portableRepositoryRoot = [System.IO.Path]::GetRelativePath($stateDirectory, $repositoryPath)
if ([string]::IsNullOrWhiteSpace($portableRepositoryRoot)) { $portableRepositoryRoot = "." }
$state.repositoryRoot = $portableRepositoryRoot.Replace("\", "/")
$state.baselineCommit = if ($baselineCommit) { $baselineCommit } else { "NO_GIT_BASELINE" }
$state.workingTreeInitiallyDirty = -not [string]::IsNullOrWhiteSpace($gitStatus)
$state.updatedAt = [DateTimeOffset]::Now.ToString("o")

$state | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $StatePath -Encoding utf8

$profilePath = Join-Path $repositoryPath ".ai-sop\project-profile.json"
if ($InitializeProjectProfile -and -not (Test-Path -LiteralPath $profilePath)) {
    Copy-Item -LiteralPath $profileTemplatePath -Destination $profilePath
}

[PSCustomObject]@{
    taskStatePath = $StatePath
    projectProfilePath = $profilePath
    baselineCommit = $state.baselineCommit
    workingTreeInitiallyDirty = $state.workingTreeInitiallyDirty
    replacedTaskId = $replacedTaskId
} | ConvertTo-Json -Depth 5
