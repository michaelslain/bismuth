// app/src/UpdateBanner.tsx
// A slim top bar shown when the source-built app is behind origin/main (auto-detected by
// updateCheck.ts). The Update button starts the background self-update (POST /update/apply),
// polls progress (GET /update/progress), and when the build is ready invokes the Tauri
// `quit_app` command so the detached relauncher can swap the .app bundle + reopen it.
//
// It IS a ViewBar, not a callout: the message is the identity, the phase is a readout, update +
// dismiss are the actions. That is what puts it on the toolbars' edges — same --h-band height, the
// same --sp-5 inset (ViewBar renders through ui/Band), the same hairline and the same 18px `sm`
// icon box, so the dismiss [x] sits in the column a toolbar's last icon sits in. It used to compose
// ui/Callout, whose accent left edge and --sp-4 vertical padding made it the one strip in the
// column that lined up with nothing. It has no stylesheet of its own on purpose: narrowing, too, is
// ViewBar's — below its floor tier the message scrolls under the fade mask and the actions stay
// pinned, exactly as a toolbar's lead does.
import { createSignal, Show } from 'solid-js'
import { updateStatus, applyUpdateAndRelaunch } from './updateCheck'
import { pushToast } from './ui/ToastHost'
import type { UpdatePhase } from '../../core/src/selfUpdate'
import { plural } from './plural'
import ViewBar from './ui/ViewBar'
import Text from './ui/Text'
import { TextButton } from './ui/TextButton'
import CloseButton from './ui/CloseButton'

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

export type UpdateBannerProps = {
    /** Merged onto the root, so a caller can adjust one instance without forking the banner. */
    class?: string
}

export function UpdateBanner(props: UpdateBannerProps) {
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
            <ViewBar
                class={props.class}
                identity={
                    <Text as="span" size="ui" tone="muted">
                        Bismuth update available — {plural(behind(), 'commit')}{' '}
                        behind
                    </Text>
                }
                readouts={
                    <Show when={working()}>
                        <Text as="span" size="micro" tone="muted">
                            {phaseLabel(phase())}
                        </Text>
                    </Show>
                }
                actions={
                    <>
                        <TextButton
                            onClick={update}
                            disabled={working()}
                            primary
                        >
                            {working() ? 'updating…' : 'update'}
                        </TextButton>
                        <CloseButton
                            label="Dismiss"
                            onClick={() => setDismissed(true)}
                            disabled={working()}
                        />
                    </>
                }
            />
        </Show>
    )
}
