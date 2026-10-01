#!/usr/bin/env bash
# Manually download the exercise images (JPG) and animations (GIF) into ./media.
# You normally DON'T need this — `docker compose up` fetches them automatically.
# Source: hasaneyldrm/exercises-dataset — MIT for the metadata and instruction text, but the
# images and GIFs are © Gym visual (https://gymvisual.com/), used under that dataset's terms.
# openGym does not redistribute or relicense them. See NOTICE.md.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cat <<'EOF'
↓ Downloading exercise media (~140 MB) from github.com/hasaneyldrm/exercises-dataset
  Metadata and instruction text: MIT.
  Images and animations: © Gym visual — https://gymvisual.com/
  Used under that dataset's terms, not openGym's AGPL; openGym does not redistribute them.
  Terms: https://gymvisual.com/content/3-terms-and-conditions-of-use
  Reusing this media yourself, commercially or not, needs your own licence from Gym visual.
  Details in NOTICE.md.
EOF
git clone --depth 1 https://github.com/hasaneyldrm/exercises-dataset "$tmp"
mkdir -p media/img media/gif
cp "$tmp"/images/*.jpg media/img/
cp "$tmp"/videos/*.gif media/gif/
echo "✓ $(ls media/img | wc -l) images, $(ls media/gif | wc -l) GIFs"

# Start/end photographs for the catalogue rows that came from free-exercise-db — the same step
# the compose `media` service runs, pinned to the commit those rows were generated from.
# The data of that project is public domain (The Unlicense); where its photographs come from,
# and whose they are, is not established by it. openGym does not redistribute them. See NOTICE.md.
if [ ! -f media/img/fedb/.complete ]; then
  echo "↓ Downloading exercise photographs (~90 MB) from github.com/yuhonas/free-exercise-db"
  fe="$tmp/fe"
  mkdir -p "$fe" media/img/fedb
  git -C "$fe" init -q
  git -C "$fe" remote add origin https://github.com/yuhonas/free-exercise-db
  git -C "$fe" fetch -q --depth 1 origin f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5
  git -C "$fe" checkout -q FETCH_HEAD
  for d in "$fe"/exercises/*/; do
    n="$(basename "$d")"
    mkdir -p "media/img/fedb/$n"
    cp "$d"0.jpg "$d"1.jpg "media/img/fedb/$n/" 2>/dev/null || true
  done
  touch media/img/fedb/.complete
  echo "✓ $(ls media/img/fedb | wc -l) exercises with photographs"
fi
