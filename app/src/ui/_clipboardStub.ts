// Storybook helper (underscore: not a story) — swaps `navigator.clipboard` for a recorder so a play
// function can prove what a copy control wrote, without the real clipboard (which an unfocused
// story iframe is refused anyway). `restore()` puts the browser's own back.
export function stubClipboard(): { written: () => string[]; restore: () => void } {
    const writes: string[] = []
    const real = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
            writeText: (text: string) => {
                writes.push(text)
                return Promise.resolve()
            },
        },
    })
    return {
        written: () => [...writes],
        restore: () => {
            if (real) Object.defineProperty(navigator, 'clipboard', real)
            else delete (navigator as { clipboard?: unknown }).clipboard
        },
    }
}
