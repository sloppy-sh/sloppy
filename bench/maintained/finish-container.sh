#!/bin/zsh
# Stage 2: the writers' pages into the notes, the lines they corrected, sizes and logos, committed.
# usage: finish-container.sh <name> <pages dir>   (SUBJECTS: where the subject checkouts are)
set -e
NAME=$1; PAGES=$(cd "$2" && pwd)
HERE=$(cd "$(dirname "$0")" && pwd); S=$(cd "$HERE/../.." && pwd); CLI=$S/packages/ts/cli/dist/sloppy.mjs
SUBJECTS=${SUBJECTS:-$HOME/sloppy-bench/subjects}
W=$SUBJECTS/$NAME-maintained; MAP=$S/bench/subjects/maintained/$NAME-architecture.json; cd $W
echo "== pages"; node $HERE/apply-substance.mjs $W $MAP $PAGES --cli $CLI 2>&1 | grep -v "^    at " | tail -6
echo "== sizes and logos"; node $HERE/dress.mjs $W $MAP --cli $CLI 2>&1 | tail -3
node -e '
const fs=require("fs"),path=require("path");const N=".sloppy/notes";let n=0,p=0,w=0;for(const f of fs.readdirSync(N)){const t=fs.readFileSync(path.join(N,f),"utf8");n++;const body=t.split(/^---$/m).slice(2).join("---");w+=body.replace(/<!--[^>]*-->/g,"").split(/\s+/).filter(x=>/[a-z]/i.test(x)).length;if(/^## What it is|^## What this gathers/m.test(body))p++}console.log("notes",n,"| with a page",p,"| words",w.toLocaleString("en-US"))'
git add -A && git commit -q -m "Give every component its page, read from the code, with the lines corrected to what the code does" && echo "stage 2 committed $(git rev-parse HEAD)"
