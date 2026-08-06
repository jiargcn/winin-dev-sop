[CmdletBinding()]
param(
    [string]$RepositoryRoot = ".",
    [switch]$InstallGitHubActions,
    [switch]$InstallAgentInstruction,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$repositoryPath = [System.IO.Path]::GetFullPath($RepositoryRoot)
if (-not (Test-Path -LiteralPath $repositoryPath -PathType Container)) {
    throw "Repository root does not exist: $repositoryPath"
}

function Copy-Safe {
    param([string]$Source, [string]$Destination)
    if ((Test-Path -LiteralPath $Destination) -and -not $Force) {
        throw "Target already exists. Review it or use -Force: $Destination"
    }
    $parent = Split-Path -Parent $Destination
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force:$Force
}

$profileSource = Join-Path $PSScriptRoot "..\assets\project-profile.template.json"
$profileTarget = Join-Path $repositoryPath ".ai-sop\project-profile.json"
if (-not (Test-Path -LiteralPath $profileTarget)) {
    & (Join-Path $PSScriptRoot "New-AiSopProjectProfileDraft.ps1") -RepositoryRoot $repositoryPath -OutputPath $profileTarget | Out-Null
}

$agentSnippetSource = Join-Path $PSScriptRoot "..\assets\agents-snippet.md"
$agentSnippetTarget = Join-Path $repositoryPath ".ai-sop\AGENTS-SNIPPET.md"
if (-not (Test-Path -LiteralPath $agentSnippetTarget) -or $Force) {
    Copy-Safe $agentSnippetSource $agentSnippetTarget
}

$agentInstructionStatus = "snippet_only"
if ($InstallAgentInstruction) {
    $agentsPath = Join-Path $repositoryPath "AGENTS.md"
    $marker = "<!-- company-ai-development:start -->"
    if (-not (Test-Path -LiteralPath $agentsPath)) {
        Copy-Item -LiteralPath $agentSnippetSource -Destination $agentsPath
        $agentInstructionStatus = "created"
    }
    else {
        $existingAgents = Get-Content -LiteralPath $agentsPath -Raw
        if ($existingAgents.Contains($marker)) {
            $agentInstructionStatus = "already_present"
        }
        else {
            $backupPath = "$agentsPath.ai-sop-backup-$([DateTime]::Now.ToString('yyyyMMddHHmmss'))"
            Copy-Item -LiteralPath $agentsPath -Destination $backupPath
            $snippet = Get-Content -LiteralPath $agentSnippetSource -Raw
            [System.IO.File]::AppendAllText($agentsPath, "`r`n`r`n$snippet", [System.Text.UTF8Encoding]::new($false))
            $agentInstructionStatus = "appended_with_backup:$backupPath"
        }
    }
}

foreach ($schemaName in @("project-profile.schema.json", "task-state.schema.json", "sidecar-packet.schema.json", "sidecar-report.schema.json")) {
    $schemaSource = Join-Path $PSScriptRoot "..\assets\$schemaName"
    $schemaTarget = Join-Path $repositoryPath ".ai-sop\schemas\$schemaName"
    if (-not (Test-Path -LiteralPath $schemaTarget) -or $Force) {
        Copy-Safe $schemaSource $schemaTarget
    }
}

$validatorSource = Join-Path $PSScriptRoot "Test-AiSopGate.ps1"
$validatorTarget = Join-Path $repositoryPath ".ai-sop\tools\Test-AiSopGate.ps1"
if (-not (Test-Path -LiteralPath $validatorTarget) -or $Force) {
    Copy-Safe $validatorSource $validatorTarget
}

$profileValidatorSource = Join-Path $PSScriptRoot "Test-AiSopProjectProfile.ps1"
$profileValidatorTarget = Join-Path $repositoryPath ".ai-sop\tools\Test-AiSopProjectProfile.ps1"
if (-not (Test-Path -LiteralPath $profileValidatorTarget) -or $Force) {
    Copy-Safe $profileValidatorSource $profileValidatorTarget
}

$profileDraftSource = Join-Path $PSScriptRoot "New-AiSopProjectProfileDraft.ps1"
$profileDraftTarget = Join-Path $repositoryPath ".ai-sop\tools\New-AiSopProjectProfileDraft.ps1"
if (-not (Test-Path -LiteralPath $profileDraftTarget) -or $Force) {
    Copy-Safe $profileDraftSource $profileDraftTarget
}

$sidecarValidatorSource = Join-Path $PSScriptRoot "Test-AiSopSidecarReport.ps1"
$sidecarValidatorTarget = Join-Path $repositoryPath ".ai-sop\tools\Test-AiSopSidecarReport.ps1"
if (-not (Test-Path -LiteralPath $sidecarValidatorTarget) -or $Force) {
    Copy-Safe $sidecarValidatorSource $sidecarValidatorTarget
}

$workflowTarget = Join-Path $repositoryPath ".github\workflows\ai-sop-gate.yml"
if ($InstallGitHubActions -and (-not (Test-Path -LiteralPath $workflowTarget) -or $Force)) {
    $workflowSource = Join-Path $PSScriptRoot "..\assets\github-actions-ai-sop-gate.yml"
    Copy-Safe $workflowSource $workflowTarget
}

[PSCustomObject]@{
    repositoryRoot = $repositoryPath
    projectProfile = $profileTarget
    validator = $validatorTarget
    profileValidator = $profileValidatorTarget
    profileDraft = $profileDraftTarget
    sidecarValidator = $sidecarValidatorTarget
    agentSnippet = $agentSnippetTarget
    agentInstruction = $agentInstructionStatus
    githubActions = if ($InstallGitHubActions) { $workflowTarget } else { "not_requested" }
} | ConvertTo-Json -Depth 5
