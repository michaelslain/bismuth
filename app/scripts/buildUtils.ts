// Shared helpers for the app/scripts/build-*.ts prebuild steps.
import { existsSync, statSync } from "node:fs";

// Smoke-check a `bun build --compile` output: the file must exist and be non-trivial in size
// (a too-small binary usually means the compile silently produced a stub/error page instead of
// a real executable). Exits the process on failure; logs a success line with the size otherwise.
export function assertBuiltBinary(path: string, label: string, minBytes = 1_000_000): void {
  if (!existsSync(path) || statSync(path).size < minBytes) {
    console.error(`${label} missing or too small: ${path}`);
    process.exit(1);
  }
  console.log(`✓ ${label} built: ${path} (${(statSync(path).size / 1e6).toFixed(0)}MB)`);
}
