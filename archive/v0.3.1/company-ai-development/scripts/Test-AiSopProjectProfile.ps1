[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ProfilePath
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $ProfilePath)) {
    Write-Error "Project profile not found: $ProfilePath"
    exit 1
}

try {
    $profileJson = Get-Content -LiteralPath $ProfilePath -Raw
    $profile = $profileJson | ConvertFrom-Json
}
catch {
    Write-Error "Project profile is not valid JSON: $($_.Exception.Message)"
    exit 1
}

$failures = [System.Collections.Generic.List[string]]::new()
$profileDirectory = Split-Path -Parent ([System.IO.Path]::GetFullPath($ProfilePath))
$projectSchemaPath = Join-Path $profileDirectory "schemas\project-profile.schema.json"
$skillSchemaPath = Join-Path $PSScriptRoot "..\assets\project-profile.schema.json"
$schemaPath = if (Test-Path -LiteralPath $projectSchemaPath) { $projectSchemaPath } else { $skillSchemaPath }
if (-not (Test-Path -LiteralPath $schemaPath)) {
    $failures.Add("project profile schema is missing: $schemaPath")
}
else {
    try {
        if (-not ($profileJson | Test-Json -SchemaFile $schemaPath -ErrorAction Stop)) { $failures.Add("project profile does not match its JSON Schema") }
    }
    catch { $failures.Add("project profile schema validation failed: $($_.Exception.Message)") }
}
if ([string]::IsNullOrWhiteSpace($profile.sopVersion)) { $failures.Add("sopVersion is required") }
if ([string]::IsNullOrWhiteSpace($profile.projectName)) { $failures.Add("projectName is required") }
if ([string]::IsNullOrWhiteSpace($profile.repository.root)) { $failures.Add("repository.root is required") }
if (-not $profile.commands) { $failures.Add("commands object is required") }
else {
    $commandCount = 0
    foreach ($property in $profile.commands.PSObject.Properties) {
        $commandCount += @($property.Value).Count
    }
    if ($commandCount -eq 0) { $failures.Add("at least one verified project command is required") }
}
if (@($profile.aiDataPolicy.forbidden).Count -eq 0) { $failures.Add("aiDataPolicy.forbidden must not be empty") }
if ([string]::IsNullOrWhiteSpace($profile.owners.project)) { $failures.Add("owners.project is required") }
if ($profile.github.commitTaskState -ne $true) { $failures.Add("github.commitTaskState must be true for the standard CI evidence gate") }
if ($profile.verified -ne $true) { $failures.Add("project profile commands and sources must be verified") }
if ([string]::IsNullOrWhiteSpace([string]$profile.verifiedAt)) { $failures.Add("verifiedAt is required when profile is verified") }

$result = [ordered]@{
    passed = $failures.Count -eq 0
    profilePath = [System.IO.Path]::GetFullPath($ProfilePath)
    failures = @($failures)
}
$result | ConvertTo-Json -Depth 10
if ($failures.Count -gt 0) { exit 1 }
