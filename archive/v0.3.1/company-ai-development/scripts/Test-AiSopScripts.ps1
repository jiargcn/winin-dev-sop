[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-sop-test-" + [guid]::NewGuid().ToString("N"))
$cloneRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-sop-clone-" + [guid]::NewGuid().ToString("N"))
$pwshPath = Join-Path $PSHOME "pwsh.exe"
$passed = [System.Collections.Generic.List[string]]::new()

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw "ASSERT FAILED: $Message" }
    $script:passed.Add($Message)
}

function Invoke-GateProcess {
    param([string]$StatePath, [string]$Gate)
    $output = & $pwshPath -NoProfile -File (Join-Path $PSScriptRoot "Test-AiSopGate.ps1") -StatePath $StatePath -Gate $Gate 2>&1
    return [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Output = (($output | Out-String).Trim()) }
}

try {
    New-Item -ItemType Directory -Path $testRoot -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $testRoot "README.md"), "# Sample project`n")
    [System.IO.File]::WriteAllText((Join-Path $testRoot "pom.xml"), "<project><modelVersion>4.0.0</modelVersion></project>`n")
    $docsRoot = Join-Path $testRoot "docs"
    New-Item -ItemType Directory -Path $docsRoot -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $docsRoot "接口契约文档.md"), "# 接口契约`n")
    $frontendRoot = Join-Path $testRoot "frontend"
    New-Item -ItemType Directory -Path $frontendRoot -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $frontendRoot "package.json"), '{"scripts":{"test":"vitest run","build":"vite build"},"dependencies":{"vue":"3.5.0"}}')
    & git -C $testRoot init --initial-branch=main | Out-Null
    & git -C $testRoot config user.email "ai-sop-test@example.invalid"
    & git -C $testRoot config user.name "AI SOP Test"
    & git -C $testRoot add .
    & git -C $testRoot commit -m "initial" | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) "temporary Git repository created"

    $installOutput = & (Join-Path $PSScriptRoot "Initialize-AiSopProject.ps1") -RepositoryRoot $testRoot -InstallGitHubActions -InstallAgentInstruction
    $install = $installOutput | ConvertFrom-Json
    Assert-True (Test-Path -LiteralPath $install.projectProfile) "project profile initialized"
    Assert-True (Test-Path -LiteralPath $install.validator) "CI validator installed"
    Assert-True (Test-Path -LiteralPath $install.profileValidator) "project profile validator installed"
    Assert-True (Test-Path -LiteralPath $install.sidecarValidator) "Sidecar report validator installed"
    Assert-True (Test-Path -LiteralPath $install.githubActions) "GitHub Actions template installed"
    Assert-True (Test-Path -LiteralPath $install.agentSnippet) "AGENTS instruction snippet installed"
    Assert-True ((Get-Content -LiteralPath (Join-Path $testRoot "AGENTS.md") -Raw).Contains("`$company-ai-development")) "AGENTS.md automatically routes development tasks to the Skill"
    $draftProfile = Get-Content -LiteralPath $install.projectProfile -Raw | ConvertFrom-Json
    Assert-True (@($draftProfile.commands.backendTest).Count -gt 0 -and @($draftProfile.commands.backendBuild).Count -gt 0) "project profile draft detects Maven commands"
    Assert-True ($draftProfile.repository.frontendPath -eq "frontend" -and @($draftProfile.commands.frontendTest).Count -gt 0 -and @($draftProfile.commands.frontendBuild).Count -gt 0) "project profile draft detects Vue npm commands"
    Assert-True (@($draftProfile.sources.contracts) -contains "docs/接口契约文档.md") "project profile draft detects Chinese contract documents"

    $profileGateBefore = & $pwshPath -NoProfile -File $install.profileValidator -ProfilePath $install.projectProfile 2>&1
    Assert-True ($LASTEXITCODE -ne 0) "project profile gate blocks unconfigured template"
    $profile = Get-Content -LiteralPath $install.projectProfile -Raw | ConvertFrom-Json
    $profile.projectName = "Sample MES"
    $profile.commands.backendTest = @("mvn test")
    $profile.owners.project = "test-owner"
    $profile.verified = $true
    $profile.verifiedAt = [DateTimeOffset]::Now.ToString("o")
    $profile | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $install.projectProfile -Encoding utf8
    $profileSchemaPath = Join-Path $testRoot ".ai-sop\schemas\project-profile.schema.json"
    Assert-True ((Get-Content -LiteralPath $install.projectProfile -Raw | Test-Json -SchemaFile $profileSchemaPath)) "configured project profile matches JSON Schema"
    $profileGateAfter = & $pwshPath -NoProfile -File $install.profileValidator -ProfilePath $install.projectProfile 2>&1
    Assert-True ($LASTEXITCODE -eq 0) "project profile gate passes verified profile"

    & (Join-Path $PSScriptRoot "New-AiSopTask.ps1") -TaskId "MES-100" -Title "修改报工校验" -RepositoryRoot $testRoot | Out-Null
    $statePath = Join-Path $testRoot ".ai-sop\task-state.json"
    Assert-True (Test-Path -LiteralPath $statePath) "task state initialized"
    $taskSchemaPath = Join-Path $testRoot ".ai-sop\schemas\task-state.schema.json"
    Assert-True ((Get-Content -LiteralPath $statePath -Raw | Test-Json -SchemaFile $taskSchemaPath)) "task state matches JSON Schema"

    $activeTaskReplacement = & $pwshPath -NoProfile -File (Join-Path $PSScriptRoot "New-AiSopTask.ps1") -TaskId "MES-101" -Title "不应覆盖活动任务" -RepositoryRoot $testRoot 2>&1
    Assert-True ($LASTEXITCODE -ne 0) "new task cannot replace an active task in the same branch"

    $initialGate = Invoke-GateProcess $statePath "route"
    Assert-True ($initialGate.ExitCode -ne 0) "route gate blocks incomplete task"

    $planPatchPath = Join-Path $testRoot ".ai-sop\plan-patch.json"
    $analysisPath = Join-Path $testRoot ".ai-sop\analysis.md"
    [System.IO.File]::WriteAllText($analysisPath, "# Analysis`n`nEvidence-backed plan.`n")
    $planPacketPath = Join-Path $testRoot ".ai-sop\sidecar-plan-packet.json"
    $planReportPath = Join-Path $testRoot ".ai-sop\sidecar-plan-report.json"
    $planPatch = [ordered]@{
        scenario = [ordered]@{ code = "A2"; confidence = "high"; reason = "changes existing reporting validation"; confirmedByHuman = $true }
        signals = [ordered]@{ momCoreChange = $true }
        conditionActions = [ordered]@{ momCoreChange = [ordered]@{ status = "pending"; evidence = @() } }
        task = [ordered]@{
            source = "MES-100"
            goal = "修改现有报工校验并保持原正常路径"
            outOfScope = @("不修改库存接口")
            acceptanceCriteria = @("非法状态不能报工", "合法状态仍可报工")
        }
        inputs = [ordered]@{ available = @("状态规则", "相关代码"); missing = @() }
        phase = "ready_for_implementation"
        approvals = @("domain:tester:approved")
        evidence = [ordered]@{ analysis = @("analysis.md"); tests = @(); reviews = @(); rollback = @() }
        sidecar = [ordered]@{
            mode = "subagent"
            plan = [ordered]@{ packetPath = "sidecar-plan-packet.json"; reportPath = "sidecar-plan-report.json" }
            final = [ordered]@{ packetPath = ""; reportPath = "" }
        }
        nextAction = "implement"
    }
    $planPatch | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $planPatchPath -Encoding utf8
    & (Join-Path $PSScriptRoot "Update-AiSopTask.ps1") -StatePath $statePath -PatchPath $planPatchPath | Out-Null

    $implementationGateWithoutReport = Invoke-GateProcess $statePath "implementation"
    Assert-True ($implementationGateWithoutReport.ExitCode -ne 0) "implementation gate rejects claimed readiness without valid Sidecar evidence"
    Assert-True ($implementationGateWithoutReport.Output -match "condition action 'momCoreChange'") "implementation gate names the incomplete enhanced action"

    $conditionPatchPath = Join-Path $testRoot ".ai-sop\condition-patch.json"
    [ordered]@{ conditionActions = [ordered]@{ momCoreChange = [ordered]@{ status = "complete"; evidence = @(".ai-sop/analysis.md#evidence") } } } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $conditionPatchPath -Encoding utf8
    & (Join-Path $PSScriptRoot "Update-AiSopTask.ps1") -StatePath $statePath -PatchPath $conditionPatchPath | Out-Null

    [System.IO.File]::AppendAllText((Join-Path $testRoot "README.md"), "one tracked change`n")
    [System.IO.File]::WriteAllText((Join-Path $testRoot "untracked-pilot.txt"), "pilot`n")
    $autoSignalOutput = & (Join-Path $PSScriptRoot "Get-AiSopSignals.ps1") -RepositoryRoot $testRoot -TaskText "检查当前改动" -OutputPath (Join-Path $testRoot ".ai-sop/auto-signals.json")
    $autoSignalResult = $autoSignalOutput | ConvertFrom-Json
    Assert-True (@($autoSignalResult.changedFiles) -contains "README.md" -and @($autoSignalResult.changedFiles) -contains "untracked-pilot.txt") "automatic changed-file discovery keeps tracked and untracked paths separate"

    $externalEvidencePath = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($externalEvidencePath, "not approved for Sidecar")
    $externalPacketAttempt = & $pwshPath -NoProfile -File (Join-Path $PSScriptRoot "New-AiSopSidecarPacket.ps1") -StatePath $statePath -ProjectProfilePath $install.projectProfile -Phase plan -ArtifactPaths $externalEvidencePath -OutputPath (Join-Path $testRoot ".ai-sop\external-packet.json") 2>&1
    Assert-True ($LASTEXITCODE -ne 0) "Sidecar packet rejects evidence outside approved roots"
    Remove-Item -LiteralPath $externalEvidencePath -Force
    $externalEvidencePath = $null

    Push-Location $testRoot
    try {
        $planPacketOutput = & (Join-Path $PSScriptRoot "New-AiSopSidecarPacket.ps1") -StatePath ".ai-sop/task-state.json" -ProjectProfilePath ".ai-sop/project-profile.json" -Phase plan -ArtifactPaths @(".ai-sop/analysis.md") -OutputPath $planPacketPath
    }
    finally {
        Pop-Location
    }
    $planPacket = $planPacketOutput | ConvertFrom-Json
    $planSidecarReport = [ordered]@{
        packetId = $planPacket.packetId
        packetHash = $planPacket.packetHash
        phase = "plan"
        decision = "pass"
        scenario = "A2"
        newSignals = @()
        issues = @()
        missingEvidence = @()
        nextAction = "implement"
        reviewedAt = [DateTimeOffset]::Now.ToString("o")
    }
    $planSidecarReport | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $planReportPath -Encoding utf8
    $sidecarPacketSchemaPath = Join-Path $testRoot ".ai-sop\schemas\sidecar-packet.schema.json"
    $sidecarReportSchemaPath = Join-Path $testRoot ".ai-sop\schemas\sidecar-report.schema.json"
    Assert-True ((Get-Content -LiteralPath $planPacketPath -Raw | Test-Json -SchemaFile $sidecarPacketSchemaPath)) "Sidecar packet matches JSON Schema"
    $planPacketDocument = Get-Content -LiteralPath $planPacketPath -Raw | ConvertFrom-Json
    Assert-True (@($planPacketDocument.files | Where-Object { $_.portable -ne $true -or [System.IO.Path]::IsPathRooted([string]$_.path) }).Count -eq 0) "repository evidence uses portable packet-relative paths"
    Assert-True ((Get-Content -LiteralPath $planReportPath -Raw | Test-Json -SchemaFile $sidecarReportSchemaPath)) "Sidecar report matches JSON Schema"
    $planSidecarValidation = & $pwshPath -NoProfile -File $install.sidecarValidator -PacketPath $planPacketPath -ReportPath $planReportPath -ExpectedPhase plan 2>&1
    Assert-True ($LASTEXITCODE -eq 0) "Sidecar plan report validates against immutable packet"

    $routeGate = Invoke-GateProcess $statePath "route"
    Assert-True ($routeGate.ExitCode -eq 0) "route gate passes complete routing evidence"
    $implementationGate = Invoke-GateProcess $statePath "implementation"
    Assert-True ($implementationGate.ExitCode -eq 0) "implementation gate passes approved plan"

    $reviewPatchPath = Join-Path $testRoot ".ai-sop\review-patch.json"
    $testEvidencePath = Join-Path $testRoot ".ai-sop\test-evidence.md"
    $reviewEvidencePath = Join-Path $testRoot ".ai-sop\human-review.md"
    $diffEvidencePath = Join-Path $testRoot ".ai-sop\final.diff"
    [System.IO.File]::WriteAllText($testEvidencePath, "# Tests`n`nmvn test: exit 0`n")
    [System.IO.File]::WriteAllText($reviewEvidencePath, "# Human review`n`nDiff reviewed.`n")
    [System.IO.File]::WriteAllText($diffEvidencePath, "diff --git a/A.java b/A.java`n")
    $finalPacketPath = Join-Path $testRoot ".ai-sop\sidecar-final-packet.json"
    $finalReportPath = Join-Path $testRoot ".ai-sop\sidecar-final-report.json"
    $reviewPatch = [ordered]@{
        phase = "ready_for_review"
        status = "ready_for_review"
        evidence = [ordered]@{
            tests = @("mvn test: exit 0")
            reviews = @("human diff review completed")
            rollback = @("git revert current commit")
        }
        sidecar = [ordered]@{
            mode = "subagent"
            plan = [ordered]@{ packetPath = "sidecar-plan-packet.json"; reportPath = "sidecar-plan-report.json" }
            final = [ordered]@{ packetPath = "sidecar-final-packet.json"; reportPath = "sidecar-final-report.json" }
        }
        nextAction = "create_pull_request"
    }
    $reviewPatch | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $reviewPatchPath -Encoding utf8
    & (Join-Path $PSScriptRoot "Update-AiSopTask.ps1") -StatePath $statePath -PatchPath $reviewPatchPath | Out-Null

    $finalPacketOutput = & (Join-Path $PSScriptRoot "New-AiSopSidecarPacket.ps1") -StatePath $statePath -ProjectProfilePath $install.projectProfile -Phase final -ArtifactPaths @($analysisPath, $testEvidencePath, $reviewEvidencePath, $diffEvidencePath) -OutputPath $finalPacketPath
    $finalPacket = $finalPacketOutput | ConvertFrom-Json
    $finalSidecarReport = [ordered]@{
        packetId = $finalPacket.packetId
        packetHash = $finalPacket.packetHash
        phase = "final"
        decision = "pass"
        scenario = "A2"
        newSignals = @()
        issues = @()
        missingEvidence = @()
        nextAction = "ready_for_review"
        reviewedAt = [DateTimeOffset]::Now.ToString("o")
    }
    $finalSidecarReport | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $finalReportPath -Encoding utf8
    $finalSidecarValidation = & $pwshPath -NoProfile -File $install.sidecarValidator -PacketPath $finalPacketPath -ReportPath $finalReportPath -ExpectedPhase final 2>&1
    Assert-True ($LASTEXITCODE -eq 0) "Sidecar final report validates against immutable packet"

    $reviewGate = Invoke-GateProcess $statePath "review"
    Assert-True ($reviewGate.ExitCode -eq 0) "review gate passes complete evidence"

    $manualFallbackStatePath = Join-Path $testRoot ".ai-sop\manual-fallback-state.json"
    $manualFallbackState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $manualFallbackState.sidecar.mode = "manual_fallback"
    $manualFallbackState | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manualFallbackStatePath -Encoding utf8
    $manualFallbackGate = Invoke-GateProcess $manualFallbackStatePath "review"
    Assert-True ($manualFallbackGate.ExitCode -ne 0 -and $manualFallbackGate.Output -match "manual_fallback") "high-risk task cannot use manual Sidecar fallback"

    $originalFinalReportText = Get-Content -LiteralPath $finalReportPath -Raw
    $wrongScenarioReport = $originalFinalReportText | ConvertFrom-Json
    $wrongScenarioReport.scenario = "A1"
    $wrongScenarioReport | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $finalReportPath -Encoding utf8
    $wrongScenarioGate = Invoke-GateProcess $statePath "review"
    Assert-True ($wrongScenarioGate.ExitCode -ne 0 -and $wrongScenarioGate.Output -match "does not match task scenario") "Sidecar report scenario must match the current task"
    [System.IO.File]::WriteAllText($finalReportPath, $originalFinalReportText, [System.Text.UTF8Encoding]::new($false))

    $signalOutput = & (Join-Path $PSScriptRoot "Get-AiSopSignals.ps1") -RepositoryRoot $testRoot -TaskText "生产偶发库存重复扣减，需要检查数据库事务和并发" -ChangedFiles @("src/InventoryService.java", "db/migration/V2.sql")
    $signalResult = $signalOutput | ConvertFrom-Json
    Assert-True ($signalResult.signals.databaseChange -eq $true) "database-change signal detected"
    Assert-True ($signalResult.signals.momCoreChange -eq $true) "MOM-core-change signal detected"
    Assert-True ($signalResult.signals.performanceRisk -eq $true) "concurrency signal detected"
    Assert-True ($signalResult.signals.intermittent -eq $true) "intermittent signal detected"

    $reportOutput = & (Join-Path $PSScriptRoot "New-AiSopCompletionReport.ps1") -StatePath $statePath
    $report = $reportOutput | ConvertFrom-Json
    Assert-True (Test-Path -LiteralPath $report.outputPath) "completion report generated"

    & git -C $testRoot add .
    & git -C $testRoot commit -m "complete AI SOP evidence" | Out-Null
    & git clone --quiet $testRoot $cloneRoot
    $clonedStatePath = Join-Path $cloneRoot ".ai-sop\task-state.json"
    $clonedValidatorPath = Join-Path $cloneRoot ".ai-sop\tools\Test-AiSopGate.ps1"
    $clonedReviewOutput = & $pwshPath -NoProfile -File $clonedValidatorPath -StatePath $clonedStatePath -Gate review 2>&1
    Assert-True ($LASTEXITCODE -eq 0) "review gate passes from a fresh checkout at a different path"
    [System.IO.File]::AppendAllText((Join-Path $cloneRoot "README.md"), "changed after Sidecar review`n")
    $changedRepositoryReviewOutput = & $pwshPath -NoProfile -File $clonedValidatorPath -StatePath $clonedStatePath -Gate review 2>&1
    Assert-True ($LASTEXITCODE -ne 0) "review gate rejects repository content changed after Sidecar review"

    [System.IO.File]::AppendAllText($diffEvidencePath, "changed after Sidecar review`n")
    $staleSidecarValidation = & $pwshPath -NoProfile -File $install.sidecarValidator -PacketPath $finalPacketPath -ReportPath $finalReportPath -ExpectedPhase final 2>&1
    Assert-True ($LASTEXITCODE -ne 0) "Sidecar report becomes invalid when reviewed evidence changes"

    $nextTaskOutput = & (Join-Path $PSScriptRoot "New-AiSopTask.ps1") -TaskId "MES-101" -Title "下一任务" -RepositoryRoot $testRoot
    $nextTask = $nextTaskOutput | ConvertFrom-Json
    $nextTaskState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    Assert-True ($nextTask.replacedTaskId -eq "MES-100" -and $nextTaskState.taskId -eq "MES-101") "new task automatically replaces a completed task state"

    $nextTaskState.phase = "cancelled"
    $nextTaskState.status = "cancelled"
    $nextTaskState.nextAction = "task withdrawn"
    $nextTaskState | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $statePath -Encoding utf8
    $cancelledGate = Invoke-GateProcess $statePath "route"
    Assert-True ($cancelledGate.ExitCode -ne 0 -and $cancelledGate.Output -match "cancelled") "cancelled task cannot pass a delivery gate"
    $afterCancelledOutput = & (Join-Path $PSScriptRoot "New-AiSopTask.ps1") -TaskId "MES-102" -Title "取消后的下一任务" -RepositoryRoot $testRoot
    $afterCancelled = $afterCancelledOutput | ConvertFrom-Json
    Assert-True ($afterCancelled.replacedTaskId -eq "MES-101") "new task automatically replaces a cancelled task state"

    $distributionTarget = Join-Path $testRoot "distribution-target"
    New-Item -ItemType Directory -Path $distributionTarget -Force | Out-Null
    $workspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\.."))
    $installerPath = Join-Path $workspaceRoot "tools\Install-CompanyAiDevelopmentSkill.ps1"
    $distributionOutput = & $installerPath -Scope Repository -RepositoryRoot $distributionTarget
    $distribution = $distributionOutput | ConvertFrom-Json
    Assert-True (Test-Path -LiteralPath (Join-Path $distribution.installedPath "SKILL.md")) "repository-scoped Skill installation succeeds"
    Assert-True (Test-Path -LiteralPath (Join-Path $distribution.installedPath "agents\openai.yaml")) "installed Skill includes UI metadata"

    [PSCustomObject]@{
        passed = $true
        assertions = $passed.Count
        details = @($passed)
    } | ConvertTo-Json -Depth 10
}
finally {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $resolvedTestRoot = [System.IO.Path]::GetFullPath($testRoot)
    if ((Test-Path -LiteralPath $resolvedTestRoot) -and $resolvedTestRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
    }
    $resolvedCloneRoot = [System.IO.Path]::GetFullPath($cloneRoot)
    if ((Test-Path -LiteralPath $resolvedCloneRoot) -and $resolvedCloneRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedCloneRoot -Recurse -Force
    }
    if ($externalEvidencePath -and (Test-Path -LiteralPath $externalEvidencePath)) {
        $resolvedExternalEvidence = [System.IO.Path]::GetFullPath($externalEvidencePath)
        if ($resolvedExternalEvidence.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedExternalEvidence -Force
        }
    }
}
