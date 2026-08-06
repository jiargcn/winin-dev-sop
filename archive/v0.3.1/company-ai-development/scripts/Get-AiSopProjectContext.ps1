[CmdletBinding()]
param(
    [string]$RepositoryRoot = ".",
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"

function Get-CommandText {
    param([string]$Command, [string[]]$Arguments)

    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        return "NOT_INSTALLED"
    }
    $result = & $Command @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        return "ERROR: $((($result | Out-String).Trim()))"
    }
    return (($result | Out-String).Trim())
}

$repositoryPath = [System.IO.Path]::GetFullPath($RepositoryRoot)
if (-not (Test-Path -LiteralPath $repositoryPath -PathType Container)) {
    throw "Repository root does not exist: $repositoryPath"
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repositoryPath ".ai-sop\context.json"
}
else {
    $OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
}

$gitInside = Get-CommandText -Command "git" -Arguments @("-C", $repositoryPath, "rev-parse", "--is-inside-work-tree")
$isGit = $gitInside -eq "true"
$trackedFiles = @()
if ($isGit) {
    $tracked = Get-CommandText -Command "git" -Arguments @("-C", $repositoryPath, "ls-files")
    if ($tracked -and -not $tracked.StartsWith("ERROR:")) {
        $trackedFiles = @($tracked -split "`r?`n" | Where-Object { $_ })
    }
}
else {
    $trackedFiles = @(Get-ChildItem -LiteralPath $repositoryPath -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch "[\\/](node_modules|target|dist|build|\.git)[\\/]" } |
        Select-Object -First 500 -ExpandProperty FullName |
        ForEach-Object { [System.IO.Path]::GetRelativePath($repositoryPath, $_) })
}

$interestingPatterns = @(
    "AGENTS.md", "README.md", "pom.xml", "package.json", "vite.config.*",
    "*.sql", "*openapi*", "*swagger*", "*.proto", ".github/workflows/*"
)
$keyFiles = foreach ($file in $trackedFiles) {
    foreach ($pattern in $interestingPatterns) {
        if ($file -like $pattern -or ([System.IO.Path]::GetFileName($file) -like $pattern)) {
            $file
            break
        }
    }
}

$context = [ordered]@{
    schemaVersion = "1.0"
    collectedAt = [DateTimeOffset]::Now.ToString("o")
    repositoryRoot = $repositoryPath
    git = [ordered]@{
        available = $isGit
        branch = if ($isGit) { Get-CommandText "git" @("-C", $repositoryPath, "branch", "--show-current") } else { "" }
        commit = if ($isGit) { Get-CommandText "git" @("-C", $repositoryPath, "rev-parse", "HEAD") } else { "NO_GIT_BASELINE" }
        status = if ($isGit) { Get-CommandText "git" @("-C", $repositoryPath, "status", "--short", "--branch") } else { "" }
    }
    tools = [ordered]@{
        java = Get-CommandText "java" @("-version")
        maven = Get-CommandText "mvn" @("-version")
        node = Get-CommandText "node" @("--version")
        npm = Get-CommandText "npm" @("--version")
    }
    profile = [ordered]@{
        path = Join-Path $repositoryPath ".ai-sop\project-profile.json"
        exists = Test-Path -LiteralPath (Join-Path $repositoryPath ".ai-sop\project-profile.json")
    }
    trackedFileCount = $trackedFiles.Count
    keyFiles = @($keyFiles | Sort-Object -Unique)
}

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$context | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath -Encoding utf8
$context | ConvertTo-Json -Depth 10
