// MCP <=> CLI parity table: every tool the MCP server can list, mapped to the `bismuth` CLI phrase
// that does the same thing. The project rule is "every MCP tool has a CLI twin, and every CLI
// command is reachable from MCP through bismuth_cli" — `cli/test/mcpParity.test.ts` pins both
// halves, so a tool added to server.ts without an entry here fails a test instead of shipping a
// capability only one surface has. `null` is reserved for the two tools that ARE the CLI bridge.
//
// A plain data module (no imports) so the CLI's test can load it without pulling in the server.
export const CLI_TWINS: Record<string, string | null> = {
    // always-on
    bismuth_docs_list: 'docs list',
    bismuth_docs_search: 'docs search',
    bismuth_docs_read: 'docs read',
    bismuth_doctor: 'doctor',
    bismuth_cli: null,
    bismuth_cli_help: null,
    // daemon-gated: memory
    remember: 'memory remember',
    recall: 'memory recall',
    forget: 'memory forget',
    // daemon-gated: daemon management (the phrases daemonCliArgs in daemon.ts runs)
    daemon_status: 'daemon status',
    daemon_devices: 'daemon devices',
    daemon_owner: 'daemon owner',
    daemon_list: 'daemon graph',
    cron_run: 'daemon cron run',
    cron_toggle: 'daemon cron toggle',
    process_toggle: 'daemon process toggle',
    daemon_logs: 'daemon logs',
    page_list: 'page list',
    page_create: 'page create',
    page_resolve: 'page resolve',
}
