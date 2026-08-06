[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$StatePath,
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $StatePath)) {
    throw "Task state not found: $StatePath"
}

$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path (Split-Path -Parent $StatePath) "completion-report.md"
}

function Write-List {
    param($Items)
    if ($null -eq $Items -or @($Items).Count -eq 0) { return "- 无" }
    return (@($Items) | ForEach-Object { "- $_" }) -join "`n"
}

$finalSidecarReportPath = [string]$state.sidecar.final.reportPath
$finalSidecarDecision = "unavailable"
if (-not [string]::IsNullOrWhiteSpace($finalSidecarReportPath)) {
    $resolvedSidecarReport = if ([System.IO.Path]::IsPathRooted($finalSidecarReportPath)) { $finalSidecarReportPath } else { Join-Path (Split-Path -Parent $StatePath) $finalSidecarReportPath }
    if (Test-Path -LiteralPath $resolvedSidecarReport) {
        try { $finalSidecarDecision = (Get-Content -LiteralPath $resolvedSidecarReport -Raw | ConvertFrom-Json).decision } catch { $finalSidecarDecision = "invalid_report" }
    }
}

$activeSignals = @($state.signals.PSObject.Properties | Where-Object { $_.Value -eq $true } | ForEach-Object { $_.Name })
$conditionActionEvidence = @($activeSignals | ForEach-Object {
    $action = $state.conditionActions.$_
    "$($_)：$($action.status)；$(@($action.evidence) -join '；')"
})
$report = @"
# AI 协作开发完成记录

## 任务

- 任务编号：$($state.taskId)
- SOP版本：$($state.sopVersion)
- 标题：$($state.title)
- 场景：$($state.scenario.code)
- 基线提交：$($state.baselineCommit)
- 状态：$($state.status)

## 目标与范围

$($state.task.goal)

### 验收标准

$(Write-List $state.task.acceptanceCriteria)

### 明确不包含

$(Write-List $state.task.outOfScope)

## 附加情况

$(Write-List $activeSignals)

### 附加动作证据

$(Write-List $conditionActionEvidence)

## 分析证据

$(Write-List $state.evidence.analysis)

## 测试证据

$(Write-List $state.evidence.tests)

## 人工与 Sidecar 复核

$(Write-List $state.evidence.reviews)

- Sidecar 最终结论：$finalSidecarDecision
- Sidecar 报告：$finalSidecarReportPath

## 回退与剩余风险

### 回退证据

$(Write-List $state.evidence.rollback)

### 剩余风险

$(Write-List $state.remainingRisks)

## 结论

$($state.status)
"@

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$report | Set-Content -LiteralPath $OutputPath -Encoding utf8
[PSCustomObject]@{ outputPath = [System.IO.Path]::GetFullPath($OutputPath); status = $state.status } | ConvertTo-Json
