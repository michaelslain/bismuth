// app/scripts/dev.ts
//
// Runs `bun run dev`'s two halves (the core server + Vite) exactly like the old inline
// `concurrently -k "…" "vite"` package.json script did, PLUS: mints one random owner token
// (see core/src/ownerToken.ts) and hands the SAME value to both — BISMUTH_OWNER_TOKEN to the
// core server, VITE_OWNER_TOKEN to Vite (baked into the frontend bundle via
// `import.meta.env.VITE_OWNER_TOKEN`, read by app/src/api.ts's resolveOwnerToken) — so dev-mode
// requests present as the vault's own owner instead of a filtered non-owner channel. Without
// this, every content route (GET /file, POST /search, …) would 403/filter for the dev app itself
// the moment a vault marks anything `visibility: chat-only`/`hidden`.
//
// This exists as a script (not inline in package.json) because minting a value once and
// threading it through two commands needs real variable scope — package.json's single quoted
// shell string can't do that without a wall of escaped quotes on top of the ALREADY-escaped
// `${VAR:?message}` guards below. Delegates the actual concurrent-process / kill-on-exit
// mechanics to `concurrently`'s own JS API (unchanged behavior, `-k` ⇔ killOthersOn below) via
// argv arrays instead of a hand-escaped shell string, so there's no shell-quoting risk either.
import { concurrently } from "concurrently";

const vault = process.env.BISMUTH_VAULT;
const memory = process.env.BISMUTH_MEMORY;
if (!vault) {
  console.error("set BISMUTH_VAULT to your 2nd-brain vault dir");
  process.exit(1);
}
if (!memory) {
  console.error("set BISMUTH_MEMORY to your 3rd-brain memory dir");
  process.exit(1);
}

// Random 32-byte hex token via Bun's global WebCrypto (no node:crypto import needed) — mirrors
// core/src/ownerToken.ts's own mintOwnerToken(), just minted here so BOTH halves agree on it.
const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");

const { result } = concurrently(
  [
    { name: "core", command: "bun run ../core/src/server.ts", env: { BISMUTH_VAULT: vault, BISMUTH_MEMORY: memory, BISMUTH_OWNER_TOKEN: token } },
    { name: "vite", command: "vite", env: { VITE_OWNER_TOKEN: token } },
  ],
  { killOthersOn: ["success", "failure"] },
);

result.then(
  () => process.exit(0),
  () => process.exit(1),
);
