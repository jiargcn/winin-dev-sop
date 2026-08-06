[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$StatePath,

    [ValidateSet("route", "implementation", "review")]
    [string]$Gate = "review"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $StatePath)) {
    Write-Error "Task state not found: $StatePath"
    exit 1
}

try {
    $state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
}
catch {
    Write-Error "Task state is not valid JSON: $($_.Exception.Message)"
    exit 1
}

$failures = [System.Collections.Generic.List[string]]::new()
$stateDirectory = Split-Path -Parent ([System.IO.Path]::GetFullPath($StatePath))
$projectSchemaPath = Join-Path $stateDirectory "schemas\task-state.schema.json"
$skillSchemaPath = Join-Path $PSScriptRoot "..\assets\task-state.schema.json"
$taskSchemaPath = if (Test-Path -LiteralPath $projectSchemaPath) { $projectSchemaPath } else { $skillSchemaPath }
if (-not (Test-Path -LiteralPath $taskSchemaPath)) {
    $failures.Add("task state schema is missing: $taskSchemaPath")
}
else {
    try {
        $stateJson = Get-Content -LiteralPath $StatePath -Raw
        if (-not ($stateJson | Test-Json -SchemaFile $taskSchemaPath -ErrorAction Stop)) { $failures.Add("task state does not match its JSON Schema") }
    }
    catch { $failures.Add("task state schema validation failed: $($_.Exception.Message)") }
}
function Require-Value {
    param($Value, [string]$Message)
    if ($null -eq $Value -or ([string]$Value).Trim().Length -eq 0) {
        $script:failures.Add($Message)
    }
}
function Require-Items {
    param($Value, [string]$Message)
    if ($null -eq $Value -or @($Value).Count -eq 0) {
        $script:failures.Add($Message)
    }
}

function Resolve-StateRelativePath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
    $filePath = ($Path -split '#', 2)[0]
    if ([System.IO.Path]::IsPathRooted($filePath)) { return [System.IO.Path]::GetFullPath($filePath) }
    $stateDirectory = Split-Path -Parent $StatePath
    $portablePath = $filePath.Replace("\", "/")
    if ($portablePath.StartsWith(".ai-sop/", [System.StringComparison]::OrdinalIgnoreCase)) {
        $filePath = $portablePath.Substring(8)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $stateDirectory $filePath))
}

function Require-SidecarPass {
    param([string]$Phase)
    $record = $state.sidecar.$Phase
    if (-not $record) {
        $script:failures.Add("Sidecar $Phase evidence is missing from task state")
        return
    }
    $packetPath = Resolve-StateRelativePath ([string]$record.packetPath)
    $reportPath = Resolve-StateRelativePath ([string]$record.reportPath)
    if ([string]::IsNullOrWhiteSpace($packetPath) -or [string]::IsNullOrWhiteSpace($reportPath)) {
        $script:failures.Add("Sidecar $Phase packetPath and reportPath are required")
        return
    }
    $validatorPath = Join-Path $PSScriptRoot "Test-AiSopSidecarReport.ps1"
    if (-not (Test-Path -LiteralPath $validatorPath)) {
        $script:failures.Add("Sidecar report validator is missing: $validatorPath")
        return
    }
    $pwshExecutable = if ($IsWindows) { Join-Path $PSHOME "pwsh.exe" } else { Join-Path $PSHOME "pwsh" }
    $validationOutput = & $pwshExecutable -NoProfile -File $validatorPath -PacketPath $packetPath -ReportPath $reportPath -ExpectedPhase $Phase 2>&1
    if ($LASTEXITCODE -ne 0) {
        $script:failures.Add("Sidecar $Phase report validation failed: $((($validationOutput | Out-String).Trim()))")
        return
    }
    try {
        $packet = Get-Content -LiteralPath $packetPath -Raw | ConvertFrom-Json
        $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
        $taskStateEntry = @($packet.files | Where-Object { $_.role -eq "task_state" })
        if ($taskStateEntry.Count -ne 1) {
            $script:failures.Add("Sidecar $Phase packet must contain exactly one task_state entry")
        }
        else {
            $packetDirectory = Split-Path -Parent $packetPath
            $packetStatePath = if ([System.IO.Path]::IsPathRooted([string]$taskStateEntry[0].path)) {
                [System.IO.Path]::GetFullPath([string]$taskStateEntry[0].path)
            }
            else {
                [System.IO.Path]::GetFullPath((Join-Path $packetDirectory ([string]$taskStateEntry[0].path)))
            }
            if ($packetStatePath -ne [System.IO.Path]::GetFullPath($StatePath)) {
                $script:failures.Add("Sidecar $Phase packet is bound to a different task state file")
            }
        }
        if ($report.scenario -ne $state.scenario.code) {
            $script:failures.Add("Sidecar $Phase report scenario '$($report.scenario)' does not match task scenario '$($state.scenario.code)'")
        }
    }
    catch {
        $script:failures.Add("Sidecar $Phase binding validation failed: $($_.Exception.Message)")
    }
}

Require-Value $state.taskId "taskId is required"
Require-Value $state.sopVersion "sopVersion is required"
Require-Value $state.title "title is required"
Require-Value $state.repositoryRoot "repositoryRoot is required"
Require-Value $state.baselineCommit "baselineCommit is required"
Require-Value $state.task.goal "task.goal is required"
Require-Items $state.task.acceptanceCriteria "at least one acceptance criterion is required"

if ($state.status -eq "cancelled" -or $state.phase -eq "cancelled") {
    $failures.Add("task is cancelled and cannot pass '$Gate' gate")
}

$allowedScenarios = @("A1", "A2", "A3", "B", "C", "D", "E")
if ($state.scenario.code -notin $allowedScenarios) {
    $failures.Add("scenario.code must be one of: $($allowedScenarios -join ', ')")
}
if ($state.scenario.confidence -eq "low") {
    $failures.Add("scenario confidence is low; resolve classification before continuing")
}
if ($state.signals.unclear -eq $true) {
    $failures.Add("task or business rules remain unclear; resolve the ambiguity before routing")
}
if (@($state.inputs.missing).Count -gt 0) {
    $failures.Add("missing inputs remain: $(@($state.inputs.missing) -join '; ')")
}

if ($Gate -in @("implementation", "review")) {
    Require-Items $state.evidence.analysis "analysis evidence is required before implementation"
    if ($Gate -eq "implementation") { Require-SidecarPass "plan" }

    if ($state.sidecar.mode -in @("pending", "unavailable")) {
        $failures.Add("Sidecar mode '$($state.sidecar.mode)' cannot pass implementation or review")
    }
    if ($state.sidecar.mode -eq "manual_fallback") {
        $highRiskSignals = @("databaseChange", "contractChange", "momCoreChange", "security", "performanceRisk", "intermittent", "hotfix", "newArchitecture")
        $hasHighRisk = @($highRiskSignals | Where-Object { $state.signals.$_ -eq $true }).Count -gt 0
        $manualFallbackAllowed = $state.scenario.code -eq "A3" -or ($state.scenario.code -eq "B" -and -not $hasHighRisk)
        if (-not $manualFallbackAllowed) {
            $failures.Add("manual_fallback is allowed only for A3 or low-risk local B tasks")
        }
    }

    if ($state.scenario.confidence -eq "medium" -and $state.scenario.confirmedByHuman -ne $true) {
        $failures.Add("medium-confidence scenario requires human confirmation before implementation")
    }

    foreach ($signalProperty in $state.signals.PSObject.Properties) {
        if ($signalProperty.Value -eq $true) {
            $action = $state.conditionActions.$($signalProperty.Name)
            if (-not $action -or $action.status -ne "complete" -or @($action.evidence).Count -eq 0) {
                $failures.Add("condition action '$($signalProperty.Name)' must be complete and include evidence")
            }
            else {
                foreach ($evidencePath in @($action.evidence)) {
                    $resolvedEvidencePath = Resolve-StateRelativePath ([string]$evidencePath)
                    if (-not (Test-Path -LiteralPath $resolvedEvidencePath -PathType Leaf)) {
                        $failures.Add("condition action '$($signalProperty.Name)' evidence file is missing: $evidencePath")
                    }
                }
            }
        }
    }

    $approvalMap = [ordered]@{
        databaseChange = "database"
        contractChange = "integration"
        momCoreChange = "domain"
        security = "security"
        performanceRisk = "performance"
        hotfix = "hotfix"
        newArchitecture = "architecture"
    }
    foreach ($entry in $approvalMap.GetEnumerator()) {
        if ($state.signals.$($entry.Key) -eq $true) {
            $prefix = "$($entry.Value):"
            $foundApproval = @($state.approvals | Where-Object { ([string]$_).StartsWith($prefix) }).Count -gt 0
            if (-not $foundApproval) {
                $failures.Add("signal '$($entry.Key)' requires approval entry '$prefix...'")
            }
        }
    }

    if ($state.scenario.code -eq "A3") {
        foreach ($risk in @("databaseChange", "contractChange", "momCoreChange", "security", "performanceRisk", "hotfix", "newArchitecture")) {
            if ($state.signals.$risk -eq $true) {
                $failures.Add("A3 cannot continue with signal '$risk'; reclassify the task")
            }
        }
    }
}

if ($Gate -eq "review") {
    Require-Items $state.evidence.tests "test evidence is required for review"
    Require-Items $state.evidence.reviews "human diff review evidence is required for review"
    Require-SidecarPass "final"
    if ($state.phase -ne "ready_for_review" -or $state.status -ne "ready_for_review") {
        $failures.Add("phase and status must both be 'ready_for_review'")
    }
}

$result = [ordered]@{
    gate = $Gate
    passed = $failures.Count -eq 0
    taskId = $state.taskId
    scenario = $state.scenario.code
    failures = @($failures)
}
$result | ConvertTo-Json -Depth 10
if ($failures.Count -gt 0) {
    exit 1
}
