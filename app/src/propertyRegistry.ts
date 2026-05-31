// app/src/propertyRegistry.ts
// Solid store holding the vault-wide property type registry (the `properties:`
// section of settings.yaml). Hydrated from GET /schema and refreshed when an SSE
// change touches settings.yaml. Read by yamlSchema's linter + autocomplete sources.
import { createSignal, createRoot } from "solid-js";
import { api } from "./api";
import type { Schema } from "../../core/src/schema/types";

// Seed empty so consumers never deref undefined before the first fetch resolves.
const [registry, setRegistry] = createSignal<Schema>({});

/** Accessor for the current property registry. Empty ({}) until hydrated. */
export const propertyRegistry: () => Schema = registry;

/** Fetch /schema and replace the registry. Swallows network errors (keeps last good). */
export async function refreshPropertyRegistry(): Promise<void> {
  try {
    setRegistry(await api.schema());
  } catch {
    // network hiccup — keep the last good registry
  }
}

// Hydrate + wire SSE only in a real browser. `serverVersion` constructs a global
// EventSource at import time, which doesn't exist under `bun test` (headless) — so
// we gate the whole side-effecting block (and defer that import) behind that check.
// The seed-{} accessor above is always available, which is all the unit test asserts.
if (typeof EventSource !== "undefined") {
  createRoot(() => {
    void refreshPropertyRegistry();
    let lastSeen = -1;
    void (async () => {
      const { lastChange } = await import("./serverVersion");
      const { createEffect } = await import("solid-js");
      // Re-hydrate whenever an SSE change reports settings.yaml (where the registry
      // lives), or when paths are unknown (initial snapshot / fallback poll → assume
      // it may have changed).
      createEffect(() => {
        const c = lastChange();
        if (c.version === lastSeen) return;
        lastSeen = c.version;
        if (
          c.paths.length === 0 ||
          c.paths.some((p) => p === "settings.yaml" || p.endsWith("/settings.yaml"))
        ) {
          void refreshPropertyRegistry();
        }
      });
    })();
  });
}
