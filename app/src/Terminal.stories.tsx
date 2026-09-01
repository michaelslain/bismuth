// Visual spec for <TerminalTab> — the in-app terminal (xterm.js bridged to a real PTY over a
// `WebSocket` to `${wsBase()}/terminal?...`, see Terminal.tsx). There is no offline path: the
// terminal genuinely IS a remote shell, so this story's only honest goal is STATIC coverage —
// proving the xterm chrome mounts and the ANSI palette derived from the live theme tokens
// (`buildTerminalTheme`, driven by --rail/--danger/--green/--gold/--blue/--violet/--teal/
// --term-fg/--term-bg) renders correctly. Real interactivity (typing, resize, drag-drop) needs a
// live PTY on the other end and is deliberately out of scope.
//
// Protocol, read directly from Terminal.tsx rather than guessed: OUTGOING frames (stdin/resize)
// are prefixed (`stdinFrame` = 0x00 + raw bytes, `resizeFrame` = 0x01 + little-endian u16
// cols/rows) — but INCOMING backend->terminal data has NO envelope at all:
//   ws.onmessage = (ev) => { pending.push(new Uint8Array(ev.data as ArrayBuffer)); ... }
// writes it straight through to `term.write()` (coalesced per animation frame). So the fake
// socket below just hands back raw ArrayBuffers of UTF-8-encoded ANSI text — no JSON, no prefix.
//
// The fake is installed as `globalThis.WebSocket` for the story's lifetime only, inside a wrapper
// component's onMount — BEFORE <TerminalTab> mounts and calls `new WebSocket(...)` — and restored
// in the wrapper's onCleanup (see FakeSocketTerminal below; same onMount/onCleanup
// install-then-restore shape CalendarView.stories.tsx uses for its seeded-state wrapper).
// Restoring is mandatory: a leaked global would corrupt every story loaded afterward in the same
// Storybook session.
import { onCleanup, onMount } from 'solid-js'
import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { expect, waitFor } from 'storybook/test'
import { TerminalTab } from './Terminal'
import type { NativeDragDetail } from './nativeDrop'

// --- Fake WebSocket, matching only the surface Terminal.tsx actually touches ------------------
// `binaryType`, the on* handler properties, `.send()` (ignored — no live PTY on the other end to
// receive stdin/resize frames), `.close()`, `.readyState`, and the `OPEN`/etc numeric constants
// (Terminal.tsx reads `ws.readyState !== WebSocket.OPEN`; since we replace the global, the bare
// `WebSocket` identifier there resolves to THIS class, so the statics must exist).
function makeFakeSocketClass(frames: string[], sent: Uint8Array[]) {
    return class FakeTerminalSocket {
        static readonly CONNECTING = 0
        static readonly OPEN = 1
        static readonly CLOSING = 2
        static readonly CLOSED = 3

        readyState = FakeTerminalSocket.CONNECTING
        binaryType: 'blob' | 'arraybuffer' = 'blob'
        onopen: ((ev: Event) => void) | null = null
        onmessage: ((ev: MessageEvent) => void) | null = null
        onclose: ((ev: CloseEvent) => void) | null = null
        onerror: ((ev: Event) => void) | null = null

        constructor(public url: string) {
            // Defer past the current microtask: Terminal.tsx assigns onopen/onmessage/onclose
            // synchronously right after `new WebSocket(...)` returns, and a real WebSocket never
            // opens synchronously inside its own constructor either — firing here guarantees the
            // handlers are already attached by the time we call them.
            queueMicrotask(() => {
                this.readyState = FakeTerminalSocket.OPEN
                this.onopen?.(new Event('open'))
                for (const frame of frames) {
                    const bytes = new TextEncoder().encode(frame)
                    this.onmessage?.({
                        data: bytes.buffer,
                    } as unknown as MessageEvent)
                }
            })
        }

        send(data: Uint8Array): void {
            // Record what Terminal.tsx actually sent, so a story can assert on it — stdin frames
            // are 0x00-prefixed raw bytes, resize frames are 0x01-prefixed (stdinFrame/resizeFrame
            // in Terminal.tsx). Static coverage only: nothing is listening on the other end, this
            // array exists purely for a story's own assertions.
            sent.push(data)
        }

        close(): void {
            this.readyState = FakeTerminalSocket.CLOSED
        }
    }
}

/** Installs the fake as `globalThis.WebSocket`; returns a restore function plus the `sent` array
 *  every `send()` call appends its raw frame bytes to. The array is created and returned before
 *  any socket instance exists, so a story can assert "nothing sent yet" even while `ws` is still
 *  `undefined` (before Terminal.tsx has called `new WebSocket(...)` at all). */
function installFakeSocket(frames: string[]): {
    restore: () => void
    sent: Uint8Array[]
} {
    const original = globalThis.WebSocket
    const sent: Uint8Array[] = []
    globalThis.WebSocket = makeFakeSocketClass(
        frames,
        sent,
    ) as unknown as typeof WebSocket
    return {
        restore: () => {
            globalThis.WebSocket = original
        },
        sent,
    }
}

// --- Fake, controllable `document.fonts.load` -------------------------------------------------
// Terminal.tsx awaits `document.fonts.load(...)` before it ever opens xterm or creates the
// WebSocket (see Terminal.tsx's onMount). The real Font Loading API promise settles on its own
// schedule — often fast enough that a story racing it (firing an assertion and hoping the await
// hasn't resolved yet) is really racing the machine and the font cache, not the defect it means to
// prove. This holds that await pending on purpose until a story calls `resolve()`.
function installPendingFontLoad(): { resolve: () => void; restore: () => void } {
    const original = document.fonts.load
    let settle: () => void = () => {}
    const pending = new Promise<FontFace[]>(res => {
        settle = () => res([])
    })
    document.fonts.load = (() => pending) as typeof document.fonts.load
    return {
        resolve: () => settle(),
        restore: () => {
            document.fonts.load = original
        },
    }
}

/** Wraps <TerminalTab> with the fake socket's install/restore lifecycle, scoped to exactly this
 *  story instance. `onMount` here is registered (and — per Solid's effect-flush order — fires)
 *  before TerminalTab's own `onMount`, and even if it didn't, TerminalTab awaits a font load
 *  before ever touching `WebSocket`, so the swap is guaranteed to land first either way. */
function FakeSocketTerminal(props: { id: string; frames: string[] }) {
    let restore: () => void = () => {}
    onMount(() => {
        restore = installFakeSocket(props.frames).restore
    })
    onCleanup(() => restore())
    return <TerminalTab id={props.id} active={() => true} />
}

/** Wraps <TerminalTab> with BOTH fakes: the socket (as FakeSocketTerminal does) AND a
 *  controllable `document.fonts.load` held pending until the story calls `resolveFonts`. Exists
 *  for stories that need to observe behavior DURING the startup window — before xterm opens,
 *  before the WebSocket exists at all — deterministically, rather than racing a real font load
 *  the way `FakeSocketTerminal` alone would. `onReady` hands the story both handles once they're
 *  installed, which (per Solid's effect-flush order — registered here, on the PARENT, before
 *  TerminalTab's own onMount runs; same guarantee FakeSocketTerminal's comment above documents)
 *  is always before TerminalTab's onMount body ever calls `document.fonts.load(...)`. */
function PendingFontTerminal(props: {
    id: string
    frames: string[]
    onReady: (handles: { resolveFonts: () => void; sent: Uint8Array[] }) => void
}) {
    let restoreSocket: () => void = () => {}
    let restoreFonts: () => void = () => {}
    onMount(() => {
        const socket = installFakeSocket(props.frames)
        restoreSocket = socket.restore
        const fonts = installPendingFontLoad()
        restoreFonts = fonts.restore
        props.onReady({ resolveFonts: fonts.resolve, sent: socket.sent })
    })
    onCleanup(() => {
        restoreSocket()
        restoreFonts()
    })
    return <TerminalTab id={props.id} active={() => true} />
}

const meta = {
    title: 'App/Terminal',
    component: TerminalTab,
    parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof TerminalTab>

export default meta
type Story = StoryObj<typeof meta>

// Fixed px, not vh/%: matches GraphView.stories.tsx's own note — the Storybook preview iframe is
// short with the Controls panel open, and `.term-host` fills its parent's height (Terminal.css:
// `.term-host { height: 100% }`).
const STORY_H = '480px'

const PROMPT =
    '\x1b[1;32muser\x1b[0m@\x1b[1;32mbismuth\x1b[0m:\x1b[1;34m~/vault\x1b[0m$ '

/** A shell prompt, a colored `ls -la` listing (directories bold-blue, an executable bold-green, a
 *  symlink bold-cyan, a "modified" file bold-red, one plain default-fg file), and a second prompt
 *  — the everyday transcript a real terminal tab shows, run through xterm's own SGR parser
 *  instead of a hand-laid-out DOM approximation. */
export const Default: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <FakeSocketTerminal
                id="story-terminal-default"
                frames={[
                    `${PROMPT}ls -la\r\n`,
                    '\x1b[1;34mattachments\x1b[0m\r\n' +
                        '\x1b[1;34mthoughts\x1b[0m\r\n' +
                        '\x1b[1;31mREADME.md\x1b[0m\r\n' +
                        '\x1b[1;32minstall.sh\x1b[0m\r\n' +
                        'notes.md\r\n' +
                        '\x1b[1;36mdaily-note.md\x1b[0m\r\n',
                    PROMPT,
                ]}
            />
        </div>
    ),
}

// #55/declarative-classlist: proves the drop-affordance ring (`.term-drop-active`, driven by a
// `createSignal` + JSX `classList` prop in Terminal.tsx, not a raw `container.classList.toggle`)
// tracks native-drag state correctly — appears while the cursor is over THIS terminal, and clears
// both when the cursor leaves the terminal's rect and when the drag ends. Dispatches the
// `bismuth-native-drag` window CustomEvent directly (see nativeDrop.ts) rather than constructing a
// full HTML5 DataTransfer — same listener, same `setDropActive` call sites, far more reliable to
// synthesize in a real-browser play. Coordinates are read from the live `.term-host` rect so the
// "inside" test never depends on a hand-guessed pixel offset.
export const DropAffordance: Story = {
    render: () => (
        <div style={{ height: STORY_H, width: '100%' }}>
            <FakeSocketTerminal id="story-terminal-drop" frames={[PROMPT]} />
        </div>
    ),
    play: async ({ canvasElement }) => {
        const host = canvasElement.querySelector('.term-host')
        if (!(host instanceof HTMLElement))
            throw new Error('.term-host not found')

        // Terminal.tsx's onMount is async — it awaits a font load before xterm ever opens into
        // `.term-host`. The dragover/`bismuth-native-drag` listeners USED TO attach only after
        // that same await, which made this poll load-bearing: firing the drag event before xterm
        // mounted was a no-op, since nothing was listening yet. That is now fixed — the listeners
        // attach synchronously before the await (see Terminal.tsx's comment at the attach site) —
        // so this poll is no longer required for correctness here; `DropAffordanceBeforeFontLoad`
        // below is the regression test that asserts the ring lights up WITHOUT waiting for
        // `.xterm`, which is exactly the window this poll used to work around. Left in place
        // anyway since it costs nothing and keeps this story waiting for the terminal to actually
        // be visible before it drives a drag across it.
        await waitFor(() => {
            if (!host.querySelector('.xterm'))
                throw new Error('xterm has not mounted yet')
        })

        const fire = (detail: NativeDragDetail) =>
            window.dispatchEvent(
                new CustomEvent('bismuth-native-drag', { detail }),
            )
        const rect = host.getBoundingClientRect()
        const inside = {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
        }
        const outside = { x: -9999, y: -9999 }

        // Cursor enters the terminal carrying a path → ring shows.
        fire({ type: 'enter', paths: ['/tmp/dropped.txt'], ...inside })
        await expect(host.classList.contains('term-drop-active')).toBe(true)

        // Cursor drags on, past the terminal's own rect → ring clears (this is the routing the
        // shared `pointInDropRect` predicate protects: only the terminal the cursor is actually
        // over may claim the drop).
        fire({ type: 'over', paths: [], ...outside })
        await expect(host.classList.contains('term-drop-active')).toBe(false)

        // Re-enter, then drop → ring clears again (the drop path always drives it back to false).
        fire({ type: 'over', paths: [], ...inside })
        await expect(host.classList.contains('term-drop-active')).toBe(true)
        fire({ type: 'drop', paths: ['/tmp/dropped.txt'], ...inside })
        await expect(host.classList.contains('term-drop-active')).toBe(false)
    },
}

/** The drop affordance must be live from the FIRST frame. Terminal's onMount awaits a font load
 *  before it opens xterm, and the drag listeners used to be attached only after that await — so
 *  for a real user there was a window right after opening a terminal where a dragged file
 *  produced no ring and no path. Fires a dragover on the host IMMEDIATELY, without waiting for
 *  `.xterm` (the readiness marker the other stories poll for), which is the whole point.
 *
 *  Uses `PendingFontTerminal` rather than `FakeSocketTerminal` so the font-load await is held
 *  open ON PURPOSE: with a real (or `FakeSocketTerminal`'s un-mocked) `document.fonts.load`, the
 *  `.xterm` guard below only holds because the await happens not to have resolved yet by the time
 *  this assertion runs — nothing enforces that, so on a warm font cache or a faster machine it
 *  could flip and fail for a reason unrelated to the defect it guards. Holding fonts pending makes
 *  ".xterm has not mounted" a fact instead of a race won by luck. */
export const DropAffordanceBeforeFontLoad: Story = (() => {
    let handles: { resolveFonts: () => void; sent: Uint8Array[] } | undefined
    return {
        render: () => (
            <div style={{ height: STORY_H, width: '100%' }}>
                <PendingFontTerminal
                    id="story-terminal-drop-early"
                    frames={[PROMPT]}
                    onReady={h => {
                        handles = h
                    }}
                />
            </div>
        ),
        play: async ({ canvasElement }) => {
            const host = canvasElement.querySelector('.term-host')
            if (!(host instanceof HTMLElement))
                throw new Error('.term-host not found')

            // Deliberately NOT waiting for `.xterm`, and fonts are genuinely pending (see the
            // story doc comment) — so this is a fact, not a hope. The DropAffordance story above
            // polls for `.xterm` and its comment explains why: xterm mounting was the only
            // observable signal that the post-await continuation — which used to include
            // attaching these listeners — had run. That poll was a workaround for this defect.
            // Asserting `.xterm` is still absent here is what makes this story a regression test
            // rather than a duplicate.
            await expect(host.querySelector('.xterm')).toBeNull()

            const fire = (detail: NativeDragDetail) =>
                window.dispatchEvent(
                    new CustomEvent('bismuth-native-drag', { detail }),
                )
            const rect = host.getBoundingClientRect()
            const inside = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
            }

            // A file dragged over the terminal in its very first frames must light the ring.
            fire({ type: 'enter', paths: ['/tmp/dropped.txt'], ...inside })
            // The ring is driven by the `dropActive` signal through JSX classList, so it lands on
            // the next microtask rather than synchronously.
            await waitFor(() =>
                expect(host.classList.contains('term-drop-active')).toBe(
                    true,
                ),
            )

            // Let the font load resolve so the component finishes mounting rather than sitting
            // permanently mid-await for the rest of the Storybook session.
            handles?.resolveFonts()
        },
    }
})()

/** The listener half of the startup-window fix only lights the ring — actually inserting the
 *  dropped path needs the SECOND half of the fix, since `insertPathsAtPrompt` used to silently
 *  no-op unless the WebSocket was already OPEN, and the socket doesn't exist at all until AFTER
 *  the font-load await resolves. Holds fonts pending (via `PendingFontTerminal`) so `ws` is
 *  provably still `undefined`, fires a `drop`, and asserts nothing reaches the socket — the path
 *  must have gone into `pendingDropPaths` instead of vanishing, since there is nothing else it
 *  could do. Then resolves the font load, lets the real (fake) socket open, and asserts the
 *  buffered path is flushed to the prompt EXACTLY once: Terminal.tsx clears `pendingDropPaths`
 *  before reinvoking `insertPathsAtPrompt` on flush specifically so a later reconnect's `onopen`
 *  can't re-paste the same drop a second time, and that is the property this asserts. */
export const DropBeforeSocketOpenIsBuffered: Story = (() => {
    let handles: { resolveFonts: () => void; sent: Uint8Array[] } | undefined
    return {
        render: () => (
            <div style={{ height: STORY_H, width: '100%' }}>
                <PendingFontTerminal
                    id="story-terminal-drop-buffer"
                    frames={[PROMPT]}
                    onReady={h => {
                        handles = h
                    }}
                />
            </div>
        ),
        play: async ({ canvasElement }) => {
            const host = canvasElement.querySelector('.term-host')
            if (!(host instanceof HTMLElement))
                throw new Error('.term-host not found')
            if (!handles)
                throw new Error('PendingFontTerminal handles not ready')

            const rect = host.getBoundingClientRect()
            const inside = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2,
            }
            const DROPPED_PATH = '/tmp/buffered-drop.txt'

            // Drop while fonts — and therefore the WebSocket — are still pending. `ws` is
            // genuinely `undefined` here: insertPathsAtPrompt's only options are buffer the path
            // or drop it silently. Nothing can go out on a socket that doesn't exist yet.
            window.dispatchEvent(
                new CustomEvent('bismuth-native-drag', {
                    detail: {
                        type: 'drop',
                        paths: [DROPPED_PATH],
                        ...inside,
                    } satisfies NativeDragDetail,
                }),
            )
            await expect(handles.sent.length).toBe(0)

            // Stdin frames are 0x00-prefixed raw bytes (stdinFrame in Terminal.tsx); resize
            // frames (0x01-prefixed, sent first in ws.onopen via sendResize()) are filtered out
            // so this only looks at what was actually typed at the prompt.
            const stdinFrames = () =>
                handles!.sent
                    .filter(f => f[0] === 0x00)
                    .map(f => new TextDecoder().decode(f.slice(1)))

            // Let the font load resolve: xterm opens, connectWs() runs, the fake socket opens on
            // its own queueMicrotask, and ws.onopen should drain pendingDropPaths.
            handles.resolveFonts()

            await waitFor(() => {
                if (!stdinFrames().some(s => s.includes(DROPPED_PATH)))
                    throw new Error('buffered path has not flushed yet')
            })

            // Exactly once — not merely at least once.
            await expect(
                stdinFrames().filter(s => s.includes(DROPPED_PATH)).length,
            ).toBe(1)
        },
    }
})()

/** All 16 ANSI colors (base 30-37, then bright 90-97), each name printed in its own foreground
 *  color — a direct exercise of `buildTerminalTheme`'s theme-token derivation (Terminal.tsx):
 *  every swatch here should visibly match its scope's --danger/--green/--gold/--blue/--violet/
 *  --teal tokens (the bright row further mixed 70% toward --fg), never xterm's stock 16-color
 *  defaults. */
export const AnsiPalette: Story = {
    render: () => {
        const names = [
            'black',
            'red',
            'green',
            'yellow',
            'blue',
            'magenta',
            'cyan',
            'white',
        ]
        const baseRow = names
            .map((n, i) => `\x1b[${30 + i}m${n.padEnd(9)}\x1b[0m`)
            .join('')
        const brightRow = names
            .map((n, i) => `\x1b[${90 + i}m${('bright-' + n).padEnd(9)}\x1b[0m`)
            .join('')
        return (
            <div style={{ height: STORY_H, width: '100%' }}>
                <FakeSocketTerminal
                    id="story-terminal-palette"
                    frames={[
                        '\x1b[1mANSI palette (theme-derived)\x1b[0m\r\n',
                        baseRow + '\r\n',
                        brightRow + '\r\n',
                        PROMPT,
                    ]}
                />
            </div>
        )
    },
}
