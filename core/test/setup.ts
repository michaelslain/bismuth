// Test preload (registered in the repo-root bunfig.toml `[test].preload`).
// Redirects the layout disk cache to a throwaway temp dir so the test suite never writes to the real
// durable cache location (~/.bismuth/layout-cache). Must run before layout-cache.ts is imported — a
// preload does, which is why this lives here rather than in an individual test file (imports hoist).
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

process.env.OA_LAYOUT_CACHE_DIR ||= join(tmpdir(), `oa-layout-test-${randomUUID()}`);
