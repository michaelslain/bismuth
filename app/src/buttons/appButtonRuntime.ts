// The real ButtonRuntime: wires the button UI to the core parser, the api, the command registry,
// settings and device trust. Registered once from App.tsx at mount.
import { createSignal } from 'solid-js'
import { api } from '../api'
import { parseButtonBlock, buttonKey } from '../../../core/src/buttons/buttonBlock'
import { commandLabel, UI_CONTROL_BLOCKLIST } from '../../../core/src/commands'
import type { ButtonRuntime } from './buttonRuntime'
import { flushEditorByPath } from '../editorRegistry'
import { isTrusted, trust } from './buttonTrust'

export type AppButtonRuntimeDeps = {
    /** The command registry entry for an id, or undefined when none is registered. */
    getCommand: (id: string) => { action: () => unknown } | undefined
    daemonEnabled: () => boolean
}

export function appButtonRuntime(deps: AppButtonRuntimeDeps): ButtonRuntime {
    // Owner check copied from InboxPageView: fetched once, a failure reads as owner.
    const [notOwnerNow, setNotOwner] = createSignal(false)
    api.daemonStatus()
        .then(s => {
            setNotOwner(
                !!s && s.owner != null && s.owner.ownerDeviceId !== s.thisDeviceId,
            )
        })
        .catch(() => {})
    return {
        parse: parseButtonBlock,
        key: buttonKey,
        press: async req => {
            // core checks the fence body against the file on disk, so persist pending edits first
            if (req.host.kind === 'note') await flushEditorByPath(req.host.path)
            return api.pressButton(req)
        },
        states: keys => api.buttonStates(keys),
        runCommand: async id => {
            if (UI_CONTROL_BLOCKLIST.includes(id))
                throw new Error(`command "${id}" can't run from a button`)
            const cmd = deps.getCommand(id)
            if (!cmd) throw new Error(`unknown command "${id}"`)
            await cmd.action()
        },
        commandLabel,
        daemonEnabled: deps.daemonEnabled,
        notOwner: notOwnerNow,
        isTrusted,
        trust,
    }
}
