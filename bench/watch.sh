#!/usr/bin/env bash
# Live view of a running bench sweep. Run it in a second terminal or a split pane:
#
#     bash bench/watch.sh
#
# WHY THIS EXISTS. Claude Code's status line is a CALLBACK, not a process: the host runs the
# configured command and paints its output as part of drawing the UI, and it draws the UI when
# something happens in the session. Sitting idle, the command is never executed, so the number on
# screen is whatever it printed last — indistinguishable from a live reading, which is exactly how a
# stalled sweep can look healthy and a healthy one can look stalled. This loop has its own timer, so
# what it shows is always current.
#
# Reads the beacon that bench/cssBaseline.ts and bench/storyAudit.ts write once per story:
#     "<label> <done> <total> <startEpochMs>"
BEACON=/tmp/bismuth-bench.progress

printf 'watching %s — ctrl-c to stop\n\n' "$BEACON"

while :; do
    if pgrep -f 'bench/(cssBaseline|storyAudit)\.ts' >/dev/null 2>&1; then
        line=$(cat "$BEACON" 2>/dev/null)
        printf '\r\033[K%s' "$(awk -v now="$(date +%s)" '{
            if (NF < 4) { printf "%s", $0; exit }
            done_n = $2 + 0; total = $3 + 0; elapsed = now - int($4 / 1000)
            pct = total > 0 ? done_n * 100 / total : 0
            # Bar plus a MEASURED eta — elapsed/done, not a per-story constant. Cost varies hugely
            # between a story that mounts a spreadsheet and one that draws a dot, so a fixed guess
            # would be wrong at both ends of a run while a measured rate self-corrects.
            width = 30; filled = int(pct * width / 100)
            bar = ""
            for (i = 0; i < width; i++) bar = bar (i < filled ? "#" : ".")
            eta = "estimating"
            if (done_n > 0 && total > done_n && elapsed > 0) {
                left = int(elapsed / done_n * (total - done_n))
                eta = left >= 60 ? sprintf("~%dm%02ds left", int(left/60), left%60) : sprintf("~%ds left", left)
            } else if (total > 0 && done_n >= total) eta = "finishing"
            printf "%s [%s] %d/%d  %d%%  %s  (%ds elapsed)", $1, bar, done_n, total, pct, eta, elapsed
        }' <<<"$line")"
    else
        printf '\r\033[Kno sweep running'
    fi
    sleep 1
done
