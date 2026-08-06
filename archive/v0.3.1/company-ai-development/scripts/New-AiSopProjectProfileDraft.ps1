[CmdletBinding()]
param(
    [string]$RepositoryRoot = ".",
    [string]$OutputPath,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$repositoryPath = [System.IO.Path]::GetFullPath($RepositoryRoot)
if (-not (Test-Path -LiteralPath $repositoryPath -PathType Container)) {
    throw "Repository root does not exist: $repositoryPath"
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repositoryPath ".ai-sop\project-profile.json"
}
else {
    $OutputPath = [System.IO.Path]::GetFullPath($OutputPath)
}
if ((Test-Path -LiteralPath $OutputPath) -and -not $Force) {
    throw "Project profile already exists and will not be replaced automatically: $OutputPath"
}

function Convert-ToPortablePath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return "" }
    $relative = [System.IO.Path]::GetRelativePath($repositoryPath, [System.IO.Path]::GetFullPath($Path))
    if ([string]::IsNullOrWhiteSpace($relative)) { return "." }
    return $relative.Replace("\", "/")
}

function Get-RepositoryFiles {
    if (Get-Command "git" -ErrorAction SilentlyContinue) {
        $inside = & git -C $repositoryPath rev-parse --is-inside-work-tree 2>$null
        if ($LASTEXITCODE -eq 0 -and (($inside | Out-String).Trim()) -eq "true") {
            return @(& git -C $repositoryPath ls-files --cached --others --exclude-standard 2>$null | Where-Object { $_ })
        }
    }
    return @(Get-ChildItem -LiteralPath $repositoryPath -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch "[\\/](\.git|node_modules|target|dist|build)[\\/]" } |
        Select-Object -First 5000 |
        ForEach-Object { Convert-ToPortablePath $_.FullName })
}

$templatePath = Join-Path $PSScriptRoot "..\assets\project-profile.template.json"
if (-not (Test-Path -LiteralPath $templatePath)) { throw "Project profile template not found: $templatePath" }
$profile = Get-Content -LiteralPath $templatePath -Raw | ConvertFrom-Json
$files = @(Get-RepositoryFiles)

$profile.projectName = Split-Path -Leaf $repositoryPath
$profile.repository.root = "."

$currentBranch = ""
if (Get-Command "git" -ErrorAction SilentlyContinue) {
    $branchOutput = & git -C $repositoryPath branch --show-current 2>$null
    if ($LASTEXITCODE -eq 0) { $currentBranch = (($branchOutput | Out-String).Trim()) }
}
if (-not [string]::IsNullOrWhiteSpace($currentBranch)) { $profile.repository.defaultBranch = $currentBranch }

$pomRelative = @($files | Where-Object { [System.IO.Path]::GetFileName($_) -eq "pom.xml" } | Sort-Object { ($_ -split "[/\\]").Count }, Length | Select-Object -First 1)
if ($pomRelative.Count -gt 0) {
    $pomPath = Join-Path $repositoryPath $pomRelative[0]
    $backendDirectory = Split-Path -Parent $pomPath
    $profile.repository.backendPath = Convert-ToPortablePath $backendDirectory
    $mavenExecutable = if (Test-Path -LiteralPath (Join-Path $repositoryPath "mvnw.cmd")) { ".\mvnw.cmd" } elseif (Test-Path -LiteralPath (Join-Path $repositoryPath "mvnw")) { "./mvnw" } else { "mvn" }
    $pomArgument = if ($profile.repository.backendPath -eq ".") { "" } else { " -f `"$($pomRelative[0].Replace('\','/'))`"" }
    $profile.commands.backendTest = @("$mavenExecutable$pomArgument test")
    $profile.commands.backendBuild = @("$mavenExecutable$pomArgument verify")
}

$frontendCandidate = $null
foreach ($packageRelative in @($files | Where-Object { [System.IO.Path]::GetFileName($_) -eq "package.json" } | Sort-Object { ($_ -split "[/\\]").Count }, Length)) {
    try {
        $packagePath = Join-Path $repositoryPath $packageRelative
        $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
        $hasVue = $null -ne $package.dependencies.vue -or $null -ne $package.devDependencies.vue
        if ($hasVue -or $null -eq $frontendCandidate) {
            $frontendCandidate = [PSCustomObject]@{ Relative = $packageRelative; Path = $packagePath; Package = $package }
        }
        if ($hasVue) { break }
    }
    catch { continue }
}
if ($frontendCandidate) {
    $frontendDirectory = Split-Path -Parent $frontendCandidate.Path
    $profile.repository.frontendPath = Convert-ToPortablePath $frontendDirectory
    $prefix = if ($profile.repository.frontendPath -eq ".") { "npm" } else { "npm --prefix `"$($profile.repository.frontendPath)`"" }
    if ($frontendCandidate.Package.scripts.test) { $profile.commands.frontendTest = @("$prefix run test") }
    elseif ($frontendCandidate.Package.scripts.'test:unit') { $profile.commands.frontendTest = @("$prefix run test:unit") }
    if ($frontendCandidate.Package.scripts.build) { $profile.commands.frontendBuild = @("$prefix run build") }
    if ($frontendCandidate.Package.scripts.lint) { $profile.commands.staticCheck = @("$prefix run lint") }
}

$profile.commands.baseline = @("git status --short --branch")
$profile.sources.architecture = @($files | Where-Object { $_ -match "(^|/)(README|AGENTS)\.md$|(^|/)docs/.*\.md$" } | Select-Object -First 20)
$profile.sources.businessRules = @($files | Where-Object { $_ -match "需求|业务规则|domain|business|requirement|spec" } | Select-Object -First 20)
$profile.sources.ddl = @($files | Where-Object { $_ -match "(?i)(db/migration|migration|flyway|liquibase|ddl).*\.(sql|xml|ya?ml)$|\.sql$" } | Select-Object -First 50)
$profile.sources.contracts = @($files | Where-Object { $_ -match "(?i)(openapi|swagger|asyncapi|\.proto$|contract|接口.{0,8}(契约|文档)|契约.{0,8}(接口|文档))" } | Select-Object -First 50)
$profile.verified = $false
$profile.verifiedAt = $null

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$profile | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputPath -Encoding utf8

[PSCustomObject]@{
    outputPath = [System.IO.Path]::GetFullPath($OutputPath)
    projectName = $profile.projectName
    backendPath = $profile.repository.backendPath
    frontendPath = $profile.repository.frontendPath
    detectedCommands = @($profile.commands.PSObject.Properties | Where-Object { @($_.Value).Count -gt 0 } | ForEach-Object { $_.Name })
    requiresHumanVerification = $true
} | ConvertTo-Json -Depth 10
