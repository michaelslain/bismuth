// app/src/buttons/buttonRuntime.ts
// The seam between the button UI and everything it cannot import directly: the core parser, the
// api, the command catalog, settings and device trust. App.tsx registers the real one at mount;
// stories register a fake. Until then an inert runtime stands in.
import type {
    ButtonBlock,
    ButtonHost,
    PressRequest,
    PressResult,
    ButtonState,
} from '../../../core/src/buttons/buttonTypes'

export type ButtonRuntime = {
    parse: (body: string) => ButtonBlock
    key: (host: ButtonHost, body: string, index: number) => string
    press: (req: PressRequest) => Promise<PressResult>
    states: (keys: string[]) => Promise<Record<string, ButtonState>>
    runCommand: (id: string) => Promise<void>
    commandLabel: (id: string) => string | undefined
    daemonEnabled: () => boolean
    notOwner: () => boolean
    isTrusted: (text: string) => boolean
    trust: (text: string) => void
}

const inert: ButtonRuntime = {
    parse: () => ({ buttons: [], error: 'buttons are not available here' }),
    key: (_host, _body, index) => String(index),
    press: async () => ({ ok: false, reason: 'invalid', message: 'buttons are not available here' }),
    states: async () => ({}),
    runCommand: async () => {},
    commandLabel: () => undefined,
    daemonEnabled: () => false,
    notOwner: () => false,
    isTrusted: () => false,
    trust: () => {},
}

let current: ButtonRuntime = inert

export function setButtonRuntime(rt: ButtonRuntime): void {
    current = rt
}

export function buttonRuntime(): ButtonRuntime {
    return current
}
