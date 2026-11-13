// The paragraph that tells an agent session Bismuth starts how to reach Bismuth: its `bismuth` CLI.
// Appended to the chat's system prompt (core/src/chat.ts) and to the daemon persona
// (daemon/src/daemon/session.ts), the two places a session's first context is built. Without it a
// chat in the vault grepped and curled its way through tasks it had a command for, hunted the disk for
// the binary, and ran the app binary inside Bismuth.app, which opened a second window. Its last
// sentences have the session mark itself errored (core/src/erroredChats.ts) when Bismuth misbehaves,
// so a later debugging review reads only those sessions instead of every transcript.
export const AGENT_CLI_NOTE = [
    'This session runs in a Bismuth vault. The `bismuth` CLI does everything Bismuth does: notes,',
    'tasks, bases, search, memory, OCR, the daemon, and the running app (`bismuth app open <path>`',
    'opens a file as a tab). Run it in your shell; no --vault is needed inside the vault.',
    'Your shell already starts in the vault folder, so run `bismuth` and other commands as they are,',
    'with vault-relative paths, instead of `cd`-ing into the vault first.',
    '`bismuth --help` lists every command, `bismuth <group> --help` one group, and',
    '`bismuth docs search <words>` / `bismuth docs read <page>` read the docs. Reach for a command',
    'before grepping notes by hand. Never run anything inside Bismuth.app: that binary is the app',
    'itself and opens a second window.',
    'When Bismuth itself goes wrong in this session (a `bismuth` command or Bismuth tool fails or',
    'hangs, something takes far longer than it should, its output contradicts the docs, you have to',
    'work around it, or the user corrects you about how Bismuth behaves), run',
    '`bismuth daemon errored --reason "<one line: what went wrong>"` once, then carry on. It only',
    'flags this session for a later debugging review, so do not announce it.',
].join('\n')
