/* app/src/intro/marks.tsx — first-run intro visuals, re-expressed in the ASCII redesign's
   own language (design/ascii-extended, item 5 — self-designed, no specimen). The lockup
   reuses the REAL logo mark shipped in /logos/*.svg; the hero is the system's ONE sanctioned
   decorative flourish (.asc-wordmark's sheen, ui.css/patterns.css) rather than a bespoke
   glow/spin treatment; the daemon/claude panels are plain ASCII terminal chrome (bracket
   session tab, .asc-caret blinking underline) instead of macOS traffic-light dots + a glow
   cursor. Every color comes from the theme CSS vars, so the intro's theme picker re-themes
   all of it live. */
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

// ---- wordmark hero: the logo mark + the system's one flourish (asc-wordmark sheen) -----
// Replaces the old spinning/glowing crystal — the ASCII register limits itself to ONE
// decorative flourish (the wordmark's gradient sheen, ui.css/patterns.css), so the hero
// IS that flourish, not another glow layered around the logo mark.
export function WordmarkHero(props: { icon: string; size?: number }) {
  const size = () => props.size ?? 96;
  return (
    <div class="vi-wordmark-hero">
      <img src={`/logos/${props.icon}.svg`} width={size()} height={size()} alt="" />
      <div class="asc-wordmark vi-wordmark-text">bismuth</div>
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
      {/* Bracket session tab — the terminal chrome's own vocabulary (Terminal.tsx /
          design/ascii-extended's view-terminal.card.html: "[ 1 zsh ]"), not tab shapes
          or macOS traffic-light dots. */}
      <div class="vi-term-bar">
        <span class="vi-term-tab">[ {props.name} ]</span>
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
          <span class="asc-caret">_</span>
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
