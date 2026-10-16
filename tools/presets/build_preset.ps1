# Pipeline de un preset: escena modelada (scenes/<id>.py) → .blend editable → kn5/terreno para la app.
#   powershell -File tools/presets/build_preset.ps1 <id>               # todo
#   powershell -File tools/presets/build_preset.ps1 <id> -ExportOnly   # solo reexportar un .blend retocado a mano
param(
    [Parameter(Mandatory = $true)][string]$Id,
    [switch]$ExportOnly,
    [string]$Blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$root = (Resolve-Path "$here\..\..").Path
$py = "$here\.venv\Scripts\python.exe"

if (-not $ExportOnly) {
    Push-Location $here
    try {
        & $py textures.py
        & $py cc0_textures.py
        & $py -m "scenes.$Id"
        if ($LASTEXITCODE -ne 0) { throw "scenes.$Id falló" }
    } finally { Pop-Location }
    & $Blender -b --factory-startup --python "$here\blender_scene.py" -- $Id
    if ($LASTEXITCODE -ne 0) { throw "blender_scene.py falló" }
}
& $Blender -b "$root\presets\$Id\$Id.blend" --python "$here\blender_export.py" -- $Id
if ($LASTEXITCODE -ne 0) { throw "blender_export.py falló" }
