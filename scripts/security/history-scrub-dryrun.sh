#!/bin/sh
#
# history-scrub-dryrun.sh — DRY-RUN history scrub for the 2026-10 credential exposure.
#
# Implements: docs/security/credential-exposure-2026-10.md (findings F-01..F-04)
# Companion:  docs/security/TURSO-ROTATION-RUNBOOK.md §6
#
# SAFETY CONTRACT
#   1. DRY RUN BY DEFAULT. Without --execute this script only PRINTS what it would
#      do. It never mutates the repository.
#   2. --execute still requires an exact typed confirmation string.
#   3. Nothing is deleted from disk by this script. It rewrites git objects; your
#      working tree is untouched, but you must discard and re-clone afterwards.
#
# ROTATE FIRST. History rewriting does NOT un-leak a secret. The leaked tokens were
# public the moment they were pushed to the remote; this script only stops FUTURE
# readers from finding them. Run the rotation runbook first. If you have not rotated,
# say so explicitly when prompted below.
#
# shellcheck shell=sh

set -euo pipefail

# ── Paths to purge ──────────────────────────────────────────────────────────────
# Each entry is a PATH (not a credential value). These are DEAD files that carried
# the leaked values; see credential-exposure-2026-10.md §1 for the per-file detail.
#
#   scratch/test-turso-web.{ts,js}        F-01 Turso db token (9f64bf1d1254)
#   supabase/functions/gateway/lib/db.ts  F-01
#
# NOTE on apps/gateway/lib/db.ts (F-01): it is the gateway's real connection
# factory and is still tracked at HEAD (with the token already removed). It is
# deliberately NOT in LEAKED_PATHS: purging its path would delete the file from
# EVERY commit, including HEAD, and break the gateway build. Its leaked CONTENT
# is redacted in place by Step 2 (--replace-text), which rewrites the secret
# values while keeping the file.
LEAKED_PATHS="scratch/test-turso-web.ts scratch/test-turso-web.js supabase/functions/gateway/lib/db.ts"

# The two Supabase JWTs (F-02 service_role bb3333b3a7d3, F-03 anon 11fe0bd631da)
# were in .github/workflows/{lint,test,web-prod-gate}.yml — files that MUST keep
# existing. Purging them wholesale would delete CI. These are instead handled with
# --replace-text in REPLACE_LITERALS below, which is the correct tool.

# Text to replace across history. Values are the SHA-256 prefixes from the exposure
# report — the script looks up the real values from git at run time, so no secret is
# stored in this file. Populated by populate_replace_terms().

REPLACE_TERMS=""
# placeholder for detected literal terms (populated at runtime)

CONFIRM_PHRASE="REWRITE-HISTORY-AND-FORCE-PUSH"

usage() {
    cat <<'EOF'
Usage: history-scrub-dryrun.sh [--execute] [--remote <name>]

DRY RUN by default. Prints the exact commands it would run. Does not modify anything.

  --execute        Perform the rewrite. Still requires a typed confirmation string.
  --remote <name>  Remote to show the force-push command for (default: origin).

Options:
  -h, --help       Show this help and exit.
EOF
}

die() {
    printf 'ERROR: %s\n' "$*" >&2
    exit 1
}

log() {
    printf '%s\n' "$*"
}

hr() {
    printf '%s\n' "------------------------------------------------------------"
}

# ── Argument parsing ───────────────────────────────────────────────────────────
MODE="dry-run"
REMOTE="origin"

while [ $# -gt 0 ]; do
    case "$1" in
        --execute)
            MODE="execute"
            shift
            ;;
        --remote)
            [ $# -ge 2 ] || die "--remote requires a value"
            REMOTE="$2"
            shift 2
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            usage >&2
            die "unknown argument: $1"
            ;;
    esac
done

# ── Preconditions ──────────────────────────────────────────────────────────────
command -v git >/dev/null 2>&1 || die "git is required but not on PATH"

git rev-parse --git-dir >/dev/null 2>&1 || die "not inside a git repository"

log "Buddysaradhi — credential history scrub"
hr
log "Repository: $(git rev-parse --show-toplevel)"
log "HEAD:       $(git rev-parse --short HEAD)"
log "Mode:       $MODE"
log "Remote:     $REMOTE"
hr

# Detect filter-repo vs filter-branch BEFORE promising anything.
HAVE_FILTER_REPO=0
if git filter-repo --version >/dev/null 2>&1; then
    HAVE_FILTER_REPO=1
fi

# ── git grep across every commit ───────────────────────────────────────────────
# WHY xargs AND NOT "$(git rev-list --all)".
#
# The obvious form is `git grep PAT "$(git rev-list --all)" --`, and it is WRONG.
# Quoting passes all N revision strings as ONE argv entry, so git tries to resolve
# the entire space-separated blob as a single revision, prints
#   fatal: unable to resolve revision: <first-sha> <second-sha> ...
# to stderr, and (because callers redirect stderr to /dev/null to suppress the
# per-file noise) returns ZERO matches. It fails SILENTLY and reports "0 commits
# exposed" on a repository with 183 exposed commits — a green light on a breach.
#
# The unquoted form word-splits correctly but is unsafe under `set -f`-style
# hygiene and breaks if any ref name contains whitespace. `xargs` word-splits AND
# batches (so a repo with 100k commits cannot blow the exec arg limit), and needs
# NO `--` separator: with no pathspec, every argument is unambiguously a revision.
#
# Batching via xargs is what keeps this correct on a large repo.
#
# grep_all_revs <extended-regex> -> stdout: "<rev>:<path>" lines
grep_all_revs() {
    git rev-list --all | xargs git grep -I -l -E "$1" 2>/dev/null || true
}

# ── Discover the leaked literals from git (so no secret is hardcoded here) ──────
# We re-derive the exact Turso token value by matching its known shape in history,
# then reference it in --replace-text. The value is written to a temp file with
# restrictive perms and never echoed to stdout.
populate_replace_terms() {
    tmp_terms="$1"
    : >"$tmp_terms"
    # Turso db token: 3-segment JWT whose payload segment is ~224 chars.
    git rev-list --all |
        xargs git grep -I -o -h -E 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{200,}\.[A-Za-z0-9_-]{40,}' 2>/dev/null |
        sort -u | head -n 1 >>"$tmp_terms" || true
    # The two Supabase legacy JWTs (service_role + anon).
    git rev-list --all |
        xargs git grep -I -o -h -E 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9[A-Za-z0-9_.-]{40,}' 2>/dev/null |
        sort -u >>"$tmp_terms" || true
    # Deduplicate and drop blanks.
    if [ -s "$tmp_terms" ]; then
        grep -v '^$' "$tmp_terms" | sort -u >"${tmp_terms}.uniq" && mv "${tmp_terms}.uniq" "$tmp_terms"
    fi
}

# ── Report current exposure (informational) ────────────────────────────────────
# Counts DISTINCT COMMITS (not line hits) whose tree contains a leaked-shaped JWT.
# Note this pattern also matches the synthetic test fixtures; see §"Non-findings"
# in credential-exposure-2026-10.md.
count_leak_commits() {
    grep_all_revs 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}' |
        cut -d: -f1 | sort -u | wc -l | tr -d ' '
}

log ""
log "Current exposure: $(count_leak_commits) commit(s) contain a leaked-shaped JWT."
log ""

# ── Build the exact command set we intend to run ──────────────────────────────
# We build the argument list into a string for display, and (in execute mode) run the
# equivalent commands. Kept in sync by construction.

print_plan() {
    log "PLAN (what WOULD be run):"
    log ""

    if [ "$HAVE_FILTER_REPO" -eq 1 ]; then
        log "  Tool: git-filter-repo (detected)"
        log ""
        log "  Step 1 — purge leaked FILE paths from all history:"
        for p in $LEAKED_PATHS; do
            log "    git filter-repo --path '$p' --invert-paths --force"
        done
        log ""
        log "  Step 2 — redact leaked VALUES from surviving files (workflows):"
        # Build the --replace-text file reference dynamically at run time.
        log "    git filter-repo --replace-text <(printf '%s==>***REDACTED***\n' \$LEAK)"
        log ""
        log "  Step 3 — expire reflogs, gc, and verify:"
        log "    git reflog expire --expire=now --all && git gc --prune=now --aggressive"
        log "    git log --all --source -S'<leaked-token-prefix>'   # expect no hits"
    else
        log "  Tool: git-filter-branch (filter-repo NOT installed — using fallback)"
        log ""
        log "  Step 1 — purge leaked FILE paths (index-filter):"
        for p in $LEAKED_PATHS; do
            log "    git filter-branch --force --index-filter \\"
            log "      \"git rm -r --cached --ignore-unmatch '$p'\" \\"
            log "      --prune-empty --tag-name-filter cat -- --all"
        done
        log ""
        log "  Step 2 — redact leaked VALUES from surviving files (tree-filter):"
        log "    git filter-branch --force --tree-filter 'sed -i \"s|\$LEAK|***REDACTED***|g\" <files>' \\"
        log "      --prune-empty --tag-name-filter cat -- --all"
        log ""
        log "  Step 3 — clean up and verify:"
        log "    rm -rf .git/refs/original && git reflog expire --expire=now --all && git gc --prune=now --aggressive"
        log "    git log --all --source -S'<leaked-token-prefix>'   # expect no hits"
    fi
}

log ""
hr
log "WHAT THIS WILL DO"
hr
print_plan
hr
log ""

# ── Warnings ───────────────────────────────────────────────────────────────────
print_warnings() {
    log "!! DESTRUCTIVE ACTION — READ BEFORE PROCEEDING !!"
    log ""
    log "Rewriting git history is IRREVERSIBLE and DISRUPTIVE:"
    log "  * REQUIRES A FORCE-PUSH. Normal history is replaced on the remote."
    log "  * INVALIDATES EVERY EXISTING CLONE. Any clone made before the rewrite"
    log "    keeps the leaked tokens in its object store."
    log "  * EVERY COLLABORATOR MUST RE-CLONE (delete the old clone and clone"
    log "    again; do NOT try to repair it with fetch/reset)."
    log "  * BREAKS ALL OPEN PULL REQUESTS — they must be closed/rebased onto the"
    log "    rewritten history."
    log "  * DOES NOT UN-LEAK the credentials. Anyone who cloned, forked, mirrored"
    log "    or scraped the repo still holds them. ONLY rotation makes them dead."
    log "    (credential-exposure-2026-10.md §3)"
    log ""
    log "Also note:"
    log "  * apps/gateway/lib/db.ts is a LIVE source file still tracked at HEAD. It is"
    log "    NOT path-purged (Step 1 covers dead files only); its leaked values are"
    log "    redacted in place by Step 2 (--replace-text), so the file survives at"
    log "    HEAD and the gateway build keeps working."
    log ""
}

# ── Dry-run path: stop here after printing the plan ────────────────────────────
if [ "$MODE" = "dry-run" ]; then
    print_warnings
    log "DRY RUN — nothing was modified."
    log ""
    log "To actually perform the rewrite, re-run with:"
    log "  ./scripts/security/history-scrub-dryrun.sh --execute"
    log ""
    log "It will ask you to type: $CONFIRM_PHRASE"
    exit 0
fi

# ── Execute path: confirmation gate ────────────────────────────────────────────
print_warnings

log "BEFORE you continue, confirm out of band:"
log "  [ ] You have ROTATED the Turso token and the Supabase service_role key"
log "      (docs/security/TURSO-ROTATION-RUNBOOK.md)."
log "  [ ] You have told every collaborator about the re-clone requirement."
log "  [ ] All open PRs are noted (they will break)."
log ""

printf 'Type %s exactly to proceed, anything else aborts: ' "$CONFIRM_PHRASE"
# Read from the terminal, not a pipe, so it is not pre-filled.
if [ -t 0 ]; then
    read -r reply
else
    # Non-interactive: cannot confirm, abort safely.
    reply=""
fi

if [ "$reply" != "$CONFIRM_PHRASE" ]; then
    log ""
    log "Confirmation did not match. Aborting. Nothing was modified."
    exit 1
fi

log ""
log "Confirmation accepted. Beginning rewrite..."
log ""

# Make a safety tag BEFORE rewriting, so the pre-scrub state is one ref away.
log "Creating pre-scrub safety tag 'pre-scrub-2026-10'..."
git tag -f "pre-scrub-2026-10" HEAD >/dev/null 2>&1 ||
    log "  (could not create tag — continuing; ensure you have another backup)"
log ""

# ── Execute the rewrite ────────────────────────────────────────────────────────

# Build the replace-text file from discovered literals (values never echoed).
REPLACE_FILE="$(mktemp "${TMPDIR:-/tmp}/bs-replace.XXXXXX")"
chmod 600 "$REPLACE_FILE"
cleanup() { rm -f "$REPLACE_FILE"; }
trap cleanup EXIT INT TERM

populate_replace_terms "$REPLACE_FILE"
REPL_COUNT=0
if [ -f "$REPLACE_FILE" ]; then
    # Transform each discovered literal into a filter-repo replacement line.
    sed 's/$/==>***REDACTED-LEAKED-CREDENTIAL***/' "$REPLACE_FILE" >"${REPLACE_FILE}.fr" 2>/dev/null ||
        true
    if [ -s "${REPLACE_FILE}.fr" ]; then
        mv "${REPLACE_FILE}.fr" "$REPLACE_FILE"
        REPL_COUNT=$(wc -l <"$REPLACE_FILE" | tr -d ' ')
    fi
fi
log "Discovered $REPL_COUNT leaked value(s) to redact."

if [ "$HAVE_FILTER_REPO" -eq 1 ]; then
    # ── filter-repo path ──
    # Step 1: purge leaked paths.
    for p in $LEAKED_PATHS; do
        log "filter-repo: purging path '$p'..."
        git filter-repo --path "$p" --invert-paths --force >/dev/null
    done
    # Step 2: redact leaked values from surviving files (e.g. CI workflows, and the
    # live apps/gateway/lib/db.ts content — the file is kept, only the secret values
    # inside it are rewritten by --replace-text).
    if [ "$REPL_COUNT" -gt 0 ]; then
        log "filter-repo: redacting leaked values from surviving files..."
        git filter-repo --replace-text "$REPLACE_FILE" --force >/dev/null
    fi
    # Step-repo writes .git/filter-repo; ensure a normal clone still sees a clean ref.
    git for-each-ref --format='%(refname)' refs/filter-repo 2>/dev/null |
        while read -r r; do git update-ref -d "$r" >/dev/null 2>&1 || true; done
else
    # ── filter-branch fallback path ──
    log "filter-repo not installed — using git filter-branch (slower)."
    # Step 1: purge leaked paths via index-filter (one pass over all paths).
    rm_filter_expr=""
    for p in $LEAKED_PATHS; do
        rm_filter_expr="$rm_filter_expr git rm -r --cached --ignore-unmatch '$p' >/dev/null 2>&1 || true;"
    done
    # shellcheck disable=SC2086
    FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force \
        --index-filter "$rm_filter_expr" \
        --prune-empty --tag-name-filter cat -- --all >/dev/null
    # Step 2: redact leaked values from surviving files via tree-filter.
    if [ "$REPL_COUNT" -gt 0 ]; then
        log "filter-branch: redacting leaked values from surviving files..."
        while IFS= read -r leak; do
            [ -n "$leak" ] || continue
            # Escape the value for sed (treat as literal; it's base64url + dots).
            esc=$(printf '%s' "$leak" | sed 's/[.[\*^$()+?{|]/\\&/g')
            FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch --force \
                --tree-filter "grep -rlF '$esc' . 2>/dev/null | while read -r f; do sed -i 's|$esc|***REDACTED-LEAKED-CREDENTIAL***|g' \"\$f\"; done || true" \
                --prune-empty --tag-name-filter cat -- --all >/dev/null
        done <"$REPLACE_FILE"
    fi
fi

# Step 3: garbage-collect the unreachable objects.
log "Expiring reflogs and garbage-collecting..."
rm -rf .git/refs/original
git reflog expire --expire=now --all >/dev/null 2>&1 || true
git gc --prune=now --aggressive >/dev/null 2>&1 || true

# ── Verify ─────────────────────────────────────────────────────────────────────
log ""
hr
log "REWRITE COMPLETE (local). Verification:"
hr
remaining=$(grep_all_revs 'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{40,}' |
    cut -d: -f1 | sort -u | wc -l | tr -d ' ')
log "Commits still containing a leaked-shaped JWT: $remaining"
if [ "$remaining" -gt 0 ]; then
    log "  (Residual hits are expected to be NON-LEAKED test fixtures — synthetic"
    log "   JWTs used by the redactor tests. Confirm against"
    log "   credential-exposure-2026-10.md §1 'Non-findings'.)"
fi
hr
log ""
log "NEXT STEPS — these are NOT automatic:"
log "  1. Push (force):"
log "       git push --force --mirror $REMOTE"
log "     and delete/re-create the branch protections if needed."
log "  2. Tell every collaborator to DELETE their clone and re-clone."
log "  3. Re-run:  gitleaks git   (expect exit 0 / no leaks)."
log "  4. A pre-scrub tag 'pre-scrub-2026-10' still points at the OLD history."
log "     If you leave it, the leaked objects remain reachable and the scrub is"
log "     cosmetic only. Delete it (and gc) once rotation is confirmed:"
log "       git tag -d pre-scrub-2026-10 && git reflog expire --expire=now --all && git gc --prune=now"
log ""
log "REMEMBER: rotation is what kills the leak; this only stops future readers."