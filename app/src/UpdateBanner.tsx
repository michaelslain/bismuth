// app/src/UpdateBanner.tsx
// A slim top bar shown when the source-built app is behind origin/main (auto-detected by
// updateCheck.ts), and for as long as an update runs. `update` starts the shared run (updateRun.ts),
// the same one the commands, auto-update and the CLI drive, so the phase readout and the `cancel`
// that replaces `update` mid-run match the progress toast whoever started it.
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
import { updateStatus, updateRun, applyUpdateAndRelaunch, cancelUpdate } from './updateCheck'
import type { UpdateRunView } from './updateRun'
import { plural } from './plural'
import ViewBar from './ui/ViewBar'
import Text from './ui/Text'
import { TextButton } from './ui/TextButton'
import CloseButton from './ui/CloseButton'

function phaseLabel(r: UpdateRunView): string {
    if (r.cancelling) return 'Cancelling…'
    switch (r.phase) {
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

    const behind = () => updateStatus()?.behind ?? 0
    // The run is shared (updateRun.ts): one started from the command, auto-update or the CLI shows
    // here too, even after the banner was dismissed.
    const run = updateRun
    const show = () =>
        !!run() || (!!updateStatus()?.available && !dismissed())

    return (
        <Show when={show()}>
            <ViewBar
                class={props.class}
                identity={
                    <Text as="span" size="ui" tone="muted">
                        <Show
                            when={updateStatus()?.available}
                            fallback="Updating Bismuth"
                        >
                            Bismuth update available — {plural(behind(), 'commit')}{' '}
                            behind
                        </Show>
                    </Text>
                }
                readouts={
                    <Show when={run()}>
                        {r => (
                            <Text as="span" size="micro" tone="muted">
                                {phaseLabel(r())}
                            </Text>
                        )}
                    </Show>
                }
                actions={
                    <Show
                        when={run()}
                        fallback={
                            <>
                                <TextButton
                                    onClick={() => void applyUpdateAndRelaunch()}
                                    primary
                                >
                                    update
                                </TextButton>
                                <CloseButton
                                    label="Dismiss"
                                    onClick={() => setDismissed(true)}
                                />
                            </>
                        }
                    >
                        {r => (
                            <TextButton
                                onClick={() => void cancelUpdate()}
                                disabled={r().cancelling || r().phase === 'ready'}
                            >
                                {r().cancelling ? 'cancelling…' : 'cancel'}
                            </TextButton>
                        )}
                    </Show>
                }
            />
        </Show>
    )
}
