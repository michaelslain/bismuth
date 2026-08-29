// app/src/Toast.tsx
// The JSX host: renders the live toast stack. Pure state + actions (pushToast/updateToast/
// dismissToast/toasts) live in ./toastStore, re-exported here so every existing `from "./Toast"`
// import keeps working unchanged — see toastStore.ts's header comment for why the split exists.
import { For } from 'solid-js'
import { TextButton } from './ui/TextButton'
import './Toast.css'
import {
    toasts,
    dismissToast,
    pushToast,
    updateToast,
    type Toast,
} from './toastStore'

export type { Toast }
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
 */
export function ToastHost() {
    return (
        <div class="toast-host" aria-live="polite" aria-atomic="false">
            <For each={toasts()}>
                {t => (
                    <div class="toast-pill">
                        <span>{t.message}</span>
                        {t.action && (
                            <TextButton
                                size="sm"
                                onClick={() => {
                                    t.action!.onClick()
                                    dismissToast(t.id)
                                }}
                            >
                                {t.action.label.toUpperCase()}
                            </TextButton>
                        )}
                    </div>
                )}
            </For>
        </div>
    )
}
