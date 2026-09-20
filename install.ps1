#Requires -Version 5.1
<#
.SYNOPSIS
    Build 9router from a fork and install it globally.

.DESCRIPTION
    The published `9router` npm package is the launcher plus a *prebuilt* copy of
    the dashboard. Neither `npm install -g 9router` nor `npm update -g 9router`
    can point at a fork - they always fetch the upstream registry build. This
    script builds the tarball from a fork and installs that instead.

.PARAMETER Source
    Optional. One of:
      - omitted                build from this checkout
      - a directory path       build from another checkout
      - owner/repo             clone https://github.com/owner/repo
      - a full git URL         clone it

.PARAMETER BuildOnly
    Build the tarball and stop. Nothing is stopped, nothing is installed.
    Use this to check that a checkout still builds before committing to a
    full reinstall.

.PARAMETER KeepRunning
    Do not stop running 9router instances before installing.

.EXAMPLE
    .\install.ps1
    .\install.ps1 C:\src\9router
    .\install.ps1 pandamoon21/9router
    .\install.ps1 -BuildOnly

.NOTES
    Never use `npm update -g 9router` on a fork install - it silently replaces
    the fork with the upstream build. Re-run this script instead.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string] $Source,

    [switch] $BuildOnly,

    [switch] $KeepRunning
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$DefaultRepoUrl = 'https://github.com/pandamoon21/9router.git'

# ---- output helpers --------------------------------------------------------

function Write-Step { param([string] $Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Warn { param([string] $Message) Write-Host "    $Message" -ForegroundColor Yellow }
function Fail       { param([string] $Message) Write-Host "`nERROR: $Message" -ForegroundColor Red; exit 1 }

# ---- preflight -------------------------------------------------------------

function Assert-Windows {
    if ($env:OS -ne 'Windows_NT') {
        Fail 'This script targets Windows. On Linux/macOS use ./install.sh'
    }
}

function Assert-Tool {
    param([string] $Name, [string] $Why)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Fail "$Name not found in PATH$(if ($Why) { " ($Why)" })"
    }
}

function Assert-NodeVersion {
    $version = (& node -p 'process.versions.node').Trim()
    $major = [int] $version.Split('.')[0]

    if ($major -lt 18) { Fail "Node >= 18 required (have $version)" }
}

# ---- stale-build detection -------------------------------------------------

function Get-NewestSourceWriteTime {
    param([string] $Dir)

    # Only the trees that actually feed the bundle. mtimes survive the copy
    # into cli/app, so a tarball built before the last source edit is stale.
    $roots = @('src', 'open-sse', 'cli') | ForEach-Object { Join-Path $Dir $_ }

    $newest = $null

    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }

        Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' } |
            ForEach-Object {
                if (-not $newest -or $_.LastWriteTimeUtc -gt $newest) { $newest = $_.LastWriteTimeUtc }
            }
    }

    # Wrap so the DateTime survives as one value: a bare `return $newest` inside
    # a loop-emitting function leaks every intermediate value into the caller.
    return ,$newest
}

function Test-FreshTarball {
    param([System.IO.FileInfo] $Tgz, [string] $Dir)

    # The installer picks the newest 9router-*.tgz. If one is left over from an
    # earlier build and the source has moved on since, that stale file gets
    # installed and the run looks successful. Refuse instead.
    $newestSource = Get-NewestSourceWriteTime -Dir $Dir

    if (-not $newestSource) { return }

    if ($Tgz.LastWriteTimeUtc -lt $newestSource) {
        Fail @"
Build produced a tarball older than the source tree.

    tarball: $($Tgz.Name)  $($Tgz.LastWriteTimeUtc.ToString('u'))
    source:  $($newestSource.ToString('u'))

That means npm pack reused an existing package or the build did not run.
Delete the stale tarball and re-run:
    Remove-Item (Join-Path '$Dir' '9router-*.tgz')
"@
    }
}

# ---- source resolution -----------------------------------------------------

function Resolve-SourceDir {
    param([string] $Arg)

    if ([string]::IsNullOrWhiteSpace($Arg)) {
        return (Get-Location).Path
    }

    if (Test-Path -LiteralPath $Arg -PathType Container) {
        return (Resolve-Path -LiteralPath $Arg).Path
    }

    return (Get-ClonedRepo $Arg)
}

function Get-ClonedRepo {
    param([string] $Arg)

    # if/elseif, not `switch -Regex` — PowerShell's switch falls through and
    # would match several of these patterns, concatenating the results.
    if ($Arg -match '^[a-zA-Z][a-zA-Z0-9+.-]*://' -or $Arg -match '^[^@]+@[^:]+:') {
        $url = $Arg
    }
    elseif ($Arg -match '^[^/]+/[^/]+$') {
        $url = "https://github.com/$($Arg.TrimEnd('.git')).git"
    }
    else {
        $url = $DefaultRepoUrl
    }

    Assert-Tool -Name git -Why "needed to clone $url"

    $cloneRoot = Join-Path $env:TEMP "9router-install-$([Guid]::NewGuid().ToString('N'))"

    Write-Step "Cloning $url"

    & git clone --depth 1 $url (Join-Path $cloneRoot 'repo')

    if ($LASTEXITCODE -ne 0) { Fail 'git clone failed' }

    # Registered for cleanup by the finally block at the bottom.
    $script:TempCloneRoot = $cloneRoot

    return (Join-Path $cloneRoot 'repo')
}

function Assert-Checkout {
    param([string] $Dir)

    if (-not (Test-Path -LiteralPath (Join-Path $Dir 'package.json'))) {
        Fail "No package.json in $Dir - not a 9router checkout"
    }

    if (-not (Test-Path -LiteralPath (Join-Path $Dir 'cli/package.json'))) {
        Fail "No cli/package.json in $Dir - not a 9router checkout"
    }
}

function Get-ForkVersion {
    param([string] $Dir)

    # Read the file directly - avoids spawning node just to parse one field.
    try {
        return (Get-Content -LiteralPath (Join-Path $Dir 'cli/package.json') -Raw |
            ConvertFrom-Json).version
    }
    catch {
        return '?'
    }
}

# ---- running instance ------------------------------------------------------

function Stop-RunningInstance {
    # Matches cli.js's own killAllAppProcesses whitelist: a node process whose
    # command line mentions 9router AND looks like the app (cli.js or a 9router
    # path). Keeps editors and greps that merely mention "9router" alive.
    $processes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine -match '9router' -and
            $_.CommandLine -match '(cli\.js|[\\/]9router)'
        }

    if (-not $processes) { return }

    Write-Step 'Stopping running 9router instances'

    foreach ($process in $processes) {
        Write-Host "    pid $($process.ProcessId)"

        try {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
        }
        catch {
            Write-Warn "could not stop pid $($process.ProcessId) - a stale file may block the install"
        }
    }
}

# ---- build + install -------------------------------------------------------

function Build-Package {
    param([string] $Dir)

    Write-Step 'Building (Next.js production build - this takes 5-10 min)'

    Push-Location $Dir

    try {
        # Out-Null: `npm run cli:pack` writes its notice/tarball listing to
        # stdout, and anything a function emits joins its return value. Without
        # this the caller receives a 298-element Object[] instead of the FileInfo
        # and `$tgz.FullName` throws.
        & npm run cli:pack | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail 'npm run cli:pack failed' }
    }
    finally {
        Pop-Location
    }

    $tgz = Get-ChildItem -LiteralPath $Dir -Filter '9router-*.tgz' -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if (-not $tgz) { Fail 'Build produced no 9router-*.tgz' }

    Test-FreshTarball -Tgz $tgz -Dir $Dir

    Write-Step "Built $($tgz.Name) ($([math]::Round($tgz.Length / 1MB, 2)) MB)"

    # -NoEnumerate: a bare `return $file` unrolls the FileInfo into its members
    # and the caller loses .FullName. Wrap it so the object survives the return.
    return ,$tgz
}

function Install-Globally {
    param([System.IO.FileInfo] $Tgz)

    Write-Step 'Removing the previous global install'

    # A dirty tree here is how a reinstall silently keeps stale files: npm
    # overwrites what it packages but never deletes what the last version left
    # behind. Clear it so what lands is exactly the tarball.
    & npm uninstall -g 9router *> $null

    if ($LASTEXITCODE -ne 0) { Write-Warn 'uninstall reported an error - continuing' }

    Write-Step 'Installing globally'

    & npm install -g $Tgz.FullName

    if ($LASTEXITCODE -ne 0) { Fail 'Global npm installation failed' }
}

function Initialize-SqliteRuntime {
    param([string] $Dir)

    # Normally done by the package's own postinstall. Re-run explicitly because
    # the global install dir's node_modules can stay incomplete, and dev mode
    # (`npm run dev`) never triggers a postinstall at all.
    $postinstall = Join-Path $Dir 'cli/hooks/postinstall.js'

    if (-not (Test-Path -LiteralPath $postinstall)) {
        Write-Warn 'postinstall.js not found - runtime warm-up skipped'
        return
    }

    Write-Step 'Warming the SQLite runtime (better-sqlite3 + sql.js)'

    & node $postinstall

    if ($LASTEXITCODE -ne 0) {
        Write-Warn 'runtime warm-up skipped - cli.js retries at runtime'
    }
}

function Get-InstalledVersion {
    try {
        $installed = (& npm ls -g 9router --depth=0 --json 2>$null | ConvertFrom-Json)
        return $installed.dependencies.'9router'.version
    }
    catch {
        return '?'
    }
}

function Show-Summary {
    param([string] $Version)

    Write-Step "Done. 9router@$Version installed from fork."

    Write-Host @'

    Start it:                        9router
    Dashboard:                       http://127.0.0.1:20128/dashboard
    Data (survives reinstall):       %APPDATA%\Roaming\9router
    After editing src/ or open-sse/: .\install.ps1

    Avoid `npm update -g 9router` - it replaces the fork with the upstream build.

'@ -ForegroundColor Gray
}

# ---- main ------------------------------------------------------------------

$TempCloneRoot = $null

try {
    Assert-Windows
    Assert-Tool -Name node
    Assert-Tool -Name npm
    Assert-NodeVersion

    $sourceDir = Resolve-SourceDir -Arg $Source
    Assert-Checkout -Dir $sourceDir

    Write-Step "Source: $sourceDir (v$(Get-ForkVersion -Dir $sourceDir))"

    if ($BuildOnly) {
        $only = Build-Package -Dir $sourceDir
        Write-Step "Build-only: $($only.FullName)"
        Write-Host ''
        Write-Host '    Nothing was stopped or installed.' -ForegroundColor Gray
        Write-Host ''
        return
    }

    if ($KeepRunning) {
        Write-Step 'Leaving running 9router instances alone (-KeepRunning)'
    }
    else {
        Stop-RunningInstance
    }

    $tgz = Build-Package -Dir $sourceDir
    Install-Globally -Tgz $tgz
    Initialize-SqliteRuntime -Dir $sourceDir

    Show-Summary -Version (Get-InstalledVersion)
}
finally {
    if ($TempCloneRoot -and (Test-Path -LiteralPath $TempCloneRoot)) {
        Remove-Item -LiteralPath $TempCloneRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
