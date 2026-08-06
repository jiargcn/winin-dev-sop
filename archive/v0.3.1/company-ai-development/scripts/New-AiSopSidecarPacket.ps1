[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$StatePath,

    [Parameter(Mandatory = $true)]
    [string]$ProjectProfilePath,

    [Parameter(Mandatory = $true)]
    [ValidateSet("plan", "final")]
    [string]$Phase,

    [Parameter(Mandatory = $true)]
    [string[]]$ArtifactPaths,

    [string[]]$AdditionalAllowedRoot = @(),

    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$invocationDirectory = (Get-Location).ProviderPath

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

function Resolve-InputFile {
    param([string]$Path, [string]$BaseDirectory)
    if ([System.IO.Path]::IsPathRooted($Path)) {
        $candidates = @($Path)
    }
    else {
        # State-relative paths are canonical. Also accept repository/current-directory
        # paths such as .ai-sop/project-profile.json to reduce operator friction.
        $candidates = @((Join-Path $BaseDirectory $Path), (Join-Path $invocationDirectory $Path))
    }
    foreach ($candidate in @($candidates | Select-Object -Unique)) {
        $resolved = [System.IO.Path]::GetFullPath($candidate)
        if (Test-Path -LiteralPath $resolved -PathType Leaf) { return $resolved }
    }
    throw "Sidecar input file not found. Tried: $(@($candidates | ForEach-Object { [System.IO.Path]::GetFullPath($_) }) -join '; ')"
}

$stateResolved = Resolve-InputFile $StatePath $invocationDirectory
$stateDirectory = Split-Path -Parent $stateResolved
$stateObject = Get-Content -LiteralPath $stateResolved -Raw | ConvertFrom-Json
$repositoryRootValue = [string]$stateObject.repositoryRoot
$repositoryRoot = if ([System.IO.Path]::IsPathRooted($repositoryRootValue)) {
    [System.IO.Path]::GetFullPath($repositoryRootValue)
}
else {
    [System.IO.Path]::GetFullPath((Join-Path $stateDirectory $repositoryRootValue))
}
$allowedRoots = @($repositoryRoot) + @($AdditionalAllowedRoot | ForEach-Object { [System.IO.Path]::GetFullPath($_) })

function Assert-AllowedPath {
    param([string]$Path)
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $allowed = $false
    foreach ($root in $allowedRoots) {
        $normalizedRoot = [System.IO.Path]::GetFullPath($root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
        $prefix = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar
        if ($fullPath.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $allowed = $true
            break
        }
    }
    if (-not $allowed) {
        throw "Sidecar input is outside the repository and approved evidence roots: $fullPath"
    }
}

Assert-AllowedPath $stateResolved
$profileResolved = Resolve-InputFile $ProjectProfilePath $stateDirectory
Assert-AllowedPath $profileResolved

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $stateDirectory "sidecar-$Phase-packet.json"
}
else {
    $OutputPath = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
        [System.IO.Path]::GetFullPath($OutputPath)
    }
    else {
        [System.IO.Path]::GetFullPath((Join-Path $invocationDirectory $OutputPath))
    }
}
$outputDirectory = Split-Path -Parent $OutputPath
if ($Phase -eq "final") { Assert-AllowedPath $OutputPath }

function Get-PacketPath {
    param([string]$Path)
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $normalizedRoot = $repositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    $rootPrefix = $normalizedRoot + [System.IO.Path]::DirectorySeparatorChar
    $isPortable = $fullPath.Equals($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    if ($Phase -eq "final" -and -not $isPortable) {
        throw "Final Sidecar evidence must be inside the repository so CI can verify it: $fullPath"
    }
    return [PSCustomObject]@{
        Path = if ($isPortable) { [System.IO.Path]::GetRelativePath($outputDirectory, $fullPath).Replace("\", "/") } else { $fullPath }
        Portable = $isPortable
    }
}

$files = [System.Collections.Generic.List[object]]::new()
foreach ($item in @(
    [PSCustomObject]@{ Role = "task_state"; Path = $stateResolved },
    [PSCustomObject]@{ Role = "project_profile"; Path = $profileResolved }
)) {
    $packetPath = Get-PacketPath $item.Path
    $files.Add([ordered]@{
        role = $item.Role
        path = $packetPath.Path
        portable = $packetPath.Portable
        hashMode = "text_lf_sha256"
        sha256 = Get-CanonicalTextHash $item.Path
    })
}

$artifactIndex = 0
foreach ($artifactPath in $ArtifactPaths) {
    $artifactIndex++
    $resolvedArtifact = Resolve-InputFile $artifactPath $stateDirectory
    Assert-AllowedPath $resolvedArtifact
    $packetPath = Get-PacketPath $resolvedArtifact
    $files.Add([ordered]@{
        role = "artifact_$artifactIndex"
        path = $packetPath.Path
        portable = $packetPath.Portable
        hashMode = "text_lf_sha256"
        sha256 = Get-CanonicalTextHash $resolvedArtifact
    })
}

$packet = [ordered]@{
    schemaVersion = "1.0"
    packetId = [guid]::NewGuid().ToString("D")
    phase = $Phase
    createdAt = [DateTimeOffset]::Now.ToString("o")
    pathBase = "packet_directory"
    repositoryRoot = [System.IO.Path]::GetRelativePath($outputDirectory, $repositoryRoot).Replace("\", "/")
    repositorySnapshot = Get-RepositorySnapshot $repositoryRoot
    files = @($files)
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$packet | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8
$packetHash = Get-CanonicalTextHash $OutputPath

[PSCustomObject]@{
    packetPath = [System.IO.Path]::GetFullPath($OutputPath)
    packetId = $packet.packetId
    packetHash = $packetHash
    phase = $Phase
    fileCount = $files.Count
} | ConvertTo-Json -Depth 5
