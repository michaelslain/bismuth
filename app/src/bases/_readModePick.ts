// Story helper: drive the display panel's `show` row (pages, text, side by side) and its `move by`
// row (scroll, flip) the way a person does.
import { userEvent, waitFor, within } from 'storybook/test'

const VIEWS = ['pages', 'text', 'side by side']

/** Open the display panel, run `f` on it, close it again. */
async function inDisplay<T>(root: HTMLElement, f: (panel: HTMLElement) => Promise<T>): Promise<T> {
    await userEvent.click(within(root).getAllByRole('button', { name: 'display' })[0])
    const panel = await waitFor(() => {
        const p = document.querySelector<HTMLElement>('[data-bar-settings-panel]')
        if (!p) throw new Error('display panel did not open')
        return p
    })
    const out = await f(panel)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
        if (document.querySelector('[data-bar-settings-panel]')) throw new Error('panel still open')
    })
    return out
}

/** Pick a view (`read as`) or scroll or flip (`scroll or flip`). */
export async function pickRead(root: HTMLElement, _which: 'read as' | 'scroll or flip', choice: string) {
    await inDisplay(root, async panel => userEvent.click(within(panel).getByRole('button', { name: choice })))
}

/** What is picked now: the pressed view, or scroll or flip. */
export async function readState(root: HTMLElement, which: 'read as' | 'scroll or flip'): Promise<string> {
    const names = which === 'read as' ? VIEWS : ['scroll', 'flip']
    return inDisplay(root, async panel => names.find(n => within(panel).getByRole('button', { name: n }).getAttribute('aria-pressed') === 'true') ?? '')
}

/** Whether the view `choice` can be picked, and its tooltip. */
export async function readRow(root: HTMLElement, choice: string) {
    return inDisplay(root, async panel => {
        const b = within(panel).getByRole('button', { name: choice }) as HTMLButtonElement
        return { disabled: b.disabled, text: b.getAttribute('data-tooltip') || b.title }
    })
}
