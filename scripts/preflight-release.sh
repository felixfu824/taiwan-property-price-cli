#!/usr/bin/env bash
# preflight-release.sh — pre-publish secret-leak scanner for tw-lvr-cli.
#
# PUBLIC-SAFE: this file contains only GENERIC credential regexes. Your personal identifiers
# (emails, VPS IP, Notion/Telegram/LINE IDs, home paths) live in the local-only
# ../Product_WS/security/release-security/.watchlist and are NOT baked into this script.
#
# >>> RUN THIS DIRECTLY IN YOUR TERMINAL, before `npm publish` / git push:
#       bash scripts/preflight-release.sh
#     Do not rely on running it through an AI agent's shell — a token-saving proxy can truncate
#     `git log` output and hide a real leak (this actually happened during the 2026-05-29 audit).
#
# Exit 0 = clean.  Exit 1 = potential leak / hygiene issue — review before releasing.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

FAIL=0
hdr() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32m\xE2\x9C\x93\033[0m %s\n' "$1"; }
bad() { printf '  \033[31m\xE2\x9C\x97 %s\033[0m\n' "$1"; FAIL=1; }

# Generic credential-shape patterns (public-safe).
CRED='sk-ant-[A-Za-z0-9_-]{8,}|sk-proj-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|gh[posu]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|dop_v1_[a-f0-9]{40,}|xox[baprs]-[A-Za-z0-9-]{10,}|ntn_[A-Za-z0-9]{40,}|secret_[A-Za-z0-9]{40,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{10,}|[0-9]{8,10}:[A-Za-z0-9_-]{35,}'
# Lockfile integrity hashes etc. are not secrets.
DENOISE='integrity|sha512-|sha256-|"resolved"|_resolved|//registry|integrity"'

WL="${TW_LVR_WATCHLIST:-../Product_WS/security/release-security/.watchlist}"
wl_patterns() { [ -f "$WL" ] && grep -vE '^[[:space:]]*(#|$)' "$WL"; }

hdr "1) Credential scan — tracked files (what's on GitHub)"
HITS="$(git ls-files -z | xargs -0 grep -InE "$CRED" 2>/dev/null | grep -vE "$DENOISE")"
if [ -n "$HITS" ]; then bad "credential pattern in tracked files:"; echo "$HITS" | sed 's/^/      /'
else ok "no credential patterns in tracked files"; fi

hdr "2) Credential scan — FULL git history (untruncated)"
HC="$(git log --all -p --no-color 2>/dev/null | grep -E '^[-+]' | grep -En "$CRED" | grep -vE "$DENOISE")"
if [ -n "$HC" ]; then bad "credential pattern in git history diff:"; echo "$HC" | sed 's/^/      /'
else ok "no credential patterns across all commits"; fi

hdr "3) Credential scan — shipped artifacts (dist/, skills/ = what npm publishes)"
if [ -d dist ] || [ -d skills ]; then
  SC="$(grep -rInE "$CRED" dist skills 2>/dev/null | grep -vE "$DENOISE")"
  if [ -n "$SC" ]; then bad "credential pattern in shipped files:"; echo "$SC" | sed 's/^/      /'
  else ok "no credential patterns in dist/ or skills/"; fi
else printf '  \033[33m\! dist/ not built — run `npm run build` then re-run for a complete check\033[0m\n'; fi

hdr "4) Personal-identifier scan — tracked + shipped (from watchlist)"
if [ -s "$WL" ] && [ -n "$(wl_patterns)" ]; then
  PT="$(git ls-files -z | xargs -0 grep -InFf <(wl_patterns) 2>/dev/null)"
  PS="$( { [ -d dist ] && grep -rInFf <(wl_patterns) dist 2>/dev/null; [ -d skills ] && grep -rInFf <(wl_patterns) skills 2>/dev/null; } )"
  PH="$(git log --all -p --no-color 2>/dev/null | grep -E '^[-+]' | grep -Ff <(wl_patterns))"
  if [ -n "$PT$PS$PH" ]; then
    bad "personal identifier found in public content/history:"
    { [ -n "$PT" ] && echo "$PT"; [ -n "$PS" ] && echo "$PS"; [ -n "$PH" ] && echo "[history] $PH"; } | sed 's/^/      /'
  else ok "no watchlisted identifiers in tracked, shipped, or history"; fi
else printf '  \033[33m\! watchlist %s missing/empty — skipping identifier scan\033[0m\n' "$WL"; fi

hdr "5) Gitignore guard — secret-bearing dev docs must stay untracked"
G=0
for f in PRODUCTION_TEST_PLAN.md ROADMAP.md CLAUDE.md AGENTS.md legal-tos-assessment.md TEST_CASES.md pipeline-design.md value-prop-1-pager.md analysis test .claude; do
  if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then bad "TRACKED (should be gitignored): $f"; G=1; fi
done
[ "$G" -eq 0 ] && ok "all known secret-bearing dev docs are untracked"

hdr "6) Stray sensitive files tracked (.DS_Store / .env / keys)"
SS="$(git ls-files | grep -iE '(^|/)\.DS_Store$|\.env($|\.)|\.pem$|\.key$|(^|/)id_(rsa|ed25519|ecdsa)|\.p12$|\.pfx$|(^|/)\.netrc$|(^|/)\.npmrc$')"
if [ -n "$SS" ]; then bad "sensitive file is tracked:"; echo "$SS" | sed 's/^/      /'
else ok "no stray credential/metadata files tracked"; fi

hdr "7) npm pack — exact files that will ship (eyeball this)"
npm_config_cache="${TMPDIR:-/tmp}/npm-preflight-cache" npm pack --dry-run 2>&1 \
  | grep -E 'npm notice .*(kB|B) ' | sed 's/^npm notice/   /' || printf '   (npm pack unavailable)\n'

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[1;32mPREFLIGHT PASSED\033[0m — no secrets/PII detected. Eyeball the file list above, confirm `git status` is clean, then publish.\n'
else
  printf '\033[1;31mPREFLIGHT FAILED\033[0m — review the ✗ items above BEFORE publishing or pushing.\n'
fi
exit "$FAIL"
