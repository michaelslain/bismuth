// app/src/ui/ToastHost.tsx
// The JSX host: renders the live toast stack. Pure state + actions (pushToast/updateToast/
// dismissToast/toasts) live in ./toastStore, re-exported here so a surface that already imports
// the host gets them from the same place — see toastStore.ts's header comment for why the split
// exists.
import { For, Show } from 'solid-js'
import { TextButton } from './TextButton'
import Text from './Text'
import styles from './ToastHost.module.css'
import {
    toasts,
    dismissToast,
    pushToast,
    updateToast,
    type Toast,
    type ToastTone,
    type PushToastOptions,
} from './toastStore'
import CloseButton from './CloseButton'

export type { Toast, ToastTone, PushToastOptions }
export { pushToast, updateToast, dismissToast, toasts }

/** Fixed bottom-center stack of toasts. Mount once near the app root.
 *
 * ── Why the live region ───────────────────────────────────────────────────────────────────────
 * The app had ZERO `aria-live` regions, and this is the surface that needed one most: toasts are
 * how deleting a note reports itself, and the toast carries the ONLY Undo affordance for that
 * delete. A screen-reader user therefore got no announcement that the note was gone AND no route
 * to the undo — the recovery path existed but was unreachable, which is worse than not offering
 * one. Save confirmations, sync results and every `pushToast(\`… \${e.message}\`)` error rode the
 * same silence.
 *
 * `polite`, not `assertive`: these are confirmations and recoverable errors, so they should be
 * announced at the next natural pause rather than interrupting whatever the user is reading. The
 * region is rendered unconditionally, not created when the first toast arrives — a live region
 * added to the DOM at the same moment as its content is frequently missed entirely, because the
 * AT has nothing to observe until after the mutation it was supposed to catch.
 *
 * Tones: `default` is the info register; `danger` (`pushToast(msg, { tone: 'danger' })`) is a
 * failure and reads in the danger ink with a danger hairline, so an error never looks like a
 * confirmation. Stacks ABOVE a modal and BELOW a popover (`--z-toast`) — a notification must be
 * seen, but must never cover an open menu.
 */
export function ToastHost() {
    return (
        <div class={styles['toast-host']} aria-live="polite" aria-atomic="false">
            <For each={toasts()}>
                {t => (
                    <div class={styles['toast-pill']} data-tone={t.tone}>
                        <Text as="span" inherit>
                            {t.message}
                        </Text>
                        {t.action && (
                            <TextButton
                                onClick={() => {
                                    t.action!.onClick()
                                    dismissToast(t.id)
                                }}
                            >
                                {t.action.label.toLowerCase()}
                            </TextButton>
                        )}
                        {/* A persistent toast (ttl <= 0 — the progress ones) has no timer to take
                            it off screen, so it carries its own way out. A timed one dismisses
                            itself and stays uncluttered. */}
                        <Show when={t.persistent}>
                            <CloseButton
                                label="dismiss"
                                onClick={() => dismissToast(t.id)}
                            />
                        </Show>
                    </div>
                )}
            </For>
        </div>
    )
}
