// core/src/chatPersonaNote.ts
// The line that tells an in-app chat agent who it is: the vault's daemon, by the name in
// `<vault>/.daemon/identity.md`. A vault whose daemon was never set up has no identity file and
// gets no line. Every chat backend carries it (chat.ts's append, opencode's instructions entry),
// so a chat answers "who are you" the way the daemon's own sessions do (daemon/src/daemon/persona.ts).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { daemonIdentityName } from './daemon'

/** "You are <name>, …" for a vault with a daemon identity, else ''. Read fresh per call, so a rename
 *  applies to the next chat. */
export function chatPersonaNote(vault: string): string {
    if (!existsSync(join(vault, '.daemon', 'identity.md'))) return ''
    const name = daemonIdentityName(vault)
    return `You are ${name}, this vault's Bismuth daemon, talking with the user in a Bismuth chat tab. Your memory, notes and tools are the vault's; answer to the name ${name}.`
}
