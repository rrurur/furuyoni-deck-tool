[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$CommonsRoot = "C:\Users\fragi\Desktop\furuyoni_commons_re\furuyoni_re",
  [string]$NewSeason = "",
  [string]$ArchiveSeason = "",
  [string]$ArchiveImageFolder = "",
  [string]$ArchiveTarotFolder = "",
  [string]$TimelinePublicDir = "E:\自作ｐｙ\furutl\public",
  [string]$NewAssetFolder = "",
  [switch]$PlanOnly,
  [switch]$SkipArchive,
  [switch]$ReuseExistingArchive,
  [switch]$KeepLocalArchive
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $RepoRoot "season_config.json"
$CharactersPath = Join-Path $RepoRoot "characters_tarot.json"
$LegacyIdMapPath = Join-Path $RepoRoot "legacy_id_map.json"
$ImagesDir = Join-Path $RepoRoot "images"
$TarotsDir = Join-Path $RepoRoot "tarots"
$CardsSourceDir = Join-Path $CommonsRoot "cards"
$TarotsSourceDir = Join-Path $CommonsRoot "tarots"
$TimelineAssetsDir = Join-Path $TimelinePublicDir "assets"

function Read-JsonFile($Path) {
  Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Save-JsonFile($Path, $Value) {
  $json = $Value | ConvertTo-Json -Depth 80
  [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}

function Ensure-Directory($Path) {
  if ($PlanOnly) { return }
  if (-not (Test-Path -LiteralPath $Path)) {
    if ($PSCmdlet.ShouldProcess($Path, "Create directory")) {
      New-Item -ItemType Directory -Path $Path | Out-Null
    }
  }
}

function Copy-File($Source, $Destination) {
  if ($PlanOnly) { return }
  Ensure-Directory (Split-Path -Parent $Destination)
  if ($PSCmdlet.ShouldProcess($Destination, "Copy from $Source")) {
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
  }
}

function Copy-DirectorySnapshot($Source, $Destination) {
  if (Test-Path -LiteralPath $Destination) {
    if ($ReuseExistingArchive) {
      Write-Host "reuse archive: $Destination"
      return
    }
    throw "Archive already exists: $Destination. Use -ReuseExistingArchive only after confirming its contents, or choose another archive folder."
  }
  if ($PlanOnly) {
    Write-Host "plan archive: $Source -> $Destination"
    return
  }
  Ensure-Directory $Destination
  if ($PSCmdlet.ShouldProcess($Destination, "Archive current directory from $Source")) {
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force
    }
  }
}

function Sync-AssetDirectory($Source, $Destination) {
  if ($PlanOnly) {
    Write-Host "plan asset sync: $Source -> $Destination"
    return
  }
  Ensure-Directory $Destination
  if ($PSCmdlet.ShouldProcess($Destination, "Sync public assets from $Source")) {
    Get-ChildItem -LiteralPath $Source -File | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $Destination $_.Name) -Force
    }
  }
}

function Get-OfficialCardSource($TargetLeaf) {
  $leaf = $TargetLeaf -replace "^na_", ""
  $direct = Join-Path $CardsSourceDir $leaf
  if (Test-Path -LiteralPath $direct) { return $direct }

  $base = [System.IO.Path]::GetFileNameWithoutExtension($leaf)
  $ext = [System.IO.Path]::GetExtension($leaf)
  $aliases = @(
    ($base -replace "_rework$", ""),
    ($base -replace "_s\d+(?:_\d+)?$", ""),
    (($base -replace "_rework$", "") -replace "_s\d+(?:_\d+)?$", "")
  ) | Select-Object -Unique
  foreach ($alias in $aliases) {
    if ($alias -eq $base) { continue }
    $candidate = Join-Path $CardsSourceDir ($alias + $ext)
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }

  return $null
}

function Get-CardSlotInfo($Leaf) {
  if ($Leaf -notmatch "^(?:na_)?(?<number>\d+)_(?<character>[^_]+)_(?<form>[^_]+)_(?<kind>[ns])_(?<index>\d+)(?:_.*)?\.png$") {
    return $null
  }

  return [pscustomobject]@{
    CharacterKey = "$($Matches.number)_$($Matches.character)"
    Form = $Matches.form
    Slot = "$($Matches.kind)_$($Matches.index)"
  }
}

function Get-TarotForm($TarotPath) {
  $leaf = Split-Path -Leaf ([string]$TarotPath)
  if ($leaf -match "^tarot_\d+(?:_(?<form>[^.]+))?\.png$") {
    if ($Matches.form) { return $Matches.form }
    return "o"
  }
  return ""
}

function Get-OfficialStandardCardIndex {
  $index = @{}
  foreach ($source in Get-ChildItem -LiteralPath $CardsSourceDir -File -Filter "*.png") {
    if ($source.Name -notmatch "^(?<number>\d+)_(?<character>[^_]+)_(?<form>[^_]+)_(?<kind>[ns])_(?<index>\d+)\.png$") {
      continue
    }

    $key = "$($Matches.number)_$($Matches.character)|$($Matches.form)|$($Matches.kind)_$($Matches.index)"
    $index[$key] = "images/na_$($source.Name)"
  }
  return $index
}

function Convert-TarotLeafName($OfficialLeaf) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($OfficialLeaf)
  if ($name -match "^tarot_(\d+)_.+?(_a\d+)?$") {
    return "tarot_$($Matches[1])$($Matches[2]).png"
  }
  return $OfficialLeaf
}

foreach ($path in @($ConfigPath, $CharactersPath, $LegacyIdMapPath, $CardsSourceDir, $TarotsSourceDir, $ImagesDir, $TarotsDir)) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "Not found: $path"
  }
}

$config = Read-JsonFile $ConfigPath
if (-not $ArchiveSeason) { $ArchiveSeason = [string]$config.currentSeason }
if (-not $ArchiveImageFolder) { $ArchiveImageFolder = "images_$ArchiveSeason" }
if (-not $ArchiveTarotFolder) { $ArchiveTarotFolder = "tarots_$ArchiveSeason" }
$currentAssetFolder = [string]$config.currentAssetFolder
if (-not $currentAssetFolder) { throw "season_config.json currentAssetFolder is required." }
if ($NewSeason -and -not $NewAssetFolder) {
  throw "-NewAssetFolder is required when -NewSeason is specified. Use an internal English folder name such as season11."
}

if (-not $SkipArchive) {
  $currentAssetDir = Join-Path $TimelineAssetsDir $currentAssetFolder
  if (-not (Test-Path -LiteralPath $currentAssetDir)) {
    Sync-AssetDirectory $ImagesDir (Join-Path $currentAssetDir "images")
    Sync-AssetDirectory $TarotsDir (Join-Path $currentAssetDir "tarots")
  } else {
    Write-Host "current season assets already archived: $currentAssetDir"
  }
  if ($KeepLocalArchive) {
    Copy-DirectorySnapshot $ImagesDir (Join-Path $RepoRoot $ArchiveImageFolder)
    Copy-DirectorySnapshot $TarotsDir (Join-Path $RepoRoot $ArchiveTarotFolder)
  }
}

$copiedCards = 0
foreach ($source in Get-ChildItem -LiteralPath $CardsSourceDir -File -Filter "*.png") {
  Copy-File $source.FullName (Join-Path $ImagesDir ("na_" + $source.Name))
  $copiedCards++
}

$characters = Read-JsonFile $CharactersPath
$aliasCopies = 0
$missingAliases = New-Object System.Collections.Generic.List[string]
foreach ($tarot in $characters) {
  if (-not ($tarot.cards -is [System.Collections.IEnumerable])) { continue }
  foreach ($cardPath in $tarot.cards) {
    $cardPathText = [string]$cardPath
    if (-not $cardPathText.StartsWith("images/")) { continue }
    $targetLeaf = Split-Path -Leaf $cardPathText
    $source = Get-OfficialCardSource $targetLeaf
    if ($source) {
      Copy-File $source (Join-Path $ImagesDir $targetLeaf)
      $aliasCopies++
    } elseif (-not (Test-Path -LiteralPath (Join-Path $ImagesDir $targetLeaf))) {
      $missingAliases.Add($cardPathText)
    }
  }
}

$characterByTarotLeaf = @{}
foreach ($tarot in $characters) {
  $tarotLeaf = Split-Path -Leaf ([string]$tarot.img)
  if ($tarotLeaf) {
    $characterByTarotLeaf[$tarotLeaf] = [string]$tarot.name
  }
}

$copiedTarots = 0
$replayTarotNames = New-Object System.Collections.Generic.List[string]
$unmatchedTarots = New-Object System.Collections.Generic.List[string]
foreach ($source in Get-ChildItem -LiteralPath $TarotsSourceDir -File -Filter "*.png") {
  $targetLeaf = Convert-TarotLeafName $source.Name
  Copy-File $source.FullName (Join-Path $TarotsDir $targetLeaf)
  $copiedTarots++
  if ($targetLeaf -eq "tarotback.png") { continue }
  if ($characterByTarotLeaf.ContainsKey($targetLeaf)) {
    $replayTarotNames.Add($characterByTarotLeaf[$targetLeaf])
  } else {
    $unmatchedTarots.Add($source.Name)
  }
}

$officialStandardCards = Get-OfficialStandardCardIndex
$replayTarotNameSet = @{}
foreach ($name in $replayTarotNames) {
  $replayTarotNameSet[[string]$name] = $true
}

$replayBaseReplacements = 0
$replayFormReplacements = 0
$replayCardChanges = 0
foreach ($tarot in $characters) {
  if (-not $replayTarotNameSet.ContainsKey([string]$tarot.name)) { continue }
  if (-not ($tarot.cards -is [System.Collections.IEnumerable])) { continue }

  $tarotForm = Get-TarotForm $tarot.img
  $updatedCards = @()
  foreach ($cardPath in $tarot.cards) {
    $originalPath = [string]$cardPath
    $selectedPath = $originalPath
    $slotInfo = Get-CardSlotInfo (Split-Path -Leaf $selectedPath)
    if ($slotInfo) {
      $baseKey = "$($slotInfo.CharacterKey)|o|$($slotInfo.Slot)"
      if ($officialStandardCards.ContainsKey($baseKey)) {
        $basePath = [string]$officialStandardCards[$baseKey]
        if ($selectedPath -ne $basePath) { $replayBaseReplacements++ }
        $selectedPath = $basePath
      }

      if ($tarotForm -and $tarotForm -ne "o") {
        $formKey = "$($slotInfo.CharacterKey)|$tarotForm|$($slotInfo.Slot)"
        if ($officialStandardCards.ContainsKey($formKey)) {
          $formPath = [string]$officialStandardCards[$formKey]
          if ($selectedPath -ne $formPath) { $replayFormReplacements++ }
          $selectedPath = $formPath
        }
      }
    }
    if ($selectedPath -ne $originalPath) { $replayCardChanges++ }
    $updatedCards += $selectedPath
  }
  $tarot.cards = $updatedCards
}

if (-not $PlanOnly -and $PSCmdlet.ShouldProcess($CharactersPath, "Apply replay base cards, then replay form replacements")) {
  Save-JsonFile $CharactersPath $characters
}

if ($NewSeason) {
  $config.currentSeason = $NewSeason
  $past = @($ArchiveSeason) + @($config.pastSeasons | Where-Object { $_ -ne $ArchiveSeason -and $_ -ne $NewSeason })
  $config.pastSeasons = $past

  if (-not $config.PSObject.Properties["imageFoldersBySeason"]) {
    $config | Add-Member -NotePropertyName "imageFoldersBySeason" -NotePropertyValue ([pscustomobject]@{})
  }
  $config.imageFoldersBySeason | Add-Member -NotePropertyName $ArchiveSeason -NotePropertyValue $ArchiveImageFolder -Force
  if (-not $config.PSObject.Properties["assetFoldersBySeason"]) {
    $config | Add-Member -NotePropertyName "assetFoldersBySeason" -NotePropertyValue ([pscustomobject]@{})
  }
  $config.assetFoldersBySeason | Add-Member -NotePropertyName $ArchiveSeason -NotePropertyValue $currentAssetFolder -Force
  $config.currentAssetFolder = $NewAssetFolder
  $config.assetVersion = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss")
  $config.replayTarotNames = @($replayTarotNames)

  if (-not $PlanOnly -and $PSCmdlet.ShouldProcess($ConfigPath, "Update currentSeason, image folders, and complete-match tarot list")) {
    Save-JsonFile $ConfigPath $config
  }
}

if (-not $PlanOnly -and (Test-Path -LiteralPath $TimelinePublicDir)) {
  $publishAssetFolder = if ($NewSeason) { $NewAssetFolder } else { $currentAssetFolder }
  $publishAssetDir = Join-Path $TimelineAssetsDir $publishAssetFolder
  if ((Test-Path -LiteralPath $publishAssetDir) -and $NewSeason -and -not $ReuseExistingArchive) {
    throw "New asset folder already exists: $publishAssetDir. Choose another -NewAssetFolder or use -ReuseExistingArchive after confirming its contents."
  }
  Sync-AssetDirectory $ImagesDir (Join-Path $publishAssetDir "images")
  Sync-AssetDirectory $TarotsDir (Join-Path $publishAssetDir "tarots")
  Copy-File $ConfigPath (Join-Path $TimelinePublicDir "season_config.json")
  Copy-File $LegacyIdMapPath (Join-Path $TimelinePublicDir "legacy_id_map.json")
}

[pscustomobject]@{
  CommonsRoot = $CommonsRoot
  PlanOnly = [bool]$PlanOnly
  ArchiveSeason = $ArchiveSeason
  ArchiveImageFolder = $ArchiveImageFolder
  ArchiveTarotFolder = $ArchiveTarotFolder
  CurrentAssetFolder = $currentAssetFolder
  NewAssetFolder = $NewAssetFolder
  CopiedCards = $copiedCards
  AliasCopies = $aliasCopies
  CopiedTarots = $copiedTarots
  ReplayTarotCount = $replayTarotNames.Count
  ReplayBaseReplacements = $replayBaseReplacements
  ReplayFormReplacements = $replayFormReplacements
  ReplayCardChanges = $replayCardChanges
  MissingAliasCount = $missingAliases.Count
  UnmatchedTarotCount = $unmatchedTarots.Count
  TimelineConfig = if (Test-Path -LiteralPath $TimelinePublicDir) { Join-Path $TimelinePublicDir "season_config.json" } else { "not found" }
} | Format-List

if ($missingAliases.Count -gt 0) {
  Write-Warning "Some card paths in characters_tarot.json did not match official cards:"
  $missingAliases | Select-Object -First 80 | ForEach-Object { Write-Warning $_ }
  if ($missingAliases.Count -gt 80) {
    Write-Warning "...and $($missingAliases.Count - 80) more"
  }
}

if ($unmatchedTarots.Count -gt 0) {
  Write-Warning "Official tarot files not found in characters_tarot.json:"
  $unmatchedTarots | ForEach-Object { Write-Warning $_ }
}
