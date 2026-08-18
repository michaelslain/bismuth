// mcp/src/visibilityGate.ts
// MOVED to core/src/visibilityCliGate.ts, so the SAME gate also covers the `bismuth` CLI invoked
// directly (no MCP layer at all) — see that file's header for the full design (both entry points,
// both channel env vars, and why their "unset" defaults deliberately differ). Re-exported here
// unchanged so mcp/src/cli.ts (and this workspace's tests) keep working without churn. Tests moved
// to core/test/visibilityCliGate.test.ts.
export {
    gateCliArgs,
    decideCliGate,
    commandTier,
    mcpChannel,
    type CommandTier,
    type GateDecision,
} from '../../core/src/visibilityCliGate'
