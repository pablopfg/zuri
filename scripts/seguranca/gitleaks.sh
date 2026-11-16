#!/usr/bin/env bash
# Gitleaks over every commit of the repository, with the rules in .gitleaks.toml
# (docs/qa/varreduras-de-seguranca.md). The binary is a pinned release, checked
# against its SHA-256 before it runs. The same script runs in CI (job
# "gitleaks", full history) and on an agent's machine. Any leak fails, and the
# report hides the secret (--redact).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

VERSION=8.30.0
# The SHA-256 of each release file, from gitleaks_8.30.0_checksums.txt.
case "$(uname -s)_$(uname -m)" in
  Linux_x86_64) PLATFORM=linux_x64 SHA256=79a3ab579b53f71efd634f3aaf7e04a0fa0cf206b7ed434638d1547a2470a66e ;;
  Linux_aarch64 | Linux_arm64) PLATFORM=linux_arm64 SHA256=b4cbbb6ddf7d1b2a603088cd03a4e3f7ce48ee7fd449b51f7de6ee2906f5fa2f ;;
  Darwin_x86_64) PLATFORM=darwin_x64 SHA256=ca221d012d247080c2f6f61f4b7a83bffa2453806b0c195c795bbe9a8c775ed5 ;;
  Darwin_arm64) PLATFORM=darwin_arm64 SHA256=b251ab2bcd4cd8ba9e56ff37698c033ebf38582b477d21ebd86586d927cf87e7 ;;
  *) echo "no pinned gitleaks for $(uname -s) $(uname -m)" >&2; exit 2 ;;
esac
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/zuri/gitleaks-$VERSION-$PLATFORM"
BIN="$CACHE/gitleaks"

if [ ! -x "$BIN" ]; then
  mkdir -p "$CACHE"
  tarball="$CACHE/gitleaks.tar.gz"
  curl -fsSL -o "$tarball" "https://github.com/gitleaks/gitleaks/releases/download/v$VERSION/gitleaks_${VERSION}_${PLATFORM}.tar.gz"
  if command -v sha256sum >/dev/null; then
    echo "$SHA256  $tarball" | sha256sum -c --quiet
  else
    echo "$SHA256  $tarball" | shasum -a 256 -c --quiet
  fi
  tar -xzf "$tarball" -C "$CACHE" gitleaks
  rm "$tarball"
fi

exec "$BIN" git --config .gitleaks.toml --redact --no-banner --verbose "$@" .
