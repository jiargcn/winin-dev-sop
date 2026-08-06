[CmdletBinding()]
param(
    [string]$RepositoryRoot = ".",
    [string]$TaskText = "",
    [string[]]$ChangedFiles,
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$repositoryPath = [System.IO.Path]::GetFullPath($RepositoryRoot)
if (-not (Test-Path -LiteralPath $repositoryPath -PathType Container)) {
    throw "Repository root does not exist: $repositoryPath"
}

if (-not $PSBoundParameters.ContainsKey("ChangedFiles")) {
    $ChangedFiles = @()
    if (Get-Command git -ErrorAction SilentlyContinue) {
        $inside = & git -C $repositoryPath rev-parse --is-inside-work-tree 2>$null
        if ($LASTEXITCODE -eq 0 -and $inside -eq "true") {
            $diffFiles = & git -C $repositoryPath diff --name-only 2>$null
            $statusFiles = & git -C $repositoryPath status --porcelain 2>$null | ForEach-Object {
                if ($_.Length -gt 3) { $_.Substring(3).Trim() }
            }
            # Native command output is a scalar when only one tracked file changed.
            # Wrap both sides before concatenation; otherwise PowerShell concatenates the
            # first status entry into the scalar path and corrupts the candidate file list.
            $ChangedFiles = @(@($diffFiles) + @($statusFiles) | Where-Object { $_ } | Sort-Object -Unique)
        }
    }
}

$combined = (($TaskText, ($ChangedFiles -join " ")) -join " ").ToLowerInvariant()
$definitions = [ordered]@{
    unclear = "待确认|不明确|不清楚|可能|大概|看情况|需求不详"
    unfamiliar = "首次接触|陌生项目|跨模块|跨服务|影响范围不清|文档缺失"
    databaseChange = "ddl|建表|新增字段|修改字段|删除字段|索引变更|约束变更|历史数据|数据修复|数据迁移|migration|db/migration|flyway|liquibase"
    contractChange = "接口变更|新增接口字段|修改接口字段|契约变化|openapi|swagger|消息格式|消息字段|文件格式|第三方适配|\.proto\b|schema变更"
    momCoreChange = "状态流转|库存.{0,8}扣减|库存.{0,8}增加|库存事务|质量判定|报工规则|投料规则|维修状态|追溯关系|事实所有权|冲销|返工|补偿"
    security = "登录|认证|授权|权限|租户|密钥|凭据|敏感信息|security|oauth|jwt|cve|漏洞"
    performanceRisk = "性能|并发|吞吐|响应时间|超时|死锁|锁等待|缓存|连接池|线程|内存|资源泄漏|p95|p99"
    intermittent = "偶发|难复现|无法复现|生产环境|特定环境|幽灵|flaky|间歇"
    hotfix = "紧急修复|hotfix|生产止损|立即上线|紧急上线"
    newArchitecture = "全新架构|技术选型|新框架|架构验证|原型验证|po[cC]\b"
}

$signals = [ordered]@{}
$matches = [ordered]@{}
foreach ($entry in $definitions.GetEnumerator()) {
    $found = [regex]::Matches($combined, $entry.Value, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase) |
        ForEach-Object { $_.Value } | Sort-Object -Unique
    $signals[$entry.Key] = @($found).Count -gt 0
    $matches[$entry.Key] = @($found)
}

if ([string]::IsNullOrWhiteSpace($TaskText) -or $TaskText.Trim().Length -lt 8) {
    $signals.unclear = $true
    $matches.unclear = @($matches.unclear + "task_text_too_short" | Sort-Object -Unique)
}

$result = [ordered]@{
    schemaVersion = "1.0"
    generatedAt = [DateTimeOffset]::Now.ToString("o")
    note = "Signals are candidates. Confirm them against task semantics and project evidence before updating task-state.json."
    changedFiles = @($ChangedFiles)
    signals = $signals
    matches = $matches
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repositoryPath ".ai-sop\signals.json"
}
$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8
$result | ConvertTo-Json -Depth 10
