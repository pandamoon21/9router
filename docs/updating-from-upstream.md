# Updating This Fork From Upstream (`decolua/9router`)

> **Audience:** an AI coding agent (or a human maintainer) tasked with merging a
> new upstream release into this fork **without losing the fork's patches**.
> **Scope:** every step is a real command you can run in this checkout.
> **Golden rule:** *never* run `npm update -g 9router` on a fork install — it
> silently replaces the fork with the upstream registry build.

> [!IMPORTANT]
> **Keep this guide in sync with the fork — it is a living document.**
> Whenever the maintainer adds a **new patch** (a new fork-only file, or a new
> modification to a file upstream also owns) that is **not yet listed in §2**,
> an AI agent MUST update this guide **in the same commit / PR as that patch**.
> Concretely, for every new `FORK_PATCH`:
> 0. **Append a dated entry to `CHANGELOG.md`** under the
>    `# Fork changes (pandamoon21)` section (top of the file), in the fork's
>    existing style: `## YYYY-MM-DD — <short title>`, then *what changed* and
>    *why*. This is the user-visible record (the dashboard changelog is pointed
>    at the fork — see §5.5), so it MUST land **in the same commit as the
>    patch**, never "later". Follow the fork convention: patch commits are
>    `fix(...)`/`feat(...)`, and the CHANGELOG entry describes the same change.
> 1. Add the file to the **Category A** (modified-in-place) or **Category B**
>    (fork-only) table in §2, with a one-line intent.
> 2. If the patch has a merge-fragile invariant, add a resolution rule to
>    **§5** and a re-check line to **§6**.
> 3. If it changes the update lifecycle (installer, version detection,
>    changelog, telemetry, model catalogs), update **§5.5–§5.7**, **§7**, or
>    **§10** accordingly.
> 4. Refresh any stale facts: version numbers, "latest upstream merged",
>    ahead/behind counts, and commit hashes.
> 5. Add a **troubleshooting row (§11)** for any new failure mode the patch
>    guards against.
> Detect drift at any time with the audit snippet in §13.

---

## 1. Repo topology (read this first)

| Remote | URL | Role |
|---|---|---|
| `origin` | `https://github.com/pandamoon21/9router.git` | **This fork** (push here) |
| `upstream` | `https://github.com/decolua/9router.git` | Read-only source of truth |

- Working branch: **`master`** (tracks `origin/master`).
- Version lives in **two** places and must stay in sync: root `package.json`
  `"version"` and `cli/package.json` `"version"`. Today both read `0.5.95`.
- The fork's changes are recorded as *normal commits on `master`* plus merge
  commits from `upstream/master`. There is **no rebase workflow** — fork patches
  keep their original commit ids so old merges never need replaying.
- Last upstream merged: **v0.5.95** (`a99cf572`). The fork is currently
  `47` commits ahead of and `0` behind `upstream/master`.

Verify all of the above at any time:

```bash
git remote -v
git rev-parse --abbrev-ref HEAD            # master
git rev-list --left-right --count upstream/master...HEAD   # -> "0    47"
grep '"version"' package.json cli/package.json
```

### Notation used below

- `FORK_PATCH` — a change this fork makes on top of upstream.
- `UPSTREAM` — a change coming from `decolua/9router`.
- `BASE` — the commit where the fork last merged upstream (`git merge-base
  upstream/master HEAD`).

---

## 2. The fork's patch surface (what must survive every merge)

Two categories. Category **A** is the real risk surface (upstream also edits
those files). Category **B** is much safer (upstream never touches them, so
merges are almost always clean).

### A. Modified-in-place files — conflicts are *expected* here

| File(s) | `FORK_PATCH` intent |
|---|---|
| `open-sse/executors/kiro.js` | kiro-cli **wire parity**: body shape, event integrity, tool-call retry on truncated/never-arrived input |
| `open-sse/config/kiroConstants.js` | Per-model **effort enums** read from the live catalog; `xhigh` dropped only on the 4.6 generation |
| `open-sse/services/kiroModels.js` | Kiro model catalog + effort contract |
| `open-sse/translator/request/claude-to-kiro.js`<br>`open-sse/translator/request/openai-to-kiro.js` | Translate to the real kiro-cli request body (system prompt placement, no top-level `model`) |
| `open-sse/providers/registry/kiro.js` | Kiro registry fingerprint / auth surfaces |
| `open-sse/handlers/chatCore.js` | Do **not** add a top-level `model` field to the Kiro body |
| `open-sse/handlers/chatCore/streamingHandler.js` | Streaming-shape fix tied to the above |
| `open-sse/executors/codebuddy-cn.js`<br>`open-sse/executors/codebuddy-intl.js` | CodeBuddy CLI **fingerprint** headers + WAF-safe requests |
| `open-sse/providers/registry/codebuddy-cn.js`<br>`open-sse/providers/registry/codebuddy-intl.js` | CodeBuddy model catalogs (regenerated, see §7) |
| `open-sse/services/tokenRefresh.js`<br>`open-sse/services/tokenRefresh/providers.js` | Pass the **whole credential object** to CodeBuddy refresh (needs `accessToken` + `X-User-Id`) |
| `src/sse/handlers/chat.js` | Fire-and-forget CodeBuddy device-fingerprint + lifecycle **telemetry** |
| `src/shared/components/Sidebar.js` | Update banner says "**Upstream vX available — this install is a fork**" |
| `src/shared/constants/config.js` | Changelog URL points at **this fork**, not `decolua` |
| `CHANGELOG.md` | **Fork changes** section pinned above upstream release notes |
| `Dockerfile` | Drop the C++ toolchain; leaner reproducible image |
| `cli/scripts/build-cli.js` | Portable package-size walk (no `du -sh`, which breaks Windows) |
| `.env.example`, `.gitignore` | Fork-only knobs (`CODEBUDDY_CN_AGENT_FILTER`) + ignored scratch |
| `tests/**` | Fork regression tests (see §8) |

### B. Fork-only new files — safe, never edited by upstream

These are **added** by the fork. A merge should never conflict on them; if one
ever does, keep the fork's version.

```
.github/ (workflows, if any fork-local)      open-sse/services/codebuddy/identity.js
.gitattributes                               open-sse/services/codebuddy/index.js
docs/refreshing-codebuddy-models.md          open-sse/services/codebuddy/telemetry.js
docs/codebuddy-cn-system-prompt-results.md   open-sse/translator/concerns/kiroClientParity.js
docs/updating-from-upstream.md   (this file)  open-sse/utils/codebuddyToolSanitize.js
install.sh                                   open-sse/utils/enforceResponseFormat.js
install.ps1                                  scripts/refresh-codebuddy-models.mjs
scripts/verify-codebuddy-tools.mjs           scripts/_regen-known-fails.mjs
tests/translator/kiro-cli-parity-*.test.js   tests/unit/codebuddy-*.test.js
tests/unit/kiro-no-top-level-model.test.js
```

Quickly regenerate these two lists yourself:

```bash
# Category A (modified in place)
git diff --name-status --diff-filter=M upstream/master...HEAD
# Category B (fork-only additions)
git diff --name-status --diff-filter=A upstream/master...HEAD
```

---

## 3. Fast lane (use this when the merge is clean)

For a routine update where you don't expect behavioral collisions:

```bash
# 0. Clean tree on latest fork master
git checkout master
git status --porcelain            # must be empty; commit or stash first
git pull --ff-only origin master

# 1. Snapshot the current (known-good) fork BEFORE merging
STAMP=$(date +%Y%m%d)
git branch "backup/pre-upstream-v<NEW_VERSION>-$STAMP" HEAD
git push -u origin "backup/pre-upstream-v<NEW_VERSION>-$STAMP"

# 2. Fetch all upstream refs and tags
git fetch upstream --tags --prune

# 3. See what is inbound
git log --oneline --no-merges HEAD..upstream/master
git diff --stat HEAD..upstream/master

# 4. Merge (merge, never rebase — see §4)
git merge upstream/master -m "Merge remote-tracking branch 'upstream/master' (v<NEW_VERSION>)"

# 5. Resolve conflicts (§5), then verify (§6) and gate (§8), then push
git push origin master
```

---

## 4. Merge policy — why merge, not rebase

- **Never rebase `master`.** Rebasing rewrites the fork commits that have
  already been merged from `upstream/master`, forcing a re-conflict of every
  prior release and breaking `origin/master` for anyone who has pulled.
- **Never `git pull upstream master`** (merge is fine, but you lose control of
  the message). Use `git fetch` + `git merge` so you can inspect first.
- Prefer a **single merge commit per upstream release**. The fork's history shows
  exactly this pattern (`v0.5.65`, `v0.5.69`, `v0.5.75`, `v0.5.81`, `v0.5.85`,
  `v0.5.91`, `v0.5.95`).
- Enable **rerere** once per clone so repeated conflict resolutions are reused:

  ```bash
  git config rerere.enabled true
  git config rerere.autoupdate true
  ```

---

## 5. Conflict playbook (the important part)

Run `git status` to list conflicted paths, then work **file by file**. Do not
accept `-X ours`/`-X theirs` wholesale — both lose changes silently.

### 5.1 `CHANGELOG.md` — the guaranteed conflict

Both sides edit the top of the file. Resolution rule:

1. Keep the fork's `# Fork changes (pandamoon21)` section **at the very top**.
2. Update its header line to the new version:
   `Latest upstream merged: **v<NEW_VERSION>** (<date>)`.
3. Add a new dated entry under it describing the merge outcome.
4. Place upstream's own release notes **below** the fork section, exactly as
   upstream wrote them.

### 5.2 `open-sse/config/kiroConstants.js` — the subtle one

Fork and upstream have historically fixed the *same* per-model effort problem
two different ways. Precedent from the v0.5.95 merge:

> Keep **upstream's newer structure** (e.g. `parseClaudeVersion`, which covers
> newly added models), then **re-apply the fork's captured-enum contract on
> top**: the `KIRO_CLAUDE_EFFORT_LEVELS` / `KIRO_GPT_EFFORT_LEVELS` constants,
> forward GPT `none`/`max` as real wire values, and drop `xhigh` **only** when
> the model is provably 4.6 (leave `xhigh` intact for unknown ids).

Do not blindly keep "ours": upstream's structure usually generalizes to models
the fork didn't know about yet.

### 5.3 `open-sse/executors/kiro.js` and the kiro translators

The fork asserts kiro-cli **wire parity**. Upstream may add new providers/models
in the same functions. Resolution rule: **re-apply the fork's invariant on top
of upstream's new code.**

Non-negotiable fork invariants (from `docs/` + tests):

- The Kiro wire body is exactly `{ conversationState, profileArn }`; the model
  travels in `conversationState.currentMessage.userInputMessage.modelId`.
  **No top-level `model`** — `chatCore.js` must keep the fork's Kiro exclusion.
- Never invent event types; tolerate unknown ones.
- A tool call **whose input never arrived** must be *retried*, not dropped
  (the truncation flag is `inputKind !== "object"`, i.e. only a finished object
  is exempt).

`open-sse/translator/concerns/kiroClientParity.js` documents the shared
contract; keep it as the single source of truth when reconciling.

### 5.4 `open-sse/services/tokenRefresh*` for CodeBuddy

The fork's refresh functions take the **whole credential object**
(`refreshCodebuddyToken(credentials, log)`), not a bare `refreshToken` string,
because the refresh needs `accessToken` (Authorization) and `X-User-Id`.
If upstream changed these signatures, keep the fork's object-based signature and
adapt upstream's body logic around it. Also keep the `extractCodebuddyUid`
import.

### 5.5 `src/shared/components/Sidebar.js` and `src/shared/constants/config.js`

Upstream versions of these files may reintroduce an "update to vX" banner and a
`decolua` changelog URL. **Restore the fork intent:**

- Banner text must warn that this is a fork and that the button installs the
  **upstream** package (which drops fork patches).
- `changelogUrl` must point at `pandamoon21/9router`, not `decolua/9router`.

### 5.6 `Dockerfile`, `install.sh`, `install.ps1`, `cli/scripts/build-cli.js`

Keep the fork's versions of these files (lean image, fork installers, portable
size walk). If upstream refactored the same file, port the fork's *behavior*
into upstream's new structure rather than reverting upstream's improvements.

### 5.7 Unknown conflicts outside the table

Default resolution order:

1. If the path is fork-only (§2 B) → **keep ours**.
2. If it is a pure `tests/**` baseline file → **take upstream**, then regenerate
   (§8).
3. Otherwise → read both sides, understand both intents, and produce a **union**
   (upstream feature + fork invariant). Never resolve a source file by dropping
   one side without a note in the merge message.

### 5.8 After resolving

```bash
git add -A
git status                 # ensure no "Unmerged paths" remain
git diff --cached --check  # catch leftover conflict markers / whitespace
git commit                 # completes the merge; body becomes the merge message
```

Then **write a real merge message** documenting, per file: which side won and
why (the v0.5.95 merge message is the template — conflict list + rationale +
post-merge contract updates).

---

## 6. Post-merge content fixes (upstream changes behavior on purpose)

A clean merge does **not** mean the fork is correct. After merging, re-assert
the fork invariants that upstream may have "helpfully" changed:

- **Kiro body:** confirm `open-sse/handlers/chatCore.js` still excludes Kiro from
  the blanket `translatedBody.model = stripThinkingSuffix(upstreamModel)`.
- **Effort enums:** confirm `open-sse/config/kiroConstants.js` still carries the
  fork's enum contract on top of upstream's parser.
- **CodeBuddy refresh/telemetry:** confirm the object-based refresh signature and
  that `src/sse/handlers/chat.js` still fires pre/post-chat telemetry.
- **Changelog URL:** confirm `src/shared/constants/config.js` still points at the
  fork.
- **Version bump:** if the merge brought a new upstream version, update
  `CHANGELOG.md`'s "Latest upstream merged" line. Do **not** set the fork's
  `package.json` version to a version that doesn't exist upstream — keep it equal
  to the merged upstream version unless deliberately diverging.

---

## 7. Regenerating CodeBuddy model catalogs (drift-prone `FORK_PATCH`)

CodeBuddy catalogs drift constantly. Full instructions live in
`docs/refreshing-codebuddy-models.md`; the short version (from repo root):

```bash
node scripts/refresh-codebuddy-models.mjs                    # dry-run, codebuddy-cn
node scripts/refresh-codebuddy-models.mjs --provider=intl    # dry-run, codebuddy-intl
node scripts/refresh-codebuddy-models.mjs --write            # apply to registry
node scripts/refresh-codebuddy-models.mjs --provider=intl --write
```

The script reads a live credential from the local 9router SQLite DB (or a
`--token=<jwt>` flag) and rewrites only the `models: […]` block in
`open-sse/providers/registry/codebuddy-*.js`. Run it after any merge that
touched the CodeBuddy registry or executor paths, then re-run the CodeBuddy
tests (§8).

---

## 8. Verification & regression gate (do not skip)

The generic test suite is **not** expected to be green on a plain checkout.
Regressions are judged against a committed allowlist, not a raw run.

```bash
# Root deps first (tests import from src/), then the tests package
npm install
cd tests && npm install && cd ..

# Run the suite, capturing JSON for the gate
mkdir -p _probe_out
cd tests && npx vitest run --reporter=json --outputFile=../_probe_out/current-results.json ; cd ..

# Gate: fails that are NOT in the allowlist = a real regression
node tests/__baseline__/verify-no-regression.mjs _probe_out/current-results.json \
  && echo "GATE PASS" || echo "GATE FAIL"
```

Rules:

- `tests/__baseline__/known-fails.txt` is the allowlist. A test that **passes in
  the baseline and fails now** is a **regression** → fix it before pushing.
- On a *pure upstream* merge, prefer **taking upstream's** baseline files
  (`tests/__baseline__/*`, snapshots) and only re-adding fork entries you truly
  own.
- When the merge legitimately changes expected failures, refresh the allowlist
  from the captured JSON report (positional args: `<results.json> <out.txt>`):

  ```bash
  # regenerate tests/__baseline__/known-fails.txt from the last vitest run
  node scripts/_regen-known-fails.mjs _probe_out/current-results.json
  # or, using the script's defaults (reads tests/__baseline__/current.json)
  node scripts/_regen-known-fails.mjs
  ```

  Then re-run the gate in §8 to confirm it now reports all-known.

- `tests/__baseline__/providers-baseline.json` and the alias/OAuth baselines
  compare committed snapshots — run them after touching any
  `open-sse/providers/registry/*`.

Targeted checks for this fork's risk areas:

```bash
cd tests
npx vitest run translator/kiro-cli-parity-*.test.js
npx vitest run unit/kiro-no-top-level-model.test.js unit/openai-to-kiro.test.js
npx vitest run unit/codebuddy-*.test.js
npx vitest run translator/claude-kiro-direct.test.js translator/golden-request.test.js
```

---

## 9. Build & install sanity check

Pick the runner that matches how Node is on *your* PATH — the two shell
families have different environments on Windows:

```bash
# --- Windows (PowerShell) — PREFERRED on Windows; Node is on the Windows PATH ---
powershell -NoProfile -ExecutionPolicy Bypass -File ./install.ps1 -BuildOnly

# --- Linux / macOS — native bash, Node on PATH ---
./install.sh --build-only

# --- Windows via Git Bash: bash resolves to WSL2 here, which usually has NO
#     `node` on PATH → "./install.sh --build-only" fails with "node not found".
#     Either use install.ps1 above, or add Node to WSL and then: ---
bash ./install.sh --build-only

# Full fork install (stops running instances, installs the fork build):
./install.sh                 # Linux/macOS   |   .\install.ps1   # Windows
./install.sh --keep-running  # if you don't want it stopped
./install.sh pandamoon21/9router   # clone + build from the fork remote
```

- **Never** `npm update -g 9router` — it replaces the fork with upstream.
- Windows: `.ps1` is CRLF, `.sh` must stay LF (enforced by `.gitattributes`).
- **`./install.sh` on Windows is a trap:** this shell's `bash` may be WSL2
  (`uname -a` → `microsoft-standard-WSL2`), which does **not** inherit the
  Windows `node`. Symptom: exit 126 *"not a valid Win32 application"* (shell
  can't exec the shebang) or *"node not found in PATH"* (WSL missing Node). Use
  `install.ps1` on Windows; use `install.sh` only where `node -v` works in that
  same shell.
- `-BuildOnly` / `--build-only` builds the tarball and stops — nothing is
  installed or stopped. Ideal for CI and for verifying a merge without touching
  a running instance.

---

## 10. Release checklist (copy/paste)

- [ ] `git status --porcelain` is empty on `master`; `git pull --ff-only origin master`.
- [ ] Backup branch `backup/pre-upstream-v<X>-<date>` created **and pushed**.
- [ ] `git fetch upstream --tags --prune`; reviewed `HEAD..upstream/master`.
- [ ] Merged with `git merge upstream/master` (no rebase, no `-X ours/theirs`).
- [ ] Resolved conflicts per §5; each resolution justified in the merge message.
- [ ] Re-asserted invariants per §6 (Kiro body, effort enums, telemetry, changelog URL).
- [ ] CodeBuddy catalogs refreshed if their paths changed (§7).
- [ ] `CHANGELOG.md`: fork section on top, `Latest upstream merged` updated.
- [ ] Versions in `package.json` and `cli/package.json` agree.
- [ ] `verify-no-regression.mjs` says **GATE PASS** (§8).
- [ ] `./install.sh --build-only` builds cleanly (§9).
- [ ] `git push origin master` and push the backup branch.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Error: Your local changes would be overwritten` | dirty tree | `git stash` or commit before merging |
| Conflict markers left in a file | incomplete resolve | `grep -rn '<<<<<<<\|>>>>>>>' <file>`; re-edit; `git add` |
| Kiro requests gain a top-level `model` | `chatCore.js` invariant lost | re-apply §6 exclusion |
| CodeBuddy returns HTTP 400 `code 11128` | agent-identity filter disabled/removed | confirm the filter is on: `open-sse/executors/codebuddy-cn.js` sets `FILTER_ENABLED = process.env.CODEBUDDY_CN_AGENT_FILTER !== "0"` (defaults ON) and calls `open-sse/services/codebuddy/identity.js` to neutralize branded prompts |
| Tool call `Write` silently never happens on Kiro | never-arrived input dropped instead of retried | restore the `inputKind !== "object"` truncation rule (§5.3) |
| Tests "all red" after merge | judging by raw run | run the gate `verify-no-regression.mjs` instead |
| `git merge upstream/master` says **"Already up to date."** | upstream has no commits newer than the last merged release — nothing to do | this is a valid no-op; confirm with `git rev-list --count HEAD..upstream/master` (expect `0`) and stop. Do **not** fabricate a merge |
| `./install.sh` → exit 126 / "not a valid Win32 application" | Windows shell cannot execute a shebang script directly | run it through bash: `bash ./install.sh --build-only` (Git Bash / WSL), or use `.\install.ps1` on Windows |
| `git fetch upstream --tags --prune` prints nothing | already fetched; refs unchanged | verify with `git rev-parse upstream/master` vs the last merged hash |
| `du: command not found` during CLI build | old `build-cli.js` restored | keep the fork's portable `directorySize` walk |
| Dashboard shows "update to vX" and installs upstream | `Sidebar.js`/`config.js` fork patch lost | re-apply §5.5 |

---

## 12. Reference

- Merge history: `git log --oneline --merges upstream/master..HEAD`
- Fork-only commits: `git log --oneline upstream/master..HEAD`
- Full fork diff: `git diff --stat upstream/master...HEAD`
- Architecture: `docs/ARCHITECTURE.md`
- Fork conventions for the engine: `open-sse/AGENTS.md`
- Agent/contributor guide: `CLAUDE.md`
- CodeBuddy catalog refresh: `docs/refreshing-codebuddy-models.md`
- CodeBuddy CN WAF investigation: `docs/codebuddy-cn-system-prompt-results.md`

---

## 13. Keeping this guide current (drift audit)

This guide is only useful if §2 stays complete. Run this audit **before every
upstream merge** — and **immediately after adding any new fork patch** — to find
patches that are not yet documented here.

```bash
# 1. Enumerate the current fork surface (ground truth)
mkdir -p _probe_out
git diff --name-only --diff-filter=M upstream/master...HEAD > _probe_out/fork-modified.txt
git diff --name-only --diff-filter=A upstream/master...HEAD > _probe_out/fork-added.txt
cat _probe_out/fork-modified.txt _probe_out/fork-added.txt | sort -u > _probe_out/fork-all.txt

# 2. Report which fork files are NOT covered by this guide.
#    "Covered" = the exact path appears in the doc, OR a category pattern in §2
#    covers it (tests/**, scripts/, docs/, install.*, .env.example, .gitignore,
#    .gitattributes, CHANGELOG.md, Dockerfile, CLAUDE.md, open-sse/** rules).
#    Anything printed below is a candidate for §2.
python - docs/updating-from-upstream.md _probe_out/fork-all.txt <<'PY'
import re, sys
doc = open(sys.argv[1], encoding="utf-8").read()
paths = [l.strip() for l in open(sys.argv[2], encoding="utf-8") if l.strip()]

# Category-level patterns already described in §2 / §5 (globs + dir prefixes).
covered_patterns = [
    r"^tests/", r"^scripts/", r"^docs/", r"^install\.(sh|ps1)$",
    r"^\.env\.example$", r"^\.gitignore$", r"^\.gitattributes$",
    r"^CHANGELOG\.md$", r"^Dockerfile$", r"^CLAUDE\.md$",
    r"^cli/scripts/", r"^open-sse/(executors|config|services|handlers|providers|translator)/",
    r"^src/(sse|shared)/",
]
def covered(p):
    return p in doc or any(re.search(pat, p) for pat in covered_patterns)

drift = [p for p in paths if not covered(p)]
print("No drift — guide is complete." if not drift else "UNDOCUMENTED (add to §2):")
for p in drift:
    print("  -", p)
PY
```

> The §2 tables intentionally describe fork areas **by directory pattern** (e.g.
> `tests/**`, `scripts/`), so per-file test additions do not each need a row.
> The audit's `covered_patterns` list encodes exactly which prefixes/globs are
> already handled — extend it whenever you add a new category row to §2.

Agent checklist when drift is found (do **not** leave it for later):

- [ ] **`CHANGELOG.md` has a dated fork entry** for the new patch (top section),
      added in the **same commit** as the patch — not retroactively.
- [ ] Every undocumented file is added to §2 (Category **A** or **B**) with intent.
- [ ] Fragile invariants get a §5 conflict rule **and** a §6 post-merge re-check.
- [ ] New failure modes get a §11 troubleshooting row.
- [ ] §10 release checklist still covers the patch's install/verify path.
- [ ] Stale facts refreshed: `package.json`/`cli/package.json` version,
      "latest upstream merged", ahead/behind counts, commit hashes.

Quick CHANGELOG check (does every recent fork patch have an entry?):

```bash
# Fork commits that are NOT upstream merges, newest first
git log --oneline --no-merges upstream/master..HEAD | head -20
# Entries at the top of the fork section
sed -n '1,60p' CHANGELOG.md | grep -n '^## '
# Rule of thumb: a patch without a matching `## <date> — <title>` entry above
# the first upstream release note is a MISSING changelog entry.
```

> **Rule of thumb:** a fork patch that is *not* written down in this guide is a
> patch the next merge is allowed to lose. Document it in the same commit that
> introduces it.
