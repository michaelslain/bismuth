# Visual checks

Visual checks verify what `bun test` cannot: what a component actually renders in a browser.
The tools in `bench/` open Storybook stories in a headless Chrome they launch themselves, then measure computed styles, run `play()` assertions, or screenshot the result.
Read this page before changing a component, a stylesheet or a design token.
For unit and integration tests, see [Testing](testing.md).

```bash
cd app && bun run storybook -- -p 6312 --no-open   # start Storybook on a port of your choice
bun run visual                                      # invariants over the stories your diff can affect
bun run verify --port 6312 --prefix ui-modal        # the one-shot proof for a task
```

## Which command do I run?

`bench/` is a top-level directory, not a workspace. Its scripts run as `bun bench/<file>.ts` and no production code imports them.

| Command | Tool | Use it to |
|---|---|---|
| `bun run visual` | `bench/checkChanged.ts` | Check the stories your current diff can affect, with no baseline to maintain. The everyday check |
| `bun run visual:all` | `bench/invariants.ts` | Run the same invariant checks over every story |
| `bun run visual:affected` | `bench/affected.ts` | Print which stories the diff maps to |
| `bun run play` | `bench/playCheck.ts` | Execute each story's `play()` function and grade the result |
| `bun run verify --port <n> --prefix <p>` | `bench/verify.ts` | Prove a task: play, invariants and audit over the stories you name, one verdict |
| `bun run visual:baseline` | `bench/cssBaseline.ts` | Compare computed styles against a baseline you recorded, for a refactor that must change nothing |
| `bun bench/storyAudit.ts` | `bench/storyAudit.ts` | Screenshot every story and flag what looks broken |
| `bun bench/probeStory.ts <story-id>` | `bench/probeStory.ts` | Read the computed styles of one story in seconds |
| `bun run tokens:lint` | `bench/tokenLint.ts` | Fail on a new literal value in a stylesheet where a token belongs |
| `bun bench/moduleClassCheck.ts` | `bench/moduleClassCheck.ts` | Catch a stale class-name literal after a CSS Modules change |

`SKIP` and `UNSAFE` results are not passes. A `SKIP` means nothing was asserted; an `UNSAFE` means the measurement was taken in a hidden tab and is not trustworthy.

## How do I find a story id?

A story's id comes from its `meta.title`, not its file path.
`calendar/components/EventChip.stories.tsx` declares `title: 'Calendar/EventChip'`, so its id is `calendar-eventchip--default`, and the directory nesting contributes nothing.
The part after `--` is the export name in kebab case: `export const WrappingLocation` becomes `--wrapping-location`.

Copy ids from the running server instead of building them by hand:

```bash
curl -s :6006/index.json | jq -r '.entries|keys[]'
```

The browsable URL for an id is `http://localhost:6006/?path=/story/<id>`. A hand-built id does not raise an error: Storybook renders a red "Couldn't find story matching" panel, and a tool that screenshots the page records it as if it were the component.

Every `--story` and `--prefix` flag matches an id exactly or as a prefix.

## How do I start Storybook, and on which port?

Run Storybook from `app/` on a port you choose, and suppress the browser tab:

```bash
cd app && bun run storybook -- -p 6312 --no-open
```

`app/.storybook/preview.ts` already does what the real app does at boot: it loads the fonts and `global.css`, projects the real theme tokens onto `:root` with `settingsToCssVars` over the schema `DEFAULTS`, and installs an in-memory `fakeTransport` so components can call the API.
Do not re-create either per story, and never hardcode a stand-in for a token; a made-up value turns a visual check into a check of the wrong colours.
A toolbar `Theme` control switches among the built-in themes, and a story can set `parameters.tokens` to override `appearance.tokens`.
Shared story fixtures live in `app/src/ui/_*`.

### Why is `--port` required in a worktree?

Every `bench/` tool defaults `--base` to `http://localhost:6006`.
In a git worktree, 6006 is whatever Storybook the main checkout is running, so a forgotten flag measures someone else's files and reports the result as yours.
A running Storybook only sees the checkout it started in.
Start one from your worktree on its own port and pass that port: `bench/verify.ts` and `bench/tableRenderPerf.ts` require `--port`, and the others take `--base http://localhost:<port>`.

## What does each check cover?

### `bench/invariants.ts`: properties that hold under any design

`bun run visual:all` asserts properties that stay true however the design changes, so it needs no baseline and never needs re-recording. It reports these rules:

| Rule | Fires on |
|---|---|
| `text-too-small` | Text under 10px |
| `invisible-text` | Text whose colour equals the background it sits on |
| `control-no-hit-area` | An interactive control that renders with no area |
| `overflows-viewport-x` | A named element past the viewport's right edge |
| `ellipsis-on-inline` | `text-overflow: ellipsis` on an inline box, where it does nothing |
| `ellipsis-needs-min-width` | `text-overflow: ellipsis` on a flex child without `min-width: 0` |
| `font-size-off-scale` | A font size off the chrome type ladder (the `--fs-*` tokens) |

Note prose is deliberately off that ladder.
Its sizes derive from `--prose-font-size` and `--code-font-size`, so the check resolves them from the live page instead of listing literals.
Third-party DOM is skipped, because a stylesheet cannot fix it: CodeMirror, Milkdown, xterm, the pdf.js text layer, KaTeX and Univer popups.
The wrappers you style around them are still checked.

```bash
bun bench/invariants.ts --story ui-        # a prefix; repeat the flag or comma-join several
bun bench/invariants.ts --json             # machine-readable output
```

It exits 1 on any finding or any story that rendered blank.
`bun run visual` (`bench/checkChanged.ts`) runs it over only the stories `bench/affected.ts` maps from your diff: a `Foo.tsx` or `Foo.module.css` maps to `Foo.stories.tsx`.
When `app/src/global.css`, `core/src/theme/tokens.ts` or `app/.storybook/preview.ts` changed, it prints that no scoping is possible and checks every story.
`--base <ref>` diffs against another ref, and `--all` ignores the diff.

### `bench/playCheck.ts`: running `play()`

`bun run play` runs each story's `play()` function in a real Storybook preview and grades what happened. No other tool executes `play()` assertions, and the repo has no Storybook test runner.

| Outcome | Meaning |
|---|---|
| `PASS` | The story rendered, `play()` ran, nothing threw, and the tab stayed visible |
| `FAIL` | `play()` threw; the real error and story id are printed |
| `SKIP` | The story has no `play()` function; nothing was asserted |
| `ERROR` | The story never reached `play()`: a broken import, a throw on mount, or a hang past `--timeout` |
| `UNSAFE` | `play()` ran cleanly but `document.visibilityState` was `hidden` at some point |

It exits 1 on any `FAIL`, `ERROR` or `UNSAFE`. A run of only `SKIP` exits 0, because having nothing to assert is not a failure of the tool, though it may be a gap in the story. Scope it with `--story <prefix>`. It looks at no pixels: a story can pass here and still look wrong.

Treat an `UNSAFE` result as a bug in `core/src/render/chromeSession.ts`'s focus emulation, not as a flaky story. Canvas stories that paint on `requestAnimationFrame` (`InkOverlay`, `GraphView`, `DrawingCanvas`) measure a blank surface in a hidden tab.

### `bench/verify.ts`: the one-shot proof for a task

`bun run verify` boots Storybook if nothing answers on `--port`, or reuses one that does. It runs `playCheck.ts`, `invariants.ts` and `storyAudit.ts` over each `--prefix`, then prints one summary ending in `RESULT: PASS` or `RESULT: FAIL` and exits 0 or 1 to match.

```bash
bun run verify --port <n> --prefix <story-id-prefix> [--prefix <p> ...] \
    [--baseline <dir>] [--out <dir>] [--app <dir>] [--keep] [--boot-timeout <ms>]
```

`--port` and at least one `--prefix` are required.
`--baseline` names a `storyAudit` output directory (or its `shots` directory) to hash shots against.
`--out` defaults to `.claude/audit`, `--app` to `app/`, and `--boot-timeout` to 120000 ms.
`--keep` leaves a Storybook that `verify` started itself running.

The verdict is `FAIL` when Storybook fails to boot, a tool prints non-JSON output (for example `no stories matched` for an unknown prefix), `playCheck` reports any fail, error or unsafe, `invariants` exits non-zero, or `storyAudit` raises a hard flag (`empty-render`, `crashed` or `probe-failed`).
Other audit flags are leads and never fail the run.
A prefix with only `SKIP` results never fails but prints `(nothing asserted)`.
Shot differences against a baseline are information, not failures.

### `bench/storyAudit.ts`: which stories look broken

`bench/storyAudit.ts` screenshots every story and flags geometry that is visibly wrong.
It holds no history and never fails a build; a flag is a question, and a story with no flags is un-flagged, not certified.
It writes `report.json` and 2x screenshots under `--out` (default `.claude/audit/`), and prints a count per flag kind.

| Flag | Meaning |
|---|---|
| `empty-render`, `crashed`, `probe-failed` | Hard flags: nothing rendered, the page crashed, or the probe failed |
| `clip-x`, `clip-y` | Content wider (or text taller) than its box, with the overflow hidden |
| `offscreen-left`, `offscreen-right` | A painted element beyond the viewport edge |
| `zero-size` | An element with text that occupies no space |
| `invisible-text`, `tiny-font` | Text the same colour as its background, or under 8px |
| `ellipsis-active` | Text truncated by an ellipsis; may be intended, so a human decides |

Signals miss geometrically legal wrongness, which is why the screenshots exist: a calendar that clips two week rows still reports its full cell count, and a card stuck on "Loading…" renders seven happy elements.
Read the screenshots of any story you changed.
A story whose emptiness is the behaviour under test (a hidden overlay host, a dismissed modal) is exempt by exact id in `EMPTY_BY_DESIGN`, each with the `play()` that asserts it; an exempt story that starts rendering raises a `stale-exemption` lead.

It waits for each story to paint (`--ready-timeout`, default 6000 ms) before it converges, and re-checks anything still empty alone with a doubled timeout, so "slow under load" reads differently from "renders nothing".

### `bench/cssBaseline.ts`: the computed-style baseline

`bun run visual:baseline` records the exact computed value of every property on every element in every story, then compares later runs against that recording.
It is maximally sensitive: it cannot tell a deliberate restyle from a regression, so it is not the habitual check.
Use it before a refactor that must change nothing visually.

```bash
bun run visual:baseline -- --update   # record on the base commit
bun run visual:baseline               # after the change: diff against the recording
bun run visual:baseline -- --story ui-modal   # one component
```

The recording lives at `bench/css-baseline.json` and is gitignored; a failing run also writes `bench/css-baseline.drift.txt`.
The run exits 1 when anything drifted.
Before it reads values, the tool removes four sources of noise: it disables keyframe animations, waits for web fonts, freezes the clock and timezone, and re-probes each story until its output is stable instead of sleeping a fixed time.

A small inline element can flip height by 2px (with `top` shifting by 1) between runs in stories that host a CodeMirror editor, such as `editor-`, `app-chatview`, `chat-chatcomposer`, `preview-` and `daemon-daemonchat`.
It is CodeMirror's own cursor overlay, whose position is written by a one-shot measurement that can land late under pooled load.
Drift of only that shape on only that element is a known flake, not a regression; any other drift is real.
Tune the run with `--concurrency`, `--settle`, `--stable`, `--wait` and `--tries`.

### `bench/probeStory.ts`: one story, five seconds

`bun bench/probeStory.ts <story-id>` prints computed styles for one story in its resting state.
Use it in the loop of editing one component's CSS, where the full baseline is too slow.
It keys every element by tag and `nth-of-type` path from the story root, never by class name, because a CSS Modules change renames every class.
Narrow it with `--select "<css selector>"` and `--props a,b,c`; `--json` and `--html` change the output.
It reads no baseline, hovers and focuses nothing, and measures only what the story renders.

### `bench/templateDiff.ts`: did a refactor change the markup?

`bun bench/templateDiff.ts <A> <B>` compiles both sides through the repo's own Solid compiler and diffs the static template string it emits, which ignores reindentation, renamed handlers and how props are threaded.
Each side is a file path or `<git-ref>:<path>` (for example `HEAD:app/src/App.tsx`).
By default the templates must be byte-equal; `--modulo-class` requires equality after stripping every `class` attribute, which is the CSS half of a migration.
`--lines N-M` (or `--lines-a` and `--lines-b`) restricts each side, `--index N` selects one template, and `--verbose` prints more.
It proves nothing about CSS or the dynamic parts of the tree.

### `bench/moduleClassCheck.ts`: stale class literals

A CSS module class is hashed at build time (`.ft-row` becomes `._ft-row_163am_18`) and reachable only through the imported `styles` object.
A call site that kept `class="ft-row"` still compiles and renders but matches nothing.
`bench/moduleClassCheck.ts` builds the app and cross-checks the emitted CSS against the emitted JS with three checks:

1. **Reachable.** Every hashed class in the CSS is reached from the JS through its module's `styles` map.
2. **No unhashed literal.** No module-owned class name appears as a literal `class` attribute in a compiled template.
3. **Name collisions.** A name declared by both a module and a global stylesheet is a warning to judge, not a failure.

It compares names only: a changed declaration, a specificity change or a cascade-order change passes.
A module whose `styles` object is indexed by a runtime key is reported as unchecked, not passed.
Flags: `--skip-build` reuses an existing build, `--dist <dir>` names the build output, `--verbose` prints warnings.
The commit gate runs it only when a staged path is a stylesheet; run it by hand after a `.tsx`-only change to class names.

### How do the design-system gate and tokenLint work?

The commit gate runs both whenever a staged path touches `app/src/`, `DESIGN.md`, `design/` or `scripts/designSystem/`.

**The design-system gate** (`node scripts/designSystem/gate.mjs --root .`, also run by `bun test scripts/designSystem.test.ts`) reads the `governance:` block in `DESIGN.md` and scans `app/src/` for these checks:

| Check | Finds |
|---|---|
| `bareElement` | A bare `<p>`, `<span>`, `<h1>`–`<h6>`, `<button>`, `<input>`, `<textarea>`, `<select>` or `<label>` where a `ui/` primitive belongs |
| `oneImporter` | A `.module.css` with more than one importer |
| `storyCoverage` | A component with no sibling `{name}.stories.tsx` |
| `propsDestructure` | A Solid component that destructures its props |
| `hardcodedColor`, `hardcodedFontSize`, `hardcodedRadius`, `hardcodedFont` | A literal value where a token belongs |
| `globalReach` | A component stylesheet reaching a class it does not own through `:global()` |
| `oneGlobalFile` | A global layer that spans more than one stylesheet; `@import` does not count |
| `ignoreReason` | A `design-system-ignore` comment with no reason, or naming no known check |

Accepted debt lives in `design/baseline.json` as `{ "accepted": [{ "check", "path", "count" }] }`.
The count caps how many findings of one check one file may carry, never a line number.
The baseline only ratchets down: findings beyond a count fail, and an entry that accepts more than now exists is stale and also fails.
`--prune` shrinks it to what still exists and `--init` writes it once; neither can add or raise an entry.
Deleting the file runs the gate at zero.
Permanent exceptions belong in the `governance` block (`stories.exempt`, `global`), and a single line is exempted with a `design-system-ignore <check-id>: <reason>` comment on that line or the line above.

**`bench/tokenLint.ts`** scans every `app/src/**/*.css` declaration for a magic value that should be a token:

| Rule | Flags |
|---|---|
| `radius-literal` | A non-zero px `border-radius` (`50%` is allowed) |
| `spacing-literal` | A non-zero px `padding`, `margin`, `gap` or `inset` |
| `shadow-blur` | A `box-shadow` with a non-zero blur |
| `backdrop-filter` | Any `backdrop-filter` other than `none` |
| `hex-color` | A hex or `rgb()` colour, including inside custom properties |

It compares against `bench/token-lint-baseline.json`, keyed by file, rule and exact literal text with a count, so fixing four of six `padding: 8px` literals never masks a seventh, different one.
Only a new violation fails.
The two tools overlap on colour and radius but disagree about what to skip.
The design-system gate checks a fixed list of properties and excuses a literal inside a `var()` fallback; tokenLint checks colour on every property, custom properties included, and flags the fallback literal.
Font size is checked only by the design-system gate.

```bash
bun bench/tokenLint.ts                          # new violations only; exit 1 if any
bun bench/tokenLint.ts --list                   # every current violation, grouped by file
bun bench/tokenLint.ts --list --rule spacing-literal --file ViewBar
bun bench/tokenLint.ts --bless                  # overwrite the baseline with the current set
```

`--bless` ends a deliberate sweep, like `bun run test:bless-schema` for the settings schema.

### Performance and measurement tools

These tools measure rather than judge. Each takes its own flags; read the header comment of the file before trusting a number.

| Tool | Measures | Run |
|---|---|---|
| `bench/tableRenderPerf.ts` | The Bases table on `bases-tableview--large-table`: median cold render time and scroll frames per second | `bun bench/tableRenderPerf.ts --port <n>` (`--port` required) |
| `bench/pdfScroll.ts` | Whether PDF pages paint before the reader scrolls to them, in `preview-pdfpages--many-pages` by default | `bun bench/pdfScroll.ts [<story-id>] --base <url> --duration <ms>` |
| `bench/appShots.ts` | Deterministic screenshots of the running app (not Storybook), waiting for canvas ink to settle | `bun bench/appShots.ts --base http://localhost:1422 --out shots/ [--shot <name>]` |
| `bench/layoutquality.ts` | Graph layout quality over a real vault through the production cold path; read-only, so use a copy | `bun bench/layoutquality.ts --vault <path> [--label <name>] [--out <file>]` |
| `bench/bench.ts` | Backend hot paths (`listTree`, search, task evaluation) over a synthetic vault, with worst event-loop stall | `bun bench/bench.ts --vault-size 2000 --label current` |
| `bench/basesPerfBench.ts` | Bases and tasks timing over a synthetic vault; compare the printed tables before and after a change | `bun run bench:bases-perf` |
| `bench/recallEval.ts` | Memory-recall rankers against labelled cases; `--service [--embeddings off\|on] [--explain]` runs them through the real recall service | `bun bench/recallEval.ts --dir <memoryDir> --cases <file>` |
| `bench/watch.sh` | A live progress view of a running `cssBaseline` or `storyAudit` sweep | `bash bench/watch.sh` in a second terminal |

## How it works

**One Chrome, many targets.** `bench/chromeSession.ts` re-exports `core/src/render/chromeSession.ts`, the only place that launches headless Chrome and tears it down; the export pipeline uses the same launcher.
Each tool launches its own browser instead of driving your tab because `GraphView` pauses its animation loop when `document.visibilityState` is `hidden`, and an automation tab that is not in the foreground reports exactly that, so the canvas samples as blank.
The launcher passes the three `--disable-*background*` flags and calls `Emulation.setFocusEmulationEnabled` on every concurrent target, which keeps `requestAnimationFrame` running on all of them.

**Pool size is derived.** `bench/poolSize.ts` returns the smaller of a CPU budget (cores minus one) and a memory budget (half of free memory at about 120 MB per target), clamped to at least 2 and at most a ceiling the caller passes: 8 for `invariants`, `playCheck` and `cssBaseline`, 12 for `storyAudit`.
`--concurrency` overrides it.
The ceiling stays low because a CPU-starved story mounts late, and a late mount produces a mid-mount capture.

**Readiness is polled, not slept.** `bench/storyReady.ts` exports the page expression that counts painted elements in the story root and in portals under `document.body` (modals render there), excluding Storybook's own dormant chrome. `invariants` and `storyAudit` poll it before measuring.

**Shared helpers.** `bench/args.ts` reads flags (`arg`, `has`, `argAll`) and loads the story index from `<base>/index.json`; a value that starts with `--` is never taken as a flag's value.
`bench/verifyReport.ts` holds the pure half of `verify`: argument parsing, the shot-hash diff, the verdict rule and the summary text, unit-tested in `bench/verifyReport.test.ts`.
`bench/clipBox.ts` holds the screenshot clip rectangle that `storyAudit` shares with its test.
`bench/affected.ts` is tested in `bench/affected.test.ts`.

Source: `bench/`, `core/src/render/chromeSession.ts`, `scripts/gate.ts`, `scripts/designSystem/`, `DESIGN.md`, `design/baseline.json`, `app/.storybook/preview.ts`, `package.json`
