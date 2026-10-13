// What `app open <content>` (POST /ui/command, action open-tab) actually opens. The window opens
// whatever string it is handed, so a path that names no file used to come back `{ok: true}` with a
// blank tab labelled after the bad string — an agent asked to open `Textbook.pdf#page=124` saw
// success and could not tell it had opened nothing. This resolves the content against the vault
// BEFORE dispatch: an absolute path inside the vault becomes vault-relative, a bare note name gains
// its `.md`, and anything that names no file is refused with a message that says what is accepted.
// Pure over `exists` (no fs import), so it runs on the mobile in-process core too.

export type OpenTarget = { ok: true; content: string } | { ok: false; error: string }

/** What `app open` accepts, for the refusal message. */
export const OPEN_USAGE =
    'app open takes a vault-relative path (notes/x.md, papers/y.pdf) or a sentinel ' +
    '(::graph, ::daemon, .settings, ::term:<uuid>)'

/** Resolve `content` to the id the window should open, or a refusal. `exists` answers for a
 *  vault-relative path. Sentinels (`::…`) and `.settings` pass through untouched. */
export async function resolveOpenTarget(
    vault: string,
    content: string,
    exists: (rel: string) => Promise<boolean>,
): Promise<OpenTarget> {
    if (content.startsWith('::') || content === '.settings')
        return { ok: true, content }
    const root = vault.replace(/\/+$/, '')
    let rel = content
    if (rel.startsWith('/')) {
        if (!rel.startsWith(root + '/'))
            return {
                ok: false,
                error: `"${content}" is outside the vault (${root}); ${OPEN_USAGE}`,
            }
        rel = rel.slice(root.length + 1)
    }
    rel = rel.replace(/^(\.\/)+/, '')
    if (!rel || rel.split('/').includes('..'))
        return { ok: false, error: `"${content}" is not a vault path; ${OPEN_USAGE}` }
    if (await exists(rel)) return { ok: true, content: rel }
    if (!/\.[^/.]+$/.test(rel) && (await exists(`${rel}.md`)))
        return { ok: true, content: `${rel}.md` }
    const anchor = rel.includes('#')
        ? ' (it opens the whole file; there is no #page or #heading jump)'
        : ''
    return {
        ok: false,
        error: `no file "${rel}" in the vault${anchor}; ${OPEN_USAGE}`,
    }
}
