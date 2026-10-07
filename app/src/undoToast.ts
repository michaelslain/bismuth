// Final signature:
//   pushUndoToast(message: string, undo: () => void | Promise<void>, ttl?: number): number
//
// A toast with a single `undo` action. Every delete in the app is immediate + this toast (never a
// two-step confirm). The undo runs at most once — a second click is a no-op — then the toast is
// dismissed. An undo that throws or rejects pushes `undo failed: <message>`. ttl defaults to 8000ms.
import { pushToast, dismissToast } from './ui/toastStore'

export function pushUndoToast(
    message: string,
    undo: () => void | Promise<void>,
    ttl?: number,
): number {
    let ran = false
    let id = 0
    id = pushToast(
        message,
        {
            label: 'undo',
            onClick: () => {
                if (ran) return
                ran = true
                dismissToast(id)
                Promise.resolve()
                    .then(undo)
                    .catch(e =>
                        pushToast(`undo failed: ${(e as Error).message}`),
                    )
            },
        },
        ttl ?? 8000,
    )
    return id
}
