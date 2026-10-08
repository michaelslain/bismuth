/** Is this vault root inside a dev vault — some path segment starting `.dev-vault` (`.dev-vault`,
 *  `.dev-vault-alex` …)? The repo's generated example vault lives at `<repo>/.dev-vault/vault` and
 *  must never reach the machine daemon. PURE and dependency-free on purpose: the compiled daemon
 *  imports this file directly, so it must not drag core's Bun-only modules into that bundle. */
export function isDevVaultRoot(root: string): boolean {
    return root.split(/[/\\]+/).some(seg => seg.startsWith('.dev-vault'))
}
