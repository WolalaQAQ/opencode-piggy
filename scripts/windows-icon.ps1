param([string]$Source, [string]$Target)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile($Source)
$bitmap = [System.Drawing.Bitmap]::new($image, [System.Drawing.Size]::new(128, 128))
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$stream = [System.IO.File]::Create($Target)
try { $icon.Save($stream) }
finally { $stream.Dispose(); $icon.Dispose(); $bitmap.Dispose(); $image.Dispose() }
