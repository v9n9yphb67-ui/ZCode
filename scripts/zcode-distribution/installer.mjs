const packageDirName = "zcode";

export function installPowershellSource(baseUrl) {
  // One-liner PowerShell installer: no sh, no curl, no external tar needed.
  // Uses only built-in .NET + PowerShell 5.1+ cmdlets (works from cmd.exe too:
  // `powershell -NoProfile -ExecutionPolicy Bypass -c "..."`).
  // Env overrides mirror install.sh: ZCODE_DIST_BASE_URL / ZCODE_DIST_HOME / ZCODE_DIST_BIN_DIR.
  return `#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$baseUrl = if ($env:ZCODE_DIST_BASE_URL) { $env:ZCODE_DIST_BASE_URL } else { "${baseUrl}" }
$installDir = if ($env:ZCODE_DIST_HOME) { $env:ZCODE_DIST_HOME } else { Join-Path $HOME ".zcode\\runtime" }
$binDir = if ($env:ZCODE_DIST_BIN_DIR) { $env:ZCODE_DIST_BIN_DIR } else { Join-Path $HOME ".local\\bin" }

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Error "zcode install requires node (https://nodejs.org/)"; exit 1 }

$latest = Invoke-RestMethod -Uri ($baseUrl.TrimEnd("/") + "/latest.json")
$version = $latest.version
$tarball = $latest.tarball
if (-not $version -or -not $tarball) { Write-Error "invalid latest.json from $baseUrl"; exit 1 }

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("zcode-install-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpDir | Out-Null
try {
  $archive = Join-Path $tmpDir $tarball
  if ($baseUrl -match "/releases/download/") {
    $url = $baseUrl.TrimEnd("/") + "/" + $tarball
  } else {
    $url = $baseUrl.TrimEnd("/") + "/releases/" + $version + "/" + $tarball
  }
  Invoke-WebRequest -Uri $url -OutFile $archive -UseBasicParsing

  New-Item -ItemType Directory -Force -Path (Join-Path $installDir "releases"), $binDir | Out-Null
  $targetNew = Join-Path (Join-Path $installDir "releases") ($version + ".new")
  $target = Join-Path (Join-Path $installDir "releases") $version
  if (Test-Path $targetNew) { Remove-Item -Recurse -Force $targetNew }
  New-Item -ItemType Directory -Path $targetNew | Out-Null
  # Native bsdtar (ships with Windows 10 1803+) handles drive-letter paths;
  # Git's GNU tar needs --force-local for the same reason.
  $tarExe = Join-Path ([System.Environment]::GetFolderPath("System")) "tar.exe"
  if (Test-Path $tarExe) {
    & $tarExe -xzf "$archive" -C "$targetNew"
  } else {
    & tar --force-local -xzf "$archive" -C "$targetNew"
  }
  if (-not $?) { Write-Error "failed to extract $tarball"; exit 1 }
  if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  Move-Item -Path (Join-Path $targetNew "${packageDirName}") -Destination $target
  Remove-Item -Recurse -Force $targetNew
  $current = Join-Path $installDir "current"
  # Symlinks need elevation on stock Windows; a plain directory copy works
  # everywhere (same layout as install.sh's final state).
  if (Test-Path $current) { Remove-Item -Recurse -Force $current }
  Copy-Item -Recurse -Force -Path $target -Destination $current

  $shim = Join-Path $binDir "zcode.cmd"
  $runner = Join-Path $current "bin\\zcode.mjs"
  $quote = [char]34
  $shimBody = "@echo off" + [char]13 + [char]10 + "node " + $quote + $runner + $quote + " " + "%" + "*" + [char]13 + [char]10
  $shimBody | Set-Content -Encoding Ascii $shim

  # On Windows, copy shim into WindowsApps so it works immediately in current cmd/shell
  $windowsApps = Join-Path $env:LOCALAPPDATA "Microsoft\\WindowsApps"
  if (Test-Path $windowsApps) {
    Copy-Item -Force -Path $shim -Destination (Join-Path $windowsApps "zcode.cmd")
  }

  # Also ensure binDir is persistently in user environment PATH
  try {
    $userPath = [System.Environment]::GetEnvironmentVariable("PATH", [System.EnvironmentVariableTarget]::User)
    if (-not $userPath) { $userPath = "" }
    $parts = $userPath -split ";" | Where-Object { $_ -ne "" }
    if ($parts -notcontains $binDir) {
      $newUserPath = ($parts + @($binDir)) -join ";"
      [System.Environment]::SetEnvironmentVariable("PATH", $newUserPath, [System.EnvironmentVariableTarget]::User)
    }
  } catch {}

  Write-Output "ZCode $version installed."
  Write-Output "Run: zcode (TUI) or zcode --web (Web)"
} finally {
  Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
}
`;
}

export function installScriptSource(baseUrl) {
  return `#!/usr/bin/env sh
set -eu

BASE_URL="\${ZCODE_DIST_BASE_URL:-${baseUrl}}"
INSTALL_DIR="\${ZCODE_DIST_HOME:-$HOME/.zcode/runtime}"
BIN_DIR="\${ZCODE_DIST_BIN_DIR:-$HOME/.local/bin}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "zcode install requires $1" >&2
    exit 1
  fi
}

need_cmd node
need_cmd curl
need_cmd tar

LATEST_JSON="$(curl -fsSL "\${BASE_URL%/}/latest.json")"
VERSION="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).version))")"
TARBALL="$(printf '%s' "$LATEST_JSON" | node -e "let data='';process.stdin.on('data',c=>data+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(data).tarball))")"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARCHIVE="\$TMP_DIR/\$TARBALL"
if printf '%s' "\$BASE_URL" | grep -q "/releases/download/"; then
  curl -fL "\${BASE_URL%/}/\$TARBALL" -o "\$ARCHIVE"
else
  curl -fL "\${BASE_URL%/}/releases/\$VERSION/\$TARBALL" -o "\$ARCHIVE"
fi

mkdir -p "$INSTALL_DIR/releases" "$BIN_DIR"
TARGET="$INSTALL_DIR/releases/$VERSION"
rm -rf "$TARGET.new"
mkdir -p "$TARGET.new"
tar -xzf "$ARCHIVE" -C "$TARGET.new"
rm -rf "$TARGET"
mv "$TARGET.new/${packageDirName}" "$TARGET"
rm -rf "$TARGET.new"
ln -sfn "$TARGET" "$INSTALL_DIR/current"

cat > "$BIN_DIR/zcode" <<SH
#!/usr/bin/env sh
exec node "$INSTALL_DIR/current/bin/zcode.mjs" "\\$@"
SH
chmod +x "$BIN_DIR/zcode"

echo "ZCode $VERSION installed."
echo "Run: zcode (TUI) or zcode --web (Web)"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Note: $BIN_DIR is not in PATH." ;;
esac
`;
}
