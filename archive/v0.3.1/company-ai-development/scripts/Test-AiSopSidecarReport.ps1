[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PacketPath,

    [Parameter(Mandatory = $true)]
    [string]$ReportPath,

    [ValidateSet("plan", "final")]
    [string]$ExpectedPhase,

    [string]$PacketSchemaPath,
    [string]$ReportSchemaPath
)

$ErrorActionPreference = "Stop"
$failures = [System.Collections.Generic.List[string]]::new()

function Get-CanonicalTextHash {
    param([Parameter(Mandatory = $true)][string]$Path)

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $start = if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { 3 } else { 0 }
    $normalized = [System.Collections.Generic.List[byte]]::new($bytes.Length)
    for ($index = $start; $index -lt $bytes.Length; $index++) {
        if ($bytes[$index] -eq 13) {
            if (($index + 1) -lt $bytes.Length -and $bytes[$index + 1] -eq 10) { $index++ }
            $normalized.Add(10)
        }
        else {
            $normalized.Add($bytes[$index])
        }
    }
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return (($algorithm.ComputeHash($normalized.ToArray()) | ForEach-Object { $_.ToString("x2") }) -join "")
    }
    finally {
        $algorithm.Dispose()
    }
}

function Get-RawHash {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-RepositorySnapshot {
    param([Parameter(Mandatory = $true)][string]$Root)

    $gitAvailable = $null -ne (Get-Command "git" -ErrorAction SilentlyContinue)
    $isGitRepository = $false
    if ($gitAvailable) {
        $gitProbe = & git -C $Root rev-parse --is-inside-work-tree 2>$null
        $isGitRepository = $LASTEXITCODE -eq 0 -and (($gitProbe | Out-String).Trim()) -eq "true"
    }
    if ($isGitRepository) {
        $relativeFiles = @(& git -C $Root ls-files --cached --others --exclude-standard 2>$null)
        if ($LASTEXITCODE -ne 0) { throw "Unable to enumerate Git repository content for Sidecar snapshot" }
        $algorithmName = "git_worktree_content_sha256_v1"
    }
    else {
        $relativeFiles = @(Get-ChildItem -LiteralPath $Root -Recurse -File | ForEach-Object { [System.IO.Path]::GetRelativePath($Root, $_.FullName) })
        $algorithmName = "filesystem_content_sha256_v1"
    }

    $manifest = [System.Collections.Generic.List[string]]::new()
    foreach ($relativeFile in @($relativeFiles | Sort-Object -Unique)) {
        $portablePath = ([string]$relativeFile).Replace("\", "/")
        if ($portablePath -match "^\.ai-sop(?:/|$)" -or $portablePath -match "^\.git(?:/|$)") { continue }
        $fullPath = [System.IO.Path]::GetFullPath((Join-Path $Root ([string]$relativeFile)))
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            $manifest.Add("$portablePath`tdeleted`t-")
            continue
        }
        $bytes = [System.IO.File]::ReadAllBytes($fullPath)
        $isBinary = $bytes -contains 0
        $mode = if ($isBinary) { "binary" } else { "text_lf" }
        $hash = if ($isBinary) { Get-RawHash $fullPath } else { Get-CanonicalTextHash $fullPath }
        $manifest.Add("$portablePath`t$mode`t$hash")
    }

    $manifestText = (@($manifest) -join "`n")
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $snapshotHash = (($algorithm.ComputeHash([System.Text.UTF8Encoding]::new($false).GetBytes($manifestText)) | ForEach-Object { $_.ToString("x2") }) -join "")
    }
    finally {
        $algorithm.Dispose()
    }
    return [PSCustomObject]@{ algorithm = $algorithmName; sha256 = $snapshotHash; fileCount = $manifest.Count }
}

foreach ($path in @($PacketPath, $ReportPath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        $failures.Add("required Sidecar file not found: $path")
    }
}

if ($failures.Count -eq 0) {
    $packetDirectory = Split-Path -Parent ([System.IO.Path]::GetFullPath($PacketPath))
    if ([string]::IsNullOrWhiteSpace($PacketSchemaPath)) {
        $projectSchema = Join-Path $packetDirectory "schemas\sidecar-packet.schema.json"
        $skillSchema = Join-Path $PSScriptRoot "..\assets\sidecar-packet.schema.json"
        $PacketSchemaPath = if (Test-Path -LiteralPath $projectSchema) { $projectSchema } else { $skillSchema }
    }
    if ([string]::IsNullOrWhiteSpace($ReportSchemaPath)) {
        $projectSchema = Join-Path $packetDirectory "schemas\sidecar-report.schema.json"
        $skillSchema = Join-Path $PSScriptRoot "..\assets\sidecar-report.schema.json"
        $ReportSchemaPath = if (Test-Path -LiteralPath $projectSchema) { $projectSchema } else { $skillSchema }
    }
    if (-not (Test-Path -LiteralPath $PacketSchemaPath)) { $failures.Add("Sidecar packet schema not found: $PacketSchemaPath") }
    if (-not (Test-Path -LiteralPath $ReportSchemaPath)) { $failures.Add("Sidecar report schema not found: $ReportSchemaPath") }
}

if ($failures.Count -eq 0) {
    $packetJson = Get-Content -LiteralPath $PacketPath -Raw
    $reportJson = Get-Content -LiteralPath $ReportPath -Raw
    try {
        if (-not ($packetJson | Test-Json -SchemaFile $PacketSchemaPath -ErrorAction Stop)) { $failures.Add("Sidecar packet does not match its JSON Schema") }
    }
    catch { $failures.Add("Sidecar packet schema validation failed: $($_.Exception.Message)") }
    try {
        if (-not ($reportJson | Test-Json -SchemaFile $ReportSchemaPath -ErrorAction Stop)) { $failures.Add("Sidecar report does not match its JSON Schema") }
    }
    catch { $failures.Add("Sidecar report schema validation failed: $($_.Exception.Message)") }
}

if ($failures.Count -eq 0) {
    try { $packet = Get-Content -LiteralPath $PacketPath -Raw | ConvertFrom-Json }
    catch { $failures.Add("Sidecar packet is invalid JSON: $($_.Exception.Message)") }
    try { $report = Get-Content -LiteralPath $ReportPath -Raw | ConvertFrom-Json }
    catch { $failures.Add("Sidecar report is invalid JSON: $($_.Exception.Message)") }
}

if ($failures.Count -eq 0) {
    $actualPacketHash = Get-CanonicalTextHash $PacketPath
    if ($report.packetHash -ne $actualPacketHash) { $failures.Add("Sidecar report packetHash does not match the current packet") }
    if ($report.packetId -ne $packet.packetId) { $failures.Add("Sidecar report packetId does not match the current packet") }
    if ($report.phase -ne $packet.phase) { $failures.Add("Sidecar report phase does not match the packet") }
    if ($ExpectedPhase -and $report.phase -ne $ExpectedPhase) { $failures.Add("Sidecar report phase is not '$ExpectedPhase'") }
    if ($report.decision -ne "pass") { $failures.Add("Sidecar decision is '$($report.decision)', not 'pass'") }
    if (@($report.issues).Count -gt 0) { $failures.Add("Sidecar pass report must not contain issues") }
    if (@($report.missingEvidence).Count -gt 0) { $failures.Add("Sidecar pass report must not contain missingEvidence") }
    if ([string]::IsNullOrWhiteSpace([string]$report.reviewedAt)) { $failures.Add("Sidecar report reviewedAt is required") }

    $repositoryRoot = if ([System.IO.Path]::IsPathRooted([string]$packet.repositoryRoot)) {
        [System.IO.Path]::GetFullPath([string]$packet.repositoryRoot)
    }
    else {
        [System.IO.Path]::GetFullPath((Join-Path $packetDirectory ([string]$packet.repositoryRoot)))
    }
    if (-not (Test-Path -LiteralPath $repositoryRoot -PathType Container)) {
        $failures.Add("Sidecar repository root no longer exists: $($packet.repositoryRoot)")
    }
    else {
        try {
            $currentSnapshot = Get-RepositorySnapshot $repositoryRoot
            if ($currentSnapshot.algorithm -ne $packet.repositorySnapshot.algorithm) { $failures.Add("Sidecar repository snapshot algorithm changed") }
            if ($currentSnapshot.sha256 -ne $packet.repositorySnapshot.sha256) { $failures.Add("repository content changed after Sidecar review") }
            if ($currentSnapshot.fileCount -ne $packet.repositorySnapshot.fileCount) { $failures.Add("repository file set changed after Sidecar review") }
        }
        catch {
            $failures.Add("unable to verify Sidecar repository snapshot: $($_.Exception.Message)")
        }
    }

    foreach ($file in @($packet.files)) {
        if ($file.hashMode -ne "text_lf_sha256") {
            $failures.Add("unsupported Sidecar hashMode: $($file.hashMode)")
            continue
        }
        if ($packet.phase -eq "final" -and $file.portable -ne $true) {
            $failures.Add("final Sidecar evidence is not portable: $($file.path)")
            continue
        }
        $resolvedFilePath = if ([System.IO.Path]::IsPathRooted([string]$file.path)) {
            [System.IO.Path]::GetFullPath([string]$file.path)
        }
        else {
            [System.IO.Path]::GetFullPath((Join-Path $packetDirectory ([string]$file.path)))
        }
        if (-not (Test-Path -LiteralPath $resolvedFilePath -PathType Leaf)) {
            $failures.Add("Sidecar input no longer exists: $($file.path)")
            continue
        }
        $actualHash = Get-CanonicalTextHash $resolvedFilePath
        if ($actualHash -ne ([string]$file.sha256).ToLowerInvariant()) {
            $failures.Add("Sidecar input changed after review packet creation: $($file.path)")
        }
    }
}

$result = [ordered]@{
    passed = $failures.Count -eq 0
    phase = if ($report) { $report.phase } else { $ExpectedPhase }
    decision = if ($report) { $report.decision } else { "unavailable" }
    packetPath = [System.IO.Path]::GetFullPath($PacketPath)
    reportPath = [System.IO.Path]::GetFullPath($ReportPath)
    failures = @($failures)
}
$result | ConvertTo-Json -Depth 10
if ($failures.Count -gt 0) { exit 1 }
