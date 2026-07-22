/* app/src/intro/marks.tsx — first-run intro visuals (Solid port of the mock).
   The brand lockup + crystal hero reuse the REAL logo marks shipped in
   /logos/*.svg (spun via CSS); the daemon/claude heroes are static terminal
   panels. Every color comes from the
   theme CSS vars (--bg/--fg/--accent/--grad/--graph-0..4/…) so the intro's theme
   picker re-themes all of it live. */
import { For, type JSX } from "solid-js";

// ---- small persistent brand lockup (logo mark only — no wordmark) ------
export function Lockup(props: { icon: string }) {
  return (
    <div class="vi-lockup">
      <span class="vi-lockup-mark">
        <img src={`/logos/${props.icon}.svg`} width={30} height={30} alt="Bismuth" />
      </span>
    </div>
  );
}

// ---- crystal hero: the real logo mark, glowing + slowly spinning --------
export function CrystalStage(props: { icon: string; size?: number }) {
  const size = () => props.size ?? 240;
  return (
    <div class="vi-crystal" style={{ width: `${size()}px`, height: `${size()}px` }}>
      <div class="vi-crystal-glow" />
      <div class="vi-crystal-ring" />
      <div class="vi-crystal-spin">
        <img src={`/logos/${props.icon}.svg`} width={size() * 0.82} height={size() * 0.82} alt="" />
      </div>
    </div>
  );
}

// ---- daemon / claude terminal panels (static) --------------------------
type TermLine =
  | { p: string; c: string }
  | { user: string }
  | { status: string }
  | { d: string; accent?: string; dd?: string; ok?: string };

const DAEMON_LINES: TermLine[] = [
  { p: "~/vault", c: "❯ bismuth daemon status" },
  { d: "∴ crons", dd: "· 4 scheduled", ok: "running" },
  { d: "∴ weaving memory into graph", ok: "+12 edges" },
  { d: "∴ surfaced", accent: "3 forgotten notes", dd: "from “last spring”" },
  { status: "daemon online — tending the vault" },
];
const CLAUDE_LINES: TermLine[] = [
  { p: "~/vault", c: "❯ claude" },
  { user: "make a base of my unread books, by rating" },
  { d: "∴ bismuth_docs_search", accent: "“bases · query syntax”" },
  { d: "∴ writing reading.md", dd: "· type: base" },
  { status: "created base — table view · 23 rows" },
];

function Line(props: { ln: TermLine }): JSX.Element {
  const ln = props.ln;
  if ("p" in ln)
    return (
      <span>
        <span class="t-pmt">{ln.p} </span>
        <span class="t-cmd">{ln.c}</span>
      </span>
    );
  if ("user" in ln)
    return (
      <span>
        <span class="t-prompt">› </span>
        <span class="t-cmd">{ln.user}</span>
      </span>
    );
  if ("status" in ln)
    return (
      <span>
        <span class="t-on">●</span> <span class="t-status">{ln.status}</span>
      </span>
    );
  return (
    <span>
      <span class="t-dim">{ln.d}</span>
      {ln.accent && (
        <span>
          {" "}
          <span class="t-accent">{ln.accent}</span>
        </span>
      )}
      {ln.dd && <span class="t-dim"> {ln.dd}</span>}
      {ln.ok && <span class="t-dots"> {"·".repeat(14)} </span>}
      {ln.ok && <span class="t-ok">{ln.ok}</span>}
    </span>
  );
}

function TermPanel(props: { name: string; lines: TermLine[] }) {
  return (
    <div class="vi-term">
      <div class="vi-term-bar">
        <span class="vi-term-dot" />
        <span class="vi-term-dot" />
        <span class="vi-term-dot" />
        <span class="vi-term-name">{props.name}</span>
      </div>
      <div class="vi-term-body">
        <For each={props.lines}>
          {(ln, i) => (
            <div class="vi-term-line" style={{ "animation-delay": `${0.15 + i() * 0.28}s` }}>
              <Line ln={ln} />
            </div>
          )}
        </For>
        <div class="vi-term-line" style={{ "animation-delay": `${0.15 + props.lines.length * 0.28}s` }}>
          <span class="t-pmt">~/vault ❯ </span>
          <span class="vi-cursor" />
        </div>
      </div>
    </div>
  );
}

export function DaemonStage() {
  return <TermPanel name="DAEMON · live" lines={DAEMON_LINES} />;
}
export function ClaudeStage() {
  return <TermPanel name="claude code" lines={CLAUDE_LINES} />;
}
