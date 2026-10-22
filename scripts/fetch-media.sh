#!/usr/bin/env bash
# Manually download the start/end photographs of the exercises this instance adds from
# free-exercise-db (frontend/src/lib/exercises-extra.js names them as img/fedb/<dir>/0.jpg and
# 1.jpg) into ./media/img/fedb. The same step the compose `media` service runs; you only need
# this without Docker, or to fetch them ahead of time.
#
# The catalogue's own stills and animations (Gym visual) are NOT downloaded here: since v1.4.0
# they ship inside the web image and the app packages (catalogue/media/, NOTICE.md).
#
# Pinned to the commit those rows were generated from (scripts/build-extra-exercises.mjs). The
# data of that project is public domain (The Unlicense); where its photographs come from, and
# whose they are, is not established by it. openGym does not redistribute them. See NOTICE.md.
# To run without them: create the empty file media/img/fedb/.complete instead.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f media/img/fedb/.complete ]; then
  echo "✓ Exercise photographs already present (media/img/fedb) — nothing to do."
  exit 0
fi
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
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
