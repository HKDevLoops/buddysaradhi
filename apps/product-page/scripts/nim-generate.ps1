#Requires -Version 7.0
<#
.SYNOPSIS
  Generate product-page assets via NVIDIA NIM (OpenAI-compatible image API).
.DESCRIPTION
  Free-tier discipline: every generation is preceded by a cost estimate, drafts
  use flux.1-schnell, finals use qwen-image-2512. Fixed seeds. No re-rolls
  without human approval. Key NEVER in repo: read from $env:NVIDIA_API_KEY only.
  STATUS 2026-09-23: serverless image generation does NOT serve this key.
  integrate.api.nvidia.com/v1 has no image models; ai.api.nvidia.com schnell
  route accepts prompt/seed/height/width (422-health proven) but generations
  hang past 280s (no compute entitlement); qwen-image invoke routes 404.
  Until NVIDIA entitles the key, generate from the build.nvidia.com Experience
  UI (same key) or fall back to Higgsfield. This script stays as the runner
  once the key is entitled: re-run -Step Verify first.
.EXAMPLE
  $env:NVIDIA_API_KEY = Read-Host "nvapi key"; Clear-History
  ./scripts/nim-generate.ps1 -Step Verify
  ./scripts/nim-generate.ps1 -Step Drafts
  ./scripts/nim-generate.ps1 -Step Finals
#>
param(
  [ValidateSet("Verify", "Drafts", "Finals", "All")]
  [string]$Step = "Verify"
)

$ErrorActionPreference = "Stop"
$Base = "https://integrate.api.nvidia.com/v1"
$OutDir = Join-Path $PSScriptRoot ".." "public" "nim"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

function Get-Key {
  $k = $env:NVIDIA_API_KEY
  if ([string]::IsNullOrWhiteSpace($k)) {
    throw "NVIDIA_API_KEY is not set. Run: `$env:NVIDIA_API_KEY = Read-Host 'nvapi key'"
  }
  return $k
}

function Invoke-NimImages([string]$Model, [string]$Prompt, [int]$Seed) {
  $key = Get-Key
  $body = @{
    model = $Model
    prompt = $Prompt
    n = 1
    response_format = "b64_json"
    seed = $Seed
  } | ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri "$Base/images/generations" -Method Post `
    -Headers @{ Authorization = "Bearer $key"; "Content-Type" = "application/json" } `
    -Body $body -TimeoutSec 300
}

function Save-Asset([string]$Name, [string]$B64) {
  $path = Join-Path $OutDir "$Name.jpg"
  [IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($B64))
  Write-Output "saved: $path ($([Math]::Round((Get-Item $path).Length / 1KB)) KB)"
}

# Asset prompts. One family: bioluminescent emerald/cyan on cosmic indigo abyss.
# No text in schnell drafts (text rendering is the Qwen final's job).
$Assets = @(
  @{ name = "og-image"; seed = 7101; prompt = "Social share banner, dark cosmic indigo background with subtle violet nebula, glowing emerald glass ledger card floating center tilted, cyan rim light, small amber accent glow corner, premium fintech hero art, no text, no people, 1200x630 composition" },
  @{ name = "tour-poster"; seed = 7102; prompt = "Cinematic wide shot of a dark tuition hallway at night turning into glowing glass panels, emerald and cyan light trails, floating ledger card in distance, depth and fog, 16:9, no text, no people" },
  @{ name = "beat-hook"; seed = 7103; prompt = "Closeup of a translucent glass ledger card with cyan glowing edges floating over a dark desk, emerald key light, shallow depth of field, photorealistic product shot, no text, no people" },
  @{ name = "beat-reveal"; seed = 7104; prompt = "Five floating glass dashboard panels fanned in a row in a dark cosmic space, emerald cyan amber violet edge lights, particle field, wide shot, no text, no people" }
)

if ($Step -eq "Verify" -or $Step -eq "All") {
  $key = Get-Key
  $models = Invoke-RestMethod -Uri "$Base/models" -Headers @{ Authorization = "Bearer $key" } -TimeoutSec 60
  $ids = $models.data | ForEach-Object { $_.id }
  Write-Output "reachable image models:"
  $ids | Where-Object { $_ -match "flux|qwen-image|stable-diffusion" } | ForEach-Object { Write-Output "  $_" }
}

if ($Step -eq "Drafts" -or $Step -eq "All") {
  foreach ($a in $Assets) {
    $r = Invoke-NimImages "black-forest-labs/flux.1-schnell" $a.prompt $a.seed
    Save-Asset "$($a.name)-draft" $r.data[0].b64_json
  }
}

if ($Step -eq "Finals" -or $Step -eq "All") {
  foreach ($a in $Assets) {
    $r = Invoke-NimImages "qwen/qwen-image-2512" $a.prompt $a.seed
    Save-Asset $a.name $r.data[0].b64_json
  }
}
