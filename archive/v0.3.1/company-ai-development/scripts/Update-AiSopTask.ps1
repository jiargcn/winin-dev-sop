[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$StatePath,

    [Parameter(Mandatory = $true)]
    [string]$PatchPath
)

$ErrorActionPreference = "Stop"

function Merge-Object {
    param($Target, $Patch, [string]$Path = "")

    foreach ($property in $Patch.PSObject.Properties) {
        $name = $property.Name
        $currentPath = if ($Path) { "$Path.$name" } else { $name }
        if ($currentPath -in @("schemaVersion", "sopVersion", "taskId", "repositoryRoot", "baselineCommit")) {
            throw "Immutable task field cannot be changed: $currentPath"
        }

        $existing = $Target.PSObject.Properties[$name]
        if (-not $existing) {
            $Target | Add-Member -NotePropertyName $name -NotePropertyValue $property.Value
            continue
        }

        $patchValue = $property.Value
        $targetValue = $existing.Value
        $isPatchObject = $null -ne $patchValue -and $patchValue -is [pscustomobject]
        $isTargetObject = $null -ne $targetValue -and $targetValue -is [pscustomobject]
        if ($isPatchObject -and $isTargetObject) {
            Merge-Object -Target $targetValue -Patch $patchValue -Path $currentPath
        }
        else {
            $Target.$name = $patchValue
        }
    }
}

if (-not (Test-Path -LiteralPath $StatePath)) {
    throw "Task state not found: $StatePath"
}
if (-not (Test-Path -LiteralPath $PatchPath)) {
    throw "Patch file not found: $PatchPath"
}

$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
$patch = Get-Content -LiteralPath $PatchPath -Raw | ConvertFrom-Json
Merge-Object -Target $state -Patch $patch
$state.updatedAt = [DateTimeOffset]::Now.ToString("o")
$state | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $StatePath -Encoding utf8
$state | ConvertTo-Json -Depth 20
