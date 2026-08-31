// app/scripts/dev.ts — the ONE dev entry point, in two flavours:
//
//   bun run dev:browser   core server + Vite, open http://localhost:1420
//   bun run dev:app       the same two, plus the Tauri window
//
// THOSE TWO ARE THE WHOLE SURFACE. There is no bare `dev` script: it read as a third, differently
// named way in when it was only ever the browser half, and the two flavours now say which they are.
//
// Both default to a generated example vault (see devVault.ts), so a fresh clone runs with no
// setup. Export BISMUTH_VAULT + BISMUTH_MEMORY to point at a real vault instead.
//
// WHY THE TOKEN IS MINTED HERE. One random owner token (core/src/ownerToken.ts) is handed to BOTH
// halves — BISMUTH_OWNER_TOKEN to the core server, VITE_OWNER_TOKEN to Vite, where it is baked into
// the bundle and read by app/src/api.ts's resolveOwnerToken — so dev requests present as the vault's
// owner rather than a filtered non-owner channel. Without it every content route (GET /file,
// POST /search, …) 403s or silently filters the moment a vault marks anything
// `visibility: chat-only` / `hidden`. Minting once and threading it through two commands needs real
// variable scope, which is why this is a script and not an inline package.json string.
//
// `--app` runs Tauri IN THIS PROCESS GROUP rather than through tauri.conf.json's `beforeDevCommand`,
// WHICH IS THEREFORE DELIBERATELY EMPTY — do not put a command back in it. It used to hold
// `bun run dev`, which meant `dev:app` started core+Vite here and Tauri started a SECOND pair,
// colliding on :4321/:1420: the nested core exited with "Is port 4321 in use?" and took the whole
// window down with it. This comment described that trap while the config still contained it.
// Passing `--no-dev-server-wait` and letting concurrently own all three processes keeps one owner
// token, one core, one Vite, one kill signal.
//
// The cost of the empty field, stated so it is a choice and not a surprise: a bare `bun run tauri
// dev` no longer brings its own frontend up, so it paints an empty window. `dev:app` is the entry
// point; run that.
import { concurrently } from 'concurrently'
import { resolveDevVault, describeChoice } from './devVault'

const native = process.argv.includes('--app')

const choice = resolveDevVault()
console.log(describeChoice(choice))

const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

const commands = [
    {
        name: 'core',
        command: 'bun run ../core/src/server.ts',
        env: {
            BISMUTH_VAULT: choice.vault,
            BISMUTH_MEMORY: choice.memory,
            BISMUTH_OWNER_TOKEN: token,
        },
    },
    { name: 'vite', command: 'vite', env: { VITE_OWNER_TOKEN: token } },
]

if (native)
    commands.push({
        name: 'tauri',
        command: 'bun run scripts/tauri.ts dev --no-dev-server-wait',
        env: {
            BISMUTH_VAULT: choice.vault,
            BISMUTH_MEMORY: choice.memory,
            BISMUTH_OWNER_TOKEN: token,
        },
    })
else console.log('[dev] browser: http://localhost:1420  (bun run dev:app for the native window)')

const { result } = concurrently(commands, {
    killOthersOn: ['success', 'failure'],
})

result.then(
    () => process.exit(0),
    () => process.exit(1),
)
