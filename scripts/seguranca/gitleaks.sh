#!/usr/bin/env bash
# Gitleaks over every commit of the repository, with the rules in .gitleaks.toml
# (docs/qa/varreduras-de-seguranca.md). The binary is a pinned release, checked
# against its SHA-256 before it runs. The same script runs in CI (job
# "gitleaks", full history) and on an agent's machine. Any leak fails, and the
# report hides the secret (--redact).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

VERSION=8.30.0
SHA256=79a3ab579b53f71efd634f3aaf7e04a0fa0cf206b7ed434638d1547a2470a66e
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/zuri/gitleaks-$VERSION"
BIN="$CACHE/gitleaks"

if [ ! -x "$BIN" ]; then
  mkdir -p "$CACHE"
  tarball="$CACHE/gitleaks.tar.gz"
  curl -fsSL -o "$tarball" "https://github.com/gitleaks/gitleaks/releases/download/v$VERSION/gitleaks_${VERSION}_linux_x64.tar.gz"
  echo "$SHA256  $tarball" | sha256sum -c --quiet
  tar -xzf "$tarball" -C "$CACHE" gitleaks
  rm "$tarball"
fi

exec "$BIN" git --config .gitleaks.toml --redact --no-banner --verbose "$@" .
