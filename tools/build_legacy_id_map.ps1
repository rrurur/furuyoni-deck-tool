[CmdletBinding()]
param(
  [string]$CharactersPath = "",
  [string]$OutputPath = "",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not $CharactersPath) {
  $CharactersPath = Join-Path $RepoRoot "characters_tarot.json"
}
if (-not $OutputPath) {
  $OutputPath = Join-Path $RepoRoot "legacy_id_map.json"
}

if (-not (Test-Path -LiteralPath $CharactersPath)) {
  throw "Not found: $CharactersPath"
}
if ((Test-Path -LiteralPath $OutputPath) -and -not $Force) {
  throw "Legacy ID map already exists. It must not be regenerated during a season update: $OutputPath"
}

$characters = Get-Content -LiteralPath $CharactersPath -Raw | ConvertFrom-Json
$seen = @{}
$cardPaths = [System.Collections.Generic.List[string]]::new()
$tarotNames = [System.Collections.Generic.List[string]]::new()

foreach ($tarot in $characters) {
  $tarotNames.Add([string]$tarot.name)
  foreach ($cardPath in @($tarot.cards)) {
    $path = [string]$cardPath
    if (-not $seen.ContainsKey($path)) {
      $seen[$path] = $true
      $cardPaths.Add($path)
    }
  }
}

$value = [ordered]@{
  schemaVersion = 1
  note = "旧投稿の数値ID復元用。次シーズン更新時も再生成しないこと。"
  cardPaths = @($cardPaths)
  tarotNames = @($tarotNames)
}
$json = $value | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText(
  $OutputPath,
  $json + [Environment]::NewLine,
  [System.Text.UTF8Encoding]::new($false)
)

[pscustomobject]@{
  OutputPath = $OutputPath
  CardCount = $cardPaths.Count
  TarotCount = $tarotNames.Count
} | Format-List
