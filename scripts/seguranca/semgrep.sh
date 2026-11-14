#!/usr/bin/env bash
# Semgrep over the whole repository with the security rules of
# semgrep/semgrep-rules, pinned to a reviewed commit (docs/qa/varreduras-de-seguranca.md).
# The same script runs in CI (job "semgrep", in the pinned semgrep image) and on
# an agent's machine (pip install semgrep==$SEMGREP_VERSION). Any finding fails:
# fix it, or mark a false positive on the line before with
#   // nosemgrep: <rule-id> -- <why it is safe>
# Extra arguments go to semgrep (for example --json -o out.json).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

SEMGREP_VERSION=1.185.0
RULES_SHA=a5ad1714f00c9f7fde980cab0ea1d6dc6d414fd2
RULES_DIR="${SEMGREP_RULES_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/zuri/semgrep-rules-$RULES_SHA}"

command -v semgrep >/dev/null || { echo "semgrep not found: pip install semgrep==$SEMGREP_VERSION" >&2; exit 2; }
found="$(semgrep --version 2>/dev/null | tail -1)"
[ "$found" = "$SEMGREP_VERSION" ] || echo "warning: semgrep $found, the CI runs $SEMGREP_VERSION" >&2

if [ ! -f "$RULES_DIR/.zuri-ok" ]; then
  rm -rf "$RULES_DIR"
  mkdir -p "$RULES_DIR"
  git -C "$RULES_DIR" init -q
  git -C "$RULES_DIR" fetch -q --depth 1 https://github.com/semgrep/semgrep-rules.git "$RULES_SHA"
  git -C "$RULES_DIR" checkout -q FETCH_HEAD
  touch "$RULES_DIR/.zuri-ok"
fi
[ "$(git -C "$RULES_DIR" rev-parse HEAD)" = "$RULES_SHA" ] || { echo "rules are not at $RULES_SHA" >&2; exit 2; }

# Only the security rules of the languages the repository has: the style and
# correctness rules of the same folders repeat what Biome and TypeScript check.
configs=()
while read -r dir; do configs+=(--config "$RULES_DIR/$dir"); done < <(
  cd "$RULES_DIR" && { find javascript typescript generic yaml/github-actions -type d -name security; echo package_managers/npm; } | sort
)

# --metrics=off: no call to Semgrep's servers (rule 7 of AGENTS.md, no telemetry).
exec semgrep scan --metrics=off --disable-version-check --error --quiet "${configs[@]}" "$@" .
