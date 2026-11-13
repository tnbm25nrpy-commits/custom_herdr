# Copies the live herdr customizations of THIS PC into the repo (live -> repo).
# Run it after changing something, then review `git status` / `git diff` and commit.
#   powershell -NoProfile -ExecutionPolicy Bypass -File export.ps1 [-DryRun]
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
$Repo = $PSScriptRoot
. (Join-Path $Repo 'manifest.ps1')

$changed = 0; $removed = 0
foreach ($area in $Tracked.Keys) {
    $live = $Roots[$area]
    $dest = Join-Path $Repo $area
    $files = Get-TrackedFiles $live $area
    $keep = @{}
    foreach ($rel in $files) {
        $keep[$rel.ToLower()] = $true
        $dst = Join-Path $dest $rel
        if ($DryRun) { Write-Host "copy  $area\$rel"; continue }
        if (Copy-WithHome (Join-Path $live $rel) $dst $HOME $CanonicalHome) { $changed++; Write-Host "updated  $area\$rel" }
    }
    # mirror deletions: files in the repo copy that are no longer tracked/present locally
    if (Test-Path -LiteralPath $dest) {
        foreach ($rel in (Get-TrackedFiles $dest $area)) {
            if (-not $keep.ContainsKey($rel.ToLower())) {
                $removed++
                Write-Host "removed  $area\$rel"
                if (-not $DryRun) { Remove-Item -LiteralPath (Join-Path $dest $rel) -Force }
            }
        }
    }
}
Write-Host "export done: $changed updated, $removed removed. Next: git status, git add -A, git commit, git push"
