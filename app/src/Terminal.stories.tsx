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
function makeFakeSocketClass(frames: string[]) {
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

        send(..._args: unknown[]): void {
            // Ignore stdin/resize frames — static coverage only, nothing is listening on the other end.
        }

        close(): void {
            this.readyState = FakeTerminalSocket.CLOSED
        }
    }
}

/** Installs the fake as `globalThis.WebSocket`; returns a restore function. */
function installFakeSocket(frames: string[]): () => void {
    const original = globalThis.WebSocket
    globalThis.WebSocket = makeFakeSocketClass(
        frames,
    ) as unknown as typeof WebSocket
    return () => {
        globalThis.WebSocket = original
    }
}

/** Wraps <TerminalTab> with the fake socket's install/restore lifecycle, scoped to exactly this
 *  story instance. `onMount` here is registered (and — per Solid's effect-flush order — fires)
 *  before TerminalTab's own `onMount`, and even if it didn't, TerminalTab awaits a font load
 *  before ever touching `WebSocket`, so the swap is guaranteed to land first either way. */
function FakeSocketTerminal(props: { id: string; frames: string[] }) {
    let restore: () => void = () => {}
    onMount(() => {
        restore = installFakeSocket(props.frames)
    })
    onCleanup(() => restore())
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
        // `.term-host` or the dragover/`bismuth-native-drag` listeners get attached (both happen
        // synchronously, in that order, right after the await resolves). Firing the drag event
        // before that continuation has run is a no-op: nothing is listening yet, so the ring
        // never lights and the assertion below reads a permanent false. `.xterm` mounting is the
        // observable signal that the continuation — listeners included — has already completed.
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
