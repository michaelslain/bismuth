#!/usr/bin/env bash
# shipped-log.sh — the auto-changelog. A running record of what the board shipped,
# derived from the `merge(bismuth-changes)` commits on main (always in sync with
# git, nothing to hand-maintain). Print it, or --write it to docs/bismuth-changes-shipped.md.
#
# Usage: scripts/shipped-log.sh            (print)
#        scripts/shipped-log.sh --write     (write docs/bismuth-changes-shipped.md)
set -u
cd "$(git rev-parse --show-toplevel)" || exit 2

render(){
  echo "# Bismuth Changes — Shipped"
  echo
  echo "_Auto-generated from \`merge(bismuth-changes)\` commits on main. Newest first._"
  echo
  git log main --format='%cd|%h|%s' --date=short \
    | grep -E 'merge\(bismuth-changes\)' \
    | while IFS='|' read -r d h s; do
        s=${s#merge(bismuth-changes): }
        printf -- "- **%s** · \`%s\` — %s\n" "$d" "$h" "$s"
      done
}

if [ "${1:-}" = "--write" ]; then
  out="docs/bismuth-changes-shipped.md"
  render > "$out"
  echo "wrote $out ($(grep -c '^- ' "$out") entries)"
else
  render
fi
