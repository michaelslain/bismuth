// The paragraph that tells an agent session Bismuth starts how to reach Bismuth: its `bismuth` CLI.
// Appended to the chat's system prompt (core/src/chat.ts) and to the daemon persona
// (daemon/src/daemon/session.ts), the two places a session's first context is built. Without it a
// chat in the vault grepped and curled its way through tasks it had a command for, hunted the disk for
// the binary, and ran the app binary inside Bismuth.app, which opened a second window.
export const AGENT_CLI_NOTE = [
    'This session runs in a Bismuth vault. The `bismuth` CLI does everything Bismuth does: notes,',
    'tasks, bases, search, memory, OCR, the daemon, and the running app (`bismuth app open <path>`',
    'opens a file as a tab). Run it in your shell; no --vault is needed inside the vault.',
    '`bismuth --help` lists every command, `bismuth <group> --help` one group, and',
    '`bismuth docs search <words>` / `bismuth docs read <page>` read the docs. Reach for a command',
    'before grepping notes by hand. Never run anything inside Bismuth.app: that binary is the app',
    'itself and opens a second window.',
].join('\n')
