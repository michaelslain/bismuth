// Makes a shell command safe to SHOW in an approval dialog: every character that would hide,
// reorder or split the text is replaced by a visible marker, so what the owner reads is what runs.
// Pure — no framework imports.
const NAMED: Record<string, string> = { '\n': '⏎', '\r': '␍', '\t': '⇥' }

const hex = (code: number) =>
    `⟨U+${code.toString(16).toUpperCase().padStart(4, '0')}⟩`

const isHiddenCode = (code: number) =>
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0xfeff ||
    code === 0xa0 ||
    code === 0x3000 ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x85 ||
    code === 0xad ||
    code === 0x2060 ||
    code <= 0x1f ||
    code === 0x7f

export type VisiblePart = { text: string; hidden: boolean }

/** The command split into plain runs and hidden-character markers, in order. A long run of
 *  spaces collapses to one marker so padding cannot push a payload out of sight. */
export function visibleParts(command: string): VisiblePart[] {
    const parts: VisiblePart[] = []
    const push = (text: string, hidden: boolean) => {
        const last = parts[parts.length - 1]
        if (last && !hidden && !last.hidden) last.text += text
        else parts.push({ text, hidden })
    }
    return build(command, push, parts)
}

function build(
    command: string,
    push: (text: string, hidden: boolean) => void,
    parts: VisiblePart[],
): VisiblePart[] {
    const chars = Array.from(command)
    let i = 0
    while (i < chars.length) {
        const ch = chars[i]
        if (ch === ' ') {
            let j = i
            while (chars[j] === ' ') j++
            const n = j - i
            if (n >= 3) push(`⟨${n} spaces⟩`, true)
            else push(' '.repeat(n), false)
            i = j
            continue
        }
        const code = ch.codePointAt(0)!
        const named = NAMED[ch]
        if (named) push(named, true)
        else if (isHiddenCode(code)) push(hex(code), true)
        else push(ch, false)
        i++
    }
    return parts
}

export function visibleCommand(command: string): string {
    return visibleParts(command)
        .map(p => p.text)
        .join('')
}

/** Mirror of core's `hasHiddenChars` (statusBarTrust.ts, which uses node:fs and so cannot be
 *  imported here): the server refuses these, so the dialog must not offer [ allow ]. The parity
 *  test pins the two together. */
export function isApprovable(command: string): boolean {
    return !/[\n\r‪-‮⁦-⁩]/.test(command)
}
