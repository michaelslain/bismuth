// Test preload (registered in the repo-root bunfig.toml `[test].preload`).
// Redirects the layout disk cache to a throwaway temp dir so the test suite never writes to the real
// durable cache location (~/.bismuth/layout-cache). Must run before layout-cache.ts is imported — a
// preload does, which is why this lives here rather than in an individual test file (imports hoist).
import { afterAll } from 'bun:test'
import { sweepTempDirs, registerTempDir } from './tempDirs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

// Registered with the sweep as well: layout-cache.ts creates this dir lazily on first write, so it
// is not allocated through tempDir() and would otherwise be the one dir left behind every run.
const LAYOUT_CACHE_DIR = join(tmpdir(), `bismuth-layout-test-${randomUUID()}`)
process.env.BISMUTH_LAYOUT_CACHE_DIR ||= LAYOUT_CACHE_DIR
registerTempDir(LAYOUT_CACHE_DIR)

// Sweep every tracked throwaway dir at the end of the RUN. This lives in the preload on purpose:
// hooks registered here apply to all test files, whereas a hook in helpers.ts would register only
// for the first file that imported it. See core/test/tempDirs.ts for the measurements behind this.
afterAll(sweepTempDirs)
process.on('exit', sweepTempDirs)
