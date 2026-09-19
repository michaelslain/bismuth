// app/src/UpdateBanner.tsx
// A slim top bar shown when the source-built app is behind origin/main (auto-detected by
// updateCheck.ts). The Update button starts the background self-update (POST /update/apply),
// polls progress (GET /update/progress), and when the build is ready invokes the Tauri
// `quit_app` command so the detached relauncher can swap the .app bundle + reopen it.
import { createSignal, Show } from 'solid-js'
import { updateStatus, applyUpdateAndRelaunch } from './updateCheck'
import { pushToast } from './Toast'
import type { UpdatePhase } from '../../core/src/selfUpdate'
import { plural } from './plural'
import Callout from './ui/Callout'
import Text from './ui/Text'
import { TextButton } from './ui/TextButton'
import { IconButton } from './ui/IconButton'
import styles from './UpdateBanner.module.css'

function phaseLabel(p: UpdatePhase | ''): string {
    switch (p) {
        case 'pulling':
            return 'Pulling…'
        case 'building':
            return 'Building… (a few min)'
        case 'ready':
            return 'Relaunching…'
        default:
            return ''
    }
}

export function UpdateBanner() {
    const [dismissed, setDismissed] = createSignal(false)
    const [working, setWorking] = createSignal(false)
    const [phase, setPhase] = createSignal<UpdatePhase | ''>('')

    const behind = () => updateStatus()?.behind ?? 0
    const show = () => !!updateStatus()?.available && !dismissed()

    const update = async () => {
        if (working()) return
        setWorking(true)
        setPhase('pulling')
        try {
            const r = await applyUpdateAndRelaunch(setPhase)
            if (r.result === 'relaunching') return // quitting; relauncher takes over
            if (r.result === 'error') pushToast(r.message ?? 'Update failed')
            setWorking(false) // error or already up to date
        } catch (e) {
            pushToast(`Update failed: ${(e as Error).message}`)
            setWorking(false)
        }
    }

    return (
        <Show when={show()}>
            <Callout class={styles['update-banner']}>
                <Text as="span" size="inherit" tone="inherit" weight="inherit">
                    Bismuth update available — {plural(behind(), 'commit')}{' '}
                    behind
                </Text>
                <div class={styles['update-banner-actions']}>
                    <Show when={working()}>
                        <Text as="span" size="micro" tone="muted">
                            {phaseLabel(phase())}
                        </Text>
                    </Show>
                    <TextButton onClick={update} disabled={working()} variant="selected">
                        {working() ? 'UPDATING…' : 'UPDATE'}
                    </TextButton>
                    <IconButton
                        icon="X"
                        label="Dismiss"
                        size="sm"
                        onClick={() => setDismissed(true)}
                        disabled={working()}
                    />
                </div>
            </Callout>
        </Show>
    )
}
