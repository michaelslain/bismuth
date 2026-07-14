#!/usr/bin/env bash
# plan-lanes.sh — the auto lane-planner. Reads the actionable board cards (Todo +
# Done-but-Broken), maps each to a code AREA by keyword, groups same-area cards
# into ONE worktree lane (so parallel agents never clobber a shared file), and
# suggests model+effort per card (type + bounces). A planning aid for launching a
# build round — the operator still confirms the clusters.
# bash 3.2 compatible.
set -u
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"
[ -d "$DIR" ] || { echo "board dir not found: $DIR" >&2; exit 1; }
fm(){ awk -v k="$2" '{ if($0 ~ "^"k":"){ sub(/^[^:]*: */,""); print; exit } }' "$1"; }

area(){ # $1 = lowercased "name + description"
  case "$1" in
    *flashcard*|*srs*|*cram*|*review\ progress*) echo flashcards;;
    *kanban*|*card*|*column*|*pinterest*|*masonry*) echo kanban-bases;;
    *chat*|*chrome*|*opencode*|*claude\ code*|*provider*) echo chat;;
    *emoji*|*table*|*cell*|*autocomplete*) echo editor-table;;
    *graph*|*layout*|*node*) echo graph;;
    *calendar*|*gcal*|*event*) echo calendar;;
    *base*|*propert*|*view*|*formula*) echo bases;;
    *drawing*|*\.draw*|*canvas*) echo drawing;;
    *terminal*|*pty*) echo terminal;;
    *) echo misc;;
  esac
}
model(){ # $1 type, $2 bounces
  t="$1"; b="$2"
  case "$b" in ''|*[!0-9]*) b=0;; esac
  if [ "$b" -ge 1 ]; then echo "opus/xhigh (bounced ${b}x)"; return; fi
  case "$t" in
    feature) echo "opus/high (fable if flagship)";;
    design)  echo "opus/high";;
    bug)     echo "sonnet/high";;
    *)       echo "sonnet/medium";;
  esac
}

# collect: area \t "name | type | model"
rows=""
while IFS= read -r -d '' f; do
  st=$(fm "$f" status); case "$st" in Todo|"Done but Broken"|"") ;; *) continue;; esac
  name=$(basename "$f" .md); ty=$(fm "$f" type); bo=$(fm "$f" bounces)
  key=$(printf '%s %s' "$name" "$(fm "$f" description)" | tr '[:upper:]' '[:lower:]')
  a=$(area "$key"); m=$(model "$ty" "$bo")
  rows="$rows$a	$name | ${ty:-?} | $m"$'\n'
done < <(find "$DIR" -maxdepth 1 -name '*.md' -print0)

[ -z "$rows" ] && { echo "no actionable cards."; exit 0; }
echo "-- suggested lanes (same area = ONE worktree lane, run in parallel) --"
printf '%s' "$rows" | cut -f1 | sort -u | while read -r a; do
  [ -z "$a" ] && continue
  echo; echo "### lane: $a"
  printf '%s' "$rows" | awk -F'\t' -v a="$a" '$1==a{print "  - "$2}'
done
n=$(printf '%s' "$rows" | grep -c .)
l=$(printf '%s' "$rows" | cut -f1 | sort -u | grep -c .)
echo; echo "-> $n card(s) across $l parallel lane(s)."
