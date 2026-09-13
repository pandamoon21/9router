#!/usr/bin/env bash
# Build 9router from a fork and install it globally.
#
#   ./install.sh                          build from this checkout
#   ./install.sh ~/src/9router            build from another checkout
#   ./install.sh owner/repo               clone https://github.com/owner/repo
#   ./install.sh https://host/repo.git    clone it
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

fork_version() {
    local dir="$1"

    # Read the file directly - no need to spawn node to parse one field.
    node -e 'try{process.stdout.write(require(process.argv[1]).version)}catch{process.stdout.write("?")}' \
        "$dir/cli/package.json" 2>/dev/null || printf '?'
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
    local tgz
    tgz="$(ls -t "$dir"/9router-*.tgz 2>/dev/null | head -1)"

    [ -n "$tgz" ] || fail 'Build produced no 9router-*.tgz'

    local size
    size="$(du -h "$tgz" | cut -f1)"

    step "Built $(basename "$tgz") ($size)" >&2

    printf '%s' "$tgz"
}

install_globally() {
    local tgz="$1"

    step 'Installing globally (--force: npm refuses same/lower version without it)'

    npm install -g "$tgz" --force >&2 || fail 'Global npm installation failed'
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
    assert_tool node
    assert_tool npm
    assert_node_version

    SOURCE_DIR="$(resolve_source_dir "${1:-}")"
    assert_checkout "$SOURCE_DIR"

    step "Source: $SOURCE_DIR (v$(fork_version "$SOURCE_DIR"))"

    stop_running_instance

    local tgz
    tgz="$(build_package "$SOURCE_DIR")"

    install_globally "$tgz"
    init_sqlite_runtime "$SOURCE_DIR"

    show_summary "$(installed_version)"
}

main "$@"
