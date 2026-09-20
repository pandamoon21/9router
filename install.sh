#!/usr/bin/env bash
# Build 9router from a fork and install it globally.
#
#   ./install.sh                          build from this checkout
#   ./install.sh ~/src/9router            build from another checkout
#   ./install.sh owner/repo               clone https://github.com/owner/repo
#   ./install.sh https://host/repo.git    clone it
#   ./install.sh --build-only             build the tarball and stop
#   ./install.sh --keep-running           do not stop running instances
#
# The published `9router` npm package is the launcher plus a *prebuilt* copy of
# the dashboard. Neither `npm install -g 9router` nor `npm update -g 9router`
# can point at a fork - they always fetch the upstream registry build. This
# script builds the tarball from a fork and installs that instead.
#
# Never use `npm update -g 9router` on a fork install; it silently replaces the
# fork with the upstream build. Re-run this script instead.

set -euo pipefail

DEFAULT_REPO_URL="https://github.com/pandamoon21/9router.git"

TEMP_CLONE_ROOT=""
SOURCE_DIR=""
BUILD_ONLY=0
KEEP_RUNNING=0

# ---- output helpers --------------------------------------------------------

step() { printf '\n==> %s\n' "$*" >&2; }
warn() { printf '    %s\n' "$*" >&2; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

cleanup() {
    [ -n "$TEMP_CLONE_ROOT" ] && rm -rf "$TEMP_CLONE_ROOT"
}
trap cleanup EXIT

# ---- preflight -------------------------------------------------------------

assert_tool() {
    command -v "$1" >/dev/null 2>&1 || fail "$1 not found in PATH${2:+ ($2)}"
}

assert_node_version() {
    local version major
    version="$(node -p 'process.versions.node')"
    major="${version%%.*}"

    [ "$major" -ge 18 ] || fail "Node >= 18 required (have $version)"
}

# ---- source resolution -----------------------------------------------------

clone_repo() {
    local arg="$1" url

    case "$arg" in
        *://*|*@*:*) url="$arg" ;;
        */*)         url="https://github.com/${arg%.git}.git" ;;
        *)           url="$DEFAULT_REPO_URL" ;;
    esac

    assert_tool git "needed to clone $url"

    TEMP_CLONE_ROOT="$(mktemp -d)"

    step "Cloning $url"

    git clone --depth 1 "$url" "$TEMP_CLONE_ROOT/repo" >&2

    printf '%s' "$TEMP_CLONE_ROOT/repo"
}

resolve_source_dir() {
    local arg="${1:-}"

    if [ -z "$arg" ]; then
        cd "$(dirname "${BASH_SOURCE[0]}")" && pwd
        return
    fi

    if [ -d "$arg" ]; then
        (cd "$arg" && pwd)
        return
    fi

    clone_repo "$arg"
}

assert_checkout() {
    local dir="$1"

    [ -f "$dir/package.json" ]     || fail "No package.json in $dir - not a 9router checkout"
    [ -f "$dir/cli/package.json" ] || fail "No cli/package.json in $dir - not a 9router checkout"
}

# package-lock.json is gitignored (upstream decolua, fb5be37e), so a fresh clone
# has none. Without it the Docker build re-solves the whole dependency tree on
# every package.json change — measured at 354s of a 734s build on a 2-core box.
# Generate it once here; it is a local artifact and stays out of git.
ensure_lockfile() {
    local dir="$1"

    [ -f "$dir/package-lock.json" ] && return 0

    step 'Generating package-lock.json (first run only)'
    ( cd "$dir" && npm install --package-lock-only --no-audit --no-fund ) >&2 ||
        warn 'could not generate a lockfile - the Docker build will solve from scratch'
}

# cli/node_modules is never installed by any script: `cli:pack` runs
# `npm --prefix cli run pack:cli`, and esbuild lives in cli/devDependencies. On a
# fresh clone the build dies at the MITM step with "Cannot find module 'esbuild'".
ensure_cli_deps() {
    local dir="$1"

    [ -x "$dir/cli/node_modules/.bin/esbuild" ] && return 0

    step 'Installing cli/ dependencies (esbuild is needed for the MITM build)'
    ( cd "$dir" && npm --prefix cli install --no-audit --no-fund ) >&2 ||
        fail 'npm --prefix cli install failed'
}

fork_version() {
    local dir="$1"

    # Read the file directly - no need to spawn node to parse one field.
    node -e 'try{process.stdout.write(require(process.argv[1]).version)}catch{process.stdout.write("?")}' \
        "$dir/cli/package.json" 2>/dev/null || printf '?'
}

# ---- stale-build detection -------------------------------------------------

newest_source_mtime() {
    local dir="$1"

    # Only the trees that actually feed the bundle. mtimes survive the copy into
    # cli/app, so a tarball built before the last source edit is stale.
    #
    # Portable: `stat -f` is BSD/macOS, `stat -c` is GNU; `find -newer` is not
    # usable here because we need a timestamp, not a comparison.
    local path m newest=0
    while IFS= read -r path; do
        [ -n "$path" ] || continue
        if m="$(stat -c %Y "$path" 2>/dev/null)"; then
            :
        elif m="$(stat -f %m "$path" 2>/dev/null)"; then
            :
        else
            continue
        fi
        [ "$m" -gt "$newest" ] && newest="$m"
    done < <(find "$dir/src" "$dir/open-sse" "$dir/cli" \
                 -type f -not -path '*/node_modules/*' 2>/dev/null)

    printf '%s' "$newest"
}

assert_fresh_tarball() {
    local tgz="$1" dir="$2"
    local newest_src tgz_m

    newest_src="$(newest_source_mtime "$dir")"
    [ "$newest_src" -gt 0 ] || return 0

    if tgz_m="$(stat -c %Y "$tgz" 2>/dev/null)"; then
        :
    else
        tgz_m="$(stat -f %m "$tgz" 2>/dev/null || printf 0)"
    fi

    if [ "$tgz_m" -lt "$newest_src" ]; then
        fail "Build produced a tarball older than the source tree.

    tarball: $(basename "$tgz")  $tgz_m
    source:  $newest_src

That means npm pack reused an existing package or the build did not run.
Delete the stale tarball and re-run:
    rm $dir/9router-*.tgz"
    fi
}

# ---- running instance ------------------------------------------------------

stop_running_instance() {
    local pids

    if command -v taskkill >/dev/null 2>&1; then
        # Matches cli.js's own killAllAppProcesses whitelist: a node process
        # whose command line mentions 9router AND looks like the app (cli.js or
        # a 9router path). Keeps editors and greps that merely mention it alive.
        pids="$(powershell -NoProfile -Command \
            "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |" \
            "Where-Object { \$_.CommandLine -match '9router' -and \$_.CommandLine -match '(cli\.js|[\\\\/]9router)' } |" \
            "Select-Object -ExpandProperty ProcessId" 2>/dev/null || true)"
    elif command -v pgrep >/dev/null 2>&1; then
        pids="$(pgrep -f '9router.*(cli\.js|/9router)' 2>/dev/null || true)"
    else
        warn 'no taskkill/pgrep - cannot stop a running instance; a stale file may block the install'
        return
    fi

    [ -n "$pids" ] || return

    step 'Stopping running 9router instances'

    local pid
    for pid in $pids; do
        printf '    pid %s\n' "$pid" >&2

        if command -v taskkill >/dev/null 2>&1; then
            # // = escape PowerShell arg parsing so taskkill sees /F /T /PID
            taskkill //F //T //PID "$pid" >/dev/null 2>&1 ||
                warn "could not stop pid $pid - a stale file may block the install"
        else
            kill -9 "$pid" 2>/dev/null ||
                warn "could not stop pid $pid - a stale file may block the install"
        fi
    done
}

# ---- build + install -------------------------------------------------------

build_package() {
    local dir="$1"

    step 'Building (Next.js production build - this takes 5-10 min)'

    ( cd "$dir" && npm run cli:pack ) >&2 || fail 'npm run cli:pack failed'

    # Newest tarball - output is on stdout so the caller can capture it.
    # Nothing else in this function may write to stdout or it joins the path.
    local tgz
    tgz="$(ls -t "$dir"/9router-*.tgz 2>/dev/null | head -1)"

    [ -n "$tgz" ] || fail 'Build produced no 9router-*.tgz'

    assert_fresh_tarball "$tgz" "$dir"

    local size
    size="$(du -h "$tgz" | cut -f1)"

    step "Built $(basename "$tgz") ($size)" >&2

    printf '%s' "$tgz"
}

install_globally() {
    local tgz="$1"

    step 'Removing the previous global install'

    # A dirty tree here is how a reinstall silently keeps stale files: npm
    # overwrites what it packages but never deletes what the last version left
    # behind. Clear it so what lands is exactly the tarball.
    npm uninstall -g 9router >/dev/null 2>&1 || warn 'uninstall reported an error - continuing'

    step 'Installing globally'

    npm install -g "$tgz" >&2 || fail 'Global npm installation failed'
}

init_sqlite_runtime() {
    local dir="$1" postinstall="$dir/cli/hooks/postinstall.js"

    # Normally done by the package's own postinstall. Re-run explicitly because
    # the global install dir's node_modules can stay incomplete, and dev mode
    # (`npm run dev`) never triggers a postinstall at all.
    if [ ! -f "$postinstall" ]; then
        warn 'postinstall.js not found - runtime warm-up skipped'
        return
    fi

    step 'Warming the SQLite runtime (better-sqlite3 + sql.js)'

    node "$postinstall" >&2 || warn 'runtime warm-up skipped - cli.js retries at runtime'
}

installed_version() {
    npm ls -g 9router --depth=0 --json 2>/dev/null |
        node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).dependencies["9router"].version)}catch{process.stdout.write("?")}})' \
        2>/dev/null || printf '?'
}

show_summary() {
    local version="$1"

    step "Done. 9router@$version installed from fork."

    cat >&2 <<'EOF'

    Start it:                        9router
    Dashboard:                       http://127.0.0.1:20128/dashboard
    Data (survives reinstall):       ~/.9router  (Linux/macOS)
    After editing src/ or open-sse/: ./install.sh

    Avoid `npm update -g 9router` - it replaces the fork with the upstream build.

EOF
}

# ---- main ------------------------------------------------------------------

main() {
    local arg=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --build-only)   BUILD_ONLY=1 ;;
            --keep-running) KEEP_RUNNING=1 ;;
            -*)             fail "unknown option: $1" ;;
            *)              arg="$1" ;;
        esac
        shift
    done

    assert_tool node
    assert_tool npm
    assert_node_version

    SOURCE_DIR="$(resolve_source_dir "$arg")"
    assert_checkout "$SOURCE_DIR"

    step "Source: $SOURCE_DIR (v$(fork_version "$SOURCE_DIR"))"

    ensure_cli_deps "$SOURCE_DIR"
    ensure_lockfile "$SOURCE_DIR"

    if [ "$BUILD_ONLY" -eq 1 ]; then
        local only
        only="$(build_package "$SOURCE_DIR")"
        step "Build-only: $only"
        printf '\n    Nothing was stopped or installed.\n\n' >&2
        return
    fi

    if [ "$KEEP_RUNNING" -eq 1 ]; then
        step 'Leaving running 9router instances alone (--keep-running)'
    else
        stop_running_instance
    fi

    local tgz
    tgz="$(build_package "$SOURCE_DIR")"

    install_globally "$tgz"
    init_sqlite_runtime "$SOURCE_DIR"

    show_summary "$(installed_version)"
}

main "$@"
