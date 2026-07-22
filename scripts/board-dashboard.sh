#!/usr/bin/env bash
# board-dashboard.sh — the board-health dashboard generator (brainstorm idea P).
# Reads the Bismuth Changes board + git and emits a self-contained HTML page:
# per-column counts, what's waiting on you, bounce hotspots, shipped-today —
# PLUS live preview links for every Awaiting Confirmation card, sourced from
# `scripts/previews.sh status --tsv` (the contract both lanes are built against;
# see that script's header). This is the fix for having to ask "what's the
# localhost for card X?" one at a time — the dashboard IS the click-through.
#
# Usage:
#   board-dashboard.sh            print HTML to stdout
#   board-dashboard.sh > <served-dir>/index.html
#   board-dashboard.sh --serve    write index.html + serve it on :1430
#                                  (python3 http.server, idempotent — rewrites
#                                  index.html in place if something's already
#                                  listening rather than double-spawning)
# bash 3.2 compatible.
set -u
VAULT="${BISMUTH_VAULT:-/Users/michaelslain/Documents/library of alexandria}"
DIR="$VAULT/thoughts/Bismuth Changes"
[ -d "$DIR" ] || { echo "board dir not found: $DIR" >&2; exit 1; }
fm(){ awk -v k="$2" '{ if($0 ~ "^"k":"){ sub(/^[^:]*: */,""); print; exit } }' "$1"; }
esc(){ sed 's/&/\&amp;/g;s/</\&lt;/g;s/>/\&gt;/g'; }
# single-quote a string for safe paste into a POSIX shell command line
shquote(){ printf '%s' "$1" | sed "s/'/'\\\\''/g"; }

MODE="print"
[ "${1:-}" = "--serve" ] && MODE="serve"

REPO="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
today=$(cd "$REPO" 2>/dev/null && git log -1 --format=%cd --date=short 2>/dev/null)
shipped_today=$(cd "$REPO" 2>/dev/null && git log --since="$today 00:00" --format='%s' 2>/dev/null | grep -c 'merge(bismuth-changes)')

# gather cards → "status|type|bounces|name"
cards=""
while IFS= read -r -d '' f; do
  st=$(fm "$f" status); ty=$(fm "$f" type); bo=$(fm "$f" bounces); nm=$(basename "$f" .md)
  cards="$cards${st:-<none>}|${ty:-?}|${bo:-0}|$nm"$'\n'
done < <(find "$DIR" -maxdepth 1 -name '*.md' -print0)

count(){ printf '%s' "$cards" | awk -F'|' -v s="$1" '$1==s' | grep -c .; }

col_cards(){ printf '%s' "$cards" | awk -F'|' -v s="$1" '$1==s{print}'; }

emit_col(){ # $1 status  $2 css-class
  local n; n=$(count "$1")
  [ "$n" = 0 ] && return
  echo "<section class=\"col $2\"><h2>$1 <span class=\"n\">$n</span></h2>"
  col_cards "$1" | while IFS='|' read -r s t b nm; do
    badge=""; [ -n "$t" ] && [ "$t" != "?" ] && badge="<span class=\"ty\">$t</span>"
    bb=""; [ "${b:-0}" != 0 ] && [ -n "$b" ] && bb="<span class=\"bounce\" title=\"bounced ${b} time(s)\">&#8617;${b}</span>"
    echo "<div class=\"card\">$(printf '%s' "$nm" | esc)$badge$bb</div>"
  done
  echo "</section>"
}

# --- previews.sh integration (contract: scripts/previews.sh status --tsv) ---
# slug \t card \t landed \t core_port \t vite_port \t worktree_path \t state \t acceptance
# state: live | down | no-worktree | no-landed
previews_ok=0
previews_note=""
previews_tsv=""
PREVIEWS_SCRIPT="$REPO/scripts/previews.sh"
if [ -f "$PREVIEWS_SCRIPT" ]; then
  if previews_tsv=$(bash "$PREVIEWS_SCRIPT" status --tsv 2>/dev/null); then
    previews_ok=1
  else
    previews_note="scripts/previews.sh errored — showing the plain card list instead of live preview links."
  fi
else
  previews_note="scripts/previews.sh not found yet — showing the plain card list instead of live preview links."
fi

emit_previews(){
  if [ "$previews_ok" != 1 ]; then
    emit_col "Awaiting Confirmation" wait
    [ -n "$previews_note" ] && echo "<p class=\"pv-note\">$(printf '%s' "$previews_note" | esc)</p>"
    return
  fi
  if [ -z "$previews_tsv" ]; then
    echo "<p class=\"pv-note\">Nothing is Awaiting Confirmation right now.</p>"
    return
  fi
  echo "<div class=\"pv-grid\">"
  # NB: `IFS=$'\t' read` silently COLLAPSES consecutive tabs (empty fields
  # vanish, shifting every column after) — tab is IFS "whitespace" and that
  # collapsing applies no matter what IFS is set to. previews.sh emits real
  # empty fields (e.g. no `landed` yet), so re-delimit on a control char
  # (0x1F, unit separator) that read does NOT treat as collapsible first.
  printf '%s\n' "$previews_tsv" | tr '\t' '\037' | while IFS=$'\037' read -r slug card landed core_port vite_port wt state acc; do
    [ -n "$slug" ] || continue
    case "$core_port" in ''|*[!0-9]*) core_port="?";; esac
    case "$vite_port" in ''|*[!0-9]*) vite_port="?";; esac
    url="http://localhost:$vite_port"
    dst="down"; dotc="down"; [ "$state" = "live" ] && { dst="live"; dotc="live"; }
    cardT=$(printf '%s' "$card" | esc)
    slugT=$(printf '%s' "$slug" | esc)
    landedT="—"; [ -n "$landed" ] && landedT=$(printf '%s' "$landed" | esc)
    accT="No acceptance criterion on this card."; [ -n "$acc" ] && accT=$(printf '%s' "$acc" | esc)
    urlT=$(printf '%s' "$url" | esc)
    cmd="scripts/previews.sh start '$(shquote "$card")'"
    cmdT=$(printf '%s' "$cmd" | esc)
    echo "<div class=\"pcard\" id=\"pv-$slugT\" data-state=\"$dst\" data-url=\"$urlT\">"
    echo "  <div class=\"pc-head\"><span class=\"dot $dotc\" title=\"$(printf '%s' "$state" | esc)\"></span><h3>$cardT</h3></div>"
    echo "  <div class=\"pc-acc\"><span class=\"pc-acc-k\">Acceptance</span>$accT</div>"
    echo "  <div class=\"pc-meta\"><span class=\"pc-sha\">landed $landedT</span><span class=\"pc-ports\">core :$core_port &middot; vite :$vite_port</span></div>"
    echo "  <a class=\"pc-link\" href=\"$urlT\" target=\"_blank\" rel=\"noopener\">Open preview &rarr;</a>"
    echo "  <div class=\"pc-cmd\"><code>$cmdT</code></div>"
    echo "</div>"
  done
  echo "</div>"
}

render_html(){
cat <<HTML
<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Bismuth Changes — Board</title>
<style>
:root{--bg:#0d0f13;--panel:#161a21;--line:#272d38;--fg:#e7ecf3;--dim:#9aa6b6;--accent:#7aa2ff;--broke:#e5604d;--wait:#e6b34a;--done:#3fca7a;--mono:ui-monospace,Menlo,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media(prefers-color-scheme:light){:root{--bg:#f5f7fa;--panel:#fff;--line:#e2e7ee;--fg:#1a2029;--dim:#5c6672}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--sans);padding:36px 22px 70px}
.wrap{max-width:1100px;margin:0 auto}h1{font-size:24px;font-weight:650;margin:0 0 3px;letter-spacing:-.02em}
.sub{color:var(--dim);font-size:13px;margin:0 0 22px}
.tiles{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:26px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 16px;min-width:120px}
.tile .v{font-size:26px;font-weight:680;letter-spacing:-.02em}.tile .k{font-size:11.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.05em}
.tile.wait .v{color:var(--wait)}.tile.broke .v{color:var(--broke)}.tile.done .v{color:var(--done)}
.hero{margin-bottom:30px}
.hero h2{font-size:15px;font-weight:650;margin:0 0 12px;display:flex;align-items:center;gap:8px;color:var(--wait);text-transform:uppercase;letter-spacing:.04em}
.hero h2 .n{background:var(--line);color:var(--fg);border-radius:20px;padding:1px 9px;font-size:12px;text-transform:none;letter-spacing:0}
.pv-note{color:var(--dim);font-size:13px;background:var(--panel);border:1px dashed var(--line);border-radius:10px;padding:10px 14px}
.pv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:14px}
.pcard{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:9px}
.pc-head{display:flex;align-items:center;gap:9px}
.pc-head h3{margin:0;font-size:14.5px;font-weight:620;letter-spacing:-.01em;line-height:1.3}
.dot{width:9px;height:9px;border-radius:50%;flex:none;box-shadow:0 0 0 3px transparent}
.dot.live{background:var(--done);box-shadow:0 0 0 3px color-mix(in srgb,var(--done) 25%,transparent)}
.dot.down{background:var(--dim)}
.pc-acc{font-size:12.5px;line-height:1.45;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:8px 10px}
.pc-acc-k{display:block;font-size:10px;color:var(--wait);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px;font-weight:650}
.pc-meta{display:flex;justify-content:space-between;gap:8px;font-family:var(--mono);font-size:11px;color:var(--dim)}
.pc-link{display:none;text-align:center;background:var(--accent);color:#0d0f13;font-weight:650;font-size:13px;text-decoration:none;border-radius:9px;padding:8px 10px}
.pc-cmd{display:none}
.pc-cmd code{display:block;font-family:var(--mono);font-size:11px;color:var(--fg);background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:8px 10px;overflow-x:auto;white-space:pre}
.pcard[data-state="live"] .pc-link{display:block}
.pcard[data-state="down"] .pc-cmd{display:block}
.cols{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.col{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.col h2{font-size:13px;font-weight:600;margin:0 0 10px;display:flex;align-items:center;gap:8px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em}
.col .n{background:var(--line);color:var(--fg);border-radius:20px;padding:1px 9px;font-size:12px}
.col.wait h2{color:var(--wait)}.col.broke h2{color:var(--broke)}
.card{font-size:13.5px;padding:7px 0;border-top:1px solid var(--line);display:flex;align-items:center;gap:8px}
.card:first-of-type{border-top:none}
.ty{font-family:var(--mono);font-size:10.5px;color:var(--dim);background:var(--bg);padding:1px 6px;border-radius:5px;margin-left:auto}
.bounce{font-family:var(--mono);font-size:11px;color:var(--broke)}
footer{margin-top:26px;color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:14px}
</style></head><body><div class="wrap">
<h1>Bismuth Changes — Board</h1>
<p class="sub">Live board state · the kanban is the interface.</p>
<div class="tiles">
  <div class="tile wait"><div class="v">$(count "Awaiting Confirmation")</div><div class="k">Waiting on you</div></div>
  <div class="tile broke"><div class="v">$(count "Done but Broken")</div><div class="k">Being re-fixed</div></div>
  <div class="tile"><div class="v">$(($(count "Todo")+$(count "In Progress")))</div><div class="k">Queued / building</div></div>
  <div class="tile done"><div class="v">$shipped_today</div><div class="k">Shipped today</div></div>
</div>
<section class="hero">
<h2>Awaiting Confirmation <span class="n">$(count "Awaiting Confirmation")</span></h2>
$(emit_previews)
</section>
<div class="cols">
$(emit_col "Done but Broken" broke)
$(emit_col "In Progress" "")
$(emit_col "Todo" "")
$(emit_col "Ideas" "")
</div>
<footer>Generated by scripts/board-dashboard.sh · ↩N = bounce count · regenerate each operator tick.</footer>
</div>
<script>
// Best-effort liveness freshening. The page is already correct with this
// disabled — data-state comes from previews.sh's TSV at generation time.
// A fetch failure NEVER downgrades a card; it only ever upgrades down→live,
// since a rejected/errored fetch is silently ignored below.
document.querySelectorAll('.pcard[data-url]').forEach(function(el){
  var url = el.getAttribute('data-url');
  if (!url) return;
  fetch(url, {mode:'no-cors', cache:'no-store'}).then(function(){
    el.setAttribute('data-state', 'live');
    var d = el.querySelector('.dot'); if (d) { d.classList.remove('down'); d.classList.add('live'); }
  }).catch(function(){ /* down stays down — never paint a live server as dead */ });
});
</script>
</body></html>
HTML
}

if [ "$MODE" = "serve" ]; then
  SERVE_DIR="${BISMUTH_DASHBOARD_DIR:-/tmp/bismuth-dashboard}"
  mkdir -p "$SERVE_DIR" || { echo "cannot create $SERVE_DIR" >&2; exit 1; }
  render_html > "$SERVE_DIR/index.html"
  if lsof -nP -iTCP:1430 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "index.html rewritten; something is already serving :1430" >&2
  elif command -v python3 >/dev/null 2>&1; then
    nohup python3 -m http.server 1430 --bind 127.0.0.1 --directory "$SERVE_DIR" >/dev/null 2>&1 &
    disown 2>/dev/null || true
  else
    echo "python3 not found — wrote $SERVE_DIR/index.html but cannot serve it" >&2
    exit 1
  fi
  echo "http://localhost:1430"
else
  render_html
fi
