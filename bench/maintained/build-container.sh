#!/bin/zsh
# Stage 1 of a maintained container: a fresh worktree on sloppy/maintained from the upstream commit
# under the documents-as-kept tree, init, the documents carried, the graph laid out by the map.
# usage: build-container.sh <name> <as-kept sha> <doc root>...   (SUBJECTS: where the subject checkouts are)
set -e
NAME=$1; ASKEPT=$2; shift 2
HERE=$(cd "$(dirname "$0")" && pwd); S=$(cd "$HERE/../.." && pwd); CLI=$S/packages/ts/cli/dist/sloppy.mjs
SUBJECTS=${SUBJECTS:-$HOME/sloppy-bench/subjects}
REPO=$SUBJECTS/$NAME; W=$SUBJECTS/$NAME-maintained; MAP=$S/bench/subjects/maintained/$NAME-architecture.json
# the upstream commit: the newest ancestor of the as-kept tree that carries no .sloppy
BASE=$ASKEPT; while git -C $REPO ls-tree --name-only $BASE | grep -qx ".sloppy"; do BASE=$(git -C $REPO rev-parse $BASE^); done
echo "== $NAME: as kept $ASKEPT, upstream $BASE"
[ -d $W ] || git -C $REPO worktree add -q $W -b sloppy/maintained $BASE
cd $W && git checkout -q -B sloppy/maintained $BASE && rm -rf .sloppy
echo "== init"; node $CLI init 2>&1 | tail -1
echo "== carry"; node $S/bench/carry-docs.mjs $W "$@" --cli $CLI 2>&1 | grep -v "not markdown" | tail -2
echo "== map"; node $HERE/apply-map.mjs $W $MAP --cli $CLI 2>&1 | grep -v "^    at " | tail -3
echo "== notes: $(ls .sloppy/notes | wc -l | tr -d ' ')  offers: $(ls .sloppy/amendments 2>/dev/null | wc -l | tr -d ' ')"
git add -A && git commit -q -m "Start the notes and lay the graph out by what the code is" && echo "stage 1 committed $(git rev-parse --short HEAD)"
