# Visibility acceptance run — 2026-07-30

An adversarial pass against the multi-backend visibility work: build a vault that hides things, then
try to read them by every route an ordinary agent would reach for. Recorded because every real defect
in this feature was found by attacking it, never by reading it.

**Method.** One temp vault: `Private/` marked `hidden` via `folderVisibility` in `.settings`,
containing `secret.md`, `notes.txt`, `report.pdf`, `sketch.draw` and its `sketch.draw.png` export
sidecar; a `chat-only` note at the root; an ordinary visible note; and a git history that committed
everything in plaintext *before* it was hidden. Every file carries a unique `SENTINEL-…` string, and
a probe counts as a LEAK if any sentinel appears in its output.

## What the deny list resolves to

```
chat    Private/notes.txt, Private/report.pdf, Private/secret.md, Private/sketch.draw, Private/sketch.draw.png
daemon  …the same five, plus notes-chat.md
```

Both tiers behave as designed: the folder cascade covers **every extension** (the old
extension-allowlist walk would have missed `.txt` and `.pdf` entirely), the `.draw.png` export
sidecar inherits its source's restriction, and `chat-only` restricts only the daemon channel.

## CLI — agent channel vs owner

| Probe (`BISMUTH_AGENT_CHANNEL=daemon`) | Result |
| --- | --- |
| `read Private/secret.md` | closed |
| `read Private/notes.txt` | closed |
| `read Private/report.pdf` | closed |
| `read Private/sketch.draw.png` | closed |
| `read private/SECRET.md` (case variant) | closed |
| `read ./Private/secret.md` (`./` prefix) | closed |
| `checkpoint diff` (git diff = plaintext of changed notes) | closed |
| `search SENTINEL` | closed |
| `tree` | closed |
| `export Private/secret.md` | closed |
| `api GET /file?path=Private/secret.md` | closed |
| `read notes-chat.md` (chat-only, on the daemon channel) | closed |

On the **chat** channel, `notes-chat.md` reads fine and `Private/secret.md` stays closed — the middle
tier working exactly as intended.

With `BISMUTH_AGENT_CHANNEL` **unset**, every one of these succeeds. That is the requirement, not a
gap: visibility restricts Bismuth's own agent sessions, never the vault owner.

## HTTP — the biggest hole, now closed

| Probe | Tokenless (an agent with `curl`) | With owner token (the app) |
| --- | --- | --- |
| `GET /file?path=Private/secret.md` | closed | reads it (correct) |
| `GET /asset?path=Private/report.pdf` | closed | — |
| `GET /asset?path=Private/sketch.draw.png` | closed | — |
| `POST /search {"query":"SENTINEL"}` | closed | — |
| `GET /graph` | closed | — |
| `GET /version` | 200 (deliberately exempt — health/discovery) | 200 |

Before this work, the tokenless column was a full content oracle: `curl
'localhost:4321/file?path=Private/secret.md'` returned the note regardless of any tool-level gate, so
it defeated every other layer for every backend.

## OS sandbox (Seatbelt) — the non-Claude enforcement mechanism

Profile built by `buildSeatbeltProfile(buildSandboxDenyPaths(...))`, commands run under
`sandbox-exec -f`:

| Probe | Exit | Result |
| --- | --- | --- |
| `cat Private/secret.md` | 1 | closed |
| `cat Private/notes.txt` | 1 | closed |
| `cat Private/sketch.draw.png` | 1 | closed |
| **`cat open.md` (visible)** | **0** | **reads normally — the deny is selective, not blanket** |
| `grep -r SENTINEL-HIDDEN <vault>` | 2 | closed |
| `git show HEAD:Private/secret.md` | 128 | closed |
| `git log -p` | 128 | closed |

The last two matter on their own: `backup.ts` snapshots the vault, so a note hidden today was
committed in plaintext yesterday and readable straight out of history until `.git` was added to the
deny list.

## Defects this run found

1. **An empty `BISMUTH_AGENT_CHANNEL` locked the OWNER out of their own CLI.** Truly-unset was handled
   correctly, but `export BISMUTH_AGENT_CHANNEL=` — ordinary in a human's shell — fell through to the
   "garbled ⇒ strictest" branch. Bismuth never writes an empty value itself, so an empty one can only
   have come from the owner. Fixed to treat empty as absent, with a regression test; the pre-existing
   test asserting the old behaviour was updated deliberately, not deleted.
2. **`GET /asset` was unfiltered**, so a hidden PDF, image or drawing was one `curl` away even though
   `GET /file` was gated. Now channel-filtered like every other content route.

Two further "leaks" in the raw output were **my own harness being wrong**, and are recorded because
the distinction matters: a `.txt` reported as leaking before the fixture actually marked its folder
hidden, and a blanket `exit=65` from every sandboxed command that turned out to be a bad call
signature in the probe script (`wrapArgv` takes a profile *path*, not an options object), not a
broken wrapper.

## What is NOT verified

- **No live agent turn was run in this pass.** The Seatbelt table proves the *mechanism* denies direct
  reads, shell fallbacks and git history. An earlier spike separately recorded a real `opencode` turn
  with both the read tool and a `bash: cat` denied, but that was against an earlier implementation.
  opencode's `visibilityGate: {chat: "wrapper-macos"}` therefore rests on mechanism-level proof plus
  that earlier run — not on an end-to-end turn against this code.
- **codex, cline, gemini, goose are not installed here**, so nothing about them was exercised. They
  are all `"none"` in the catalog and refused by the chokepoint, which is the honest posture.
- **Linux and Windows are entirely untested.** The wrapper is macOS-only; on other platforms
  non-Claude backends are refused rather than silently unprotected.
- **`~/.bismuth/bin/bismuth-mcp` predates the MCP gate** and must be reinstalled before that layer
  takes effect on this machine.
