// Exercises the ACTUAL mock LLM server (`llmock`, from the @copilotkit/aimock devDependency)
// end-to-end — never a real model API, and no dependency on any agent CLI being installed (this
// harness itself doesn't spawn claude/codex/opencode/etc; core/test/support/backendEnv.ts's per-CLI
// mapping is exercised as a pure function here, not by actually running a CLI).
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DEFAULT_FIXTURE_DIR, startMockLlm } from './mockLlm'
import { backendMockEnv } from './backendEnv'
import { BACKEND_IDS } from '../../src/agentBackends/catalog'

describe('startMockLlm', () => {
    test("serves the fixture's response over an Anthropic-shaped /v1/messages call, then fully tears down on stop()", async () => {
        const mock = await startMockLlm(DEFAULT_FIXTURE_DIR)
        expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

        const res = await fetch(`${mock.url}/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model: 'claude-haiku-4-5',
                max_tokens: 100,
                messages: [{ role: 'user', content: 'hello' }],
            }),
        })
        expect(res.status).toBe(200)
        const body = (await res.json()) as {
            content: { type: string; text: string }[]
        }
        expect(body.content[0].text).toBe('Hello!')

        await mock.stop()

        // The port must be genuinely released, not just "the process we hold a reference to says
        // it exited" — prove it by trying to reach the exact same URL and observing a connection
        // failure (nothing is listening there any more), the same check used to verify this live
        // during development.
        await expect(
            fetch(`${mock.url}/v1/messages`, {
                signal: AbortSignal.timeout(2000),
            }),
        ).rejects.toThrow()
    }, 20_000)

    test(
        "rejects rather than hanging when the fixture directory doesn't exist (verified live: llmock prints " +
            '"Fixtures path not found" and exits immediately without ever printing its listening banner)',
        async () => {
            await expect(
                startMockLlm('/nonexistent-fixture-dir-for-real'),
            ).rejects.toThrow()
        },
        20_000,
    )

    // Reproduces (rather than infers) the orphan-child failure mode: a caller that starts a mock
    // server and then crashes — an uncaught exception, never reaching stop() — must not leave the
    // spawned `node .../aimock/dist/cli.js` running forever, holding its port. This can't be proven
    // from INSIDE this test process (this process reaching its own "exit" would tear down the whole
    // test run), so it drives a genuinely separate `bun` child: that child starts a mock server,
    // prints its URL, then throws — simulating exactly the crash-before-stop() scenario — and this
    // test asserts the mock's port is unreachable once that child has actually exited, proving
    // mockLlm.ts's own `process.on("exit", …)` safety net fired inside the child.
    //
    // SCOPE (final-review finding, do not over-read this test): the child above is a plain
    // `bun run script.ts`, NOT a `bun test` process — this test certifies the safety net for that
    // ONE context (a standalone script/host), which is a REAL and useful property but is NOT the
    // context every *Mocked.test.ts file in this suite actually runs in. Under `bun test` itself,
    // `process.on("exit", …)` handlers were separately confirmed to never fire at all (see
    // mockLlm.ts's own header, and core/test/chatProviders/opencodeMocked.test.ts's) — teardown there
    // relies entirely on each test file's own `afterAll(() => mock?.stop())`, not on this mechanism.
    // Do not read a green run of this test as "the suite is protected against a crashing test file
    // leaking a mock server" — it isn't, by this mechanism; `afterAll` is what does that job in
    // `bun test`.
    test("an abnormal exit (crash before stop()) does not orphan the mock server — process.on('exit') safety net", async () => {
        const scriptDir = mkdtempSync(join(tmpdir(), 'mockllm-crash-test-'))
        const scriptPath = join(scriptDir, 'crash.ts')
        const mockLlmSpecifier = pathToFileURL(
            join(import.meta.dir, 'mockLlm.ts'),
        ).href
        writeFileSync(
            scriptPath,
            [
                `import { startMockLlm } from ${JSON.stringify(mockLlmSpecifier)};`,
                `const mock = await startMockLlm(${JSON.stringify(DEFAULT_FIXTURE_DIR)});`,
                `console.log("MOCK_URL:" + mock.url);`,
                `throw new Error("simulated crash — deliberately never calls stop()");`,
                '',
            ].join('\n'),
        )

        const child = Bun.spawn(['bun', 'run', scriptPath], {
            stdout: 'pipe',
            stderr: 'pipe',
        })

        // Read stdout only until the URL line arrives — the child crashes right after printing it,
        // so its stdout closes on its own shortly after.
        let out = ''
        let url = ''
        const decoder = new TextDecoder()
        for await (const chunk of child.stdout as ReadableStream<Uint8Array>) {
            out += decoder.decode(chunk, { stream: true })
            const m = out.match(/MOCK_URL:(\S+)/)
            if (m) {
                url = m[1]
                break
            }
        }
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

        const code = await child.exited
        expect(code).not.toBe(0) // confirms it really crashed rather than exiting cleanly

        // The grandchild mock server must not survive its parent's crash. Poll briefly: the exit
        // handler's kill() fires synchronously inside the child, but the OS can take a moment to
        // fully release the socket after that.
        const deadline = Date.now() + 5000
        let stillListening = true
        while (stillListening && Date.now() < deadline) {
            try {
                await fetch(url, { signal: AbortSignal.timeout(300) })
                await new Promise(r => setTimeout(r, 100))
            } catch {
                stillListening = false
            }
        }
        expect(stillListening).toBe(false)
    }, 20_000)
})

describe('backendMockEnv', () => {
    const MOCK_URL = 'http://127.0.0.1:54321'

    test('EVERY backend id core/src/agentBackends/catalog.ts knows about is covered by backendMockEnv, as a real mapping or an explicit throw — a true drift guard', () => {
        // FINAL-REVIEW FINDING (Important #3): the previous version of this test was titled as a
        // universally-quantified drift guard ("every backend id...") but its BODY iterated a hardcoded
        // 4-entry array — adding a 10th id to BACKEND_IDS (9 entries today) could never fail it. Fixed
        // by iterating BACKEND_IDS itself; the `default` arm below is the actual guard — it throws with
        // an explanatory message for any id this switch doesn't yet know how to check, so a newly-added
        // backend fails LOUD here until a real case is added for it, rather than silently passing by
        // never being iterated at all.
        for (const id of BACKEND_IDS) {
            switch (id) {
                // Plain env-var mappings — no workDir, mockUrl appears directly in a returned env VALUE.
                case 'claude':
                case 'opencode':
                case 'gemini':
                case 'goose': {
                    const env = backendMockEnv(id, MOCK_URL)
                    expect(Object.keys(env).length).toBeGreaterThan(0)
                    expect(
                        Object.values(env).some(v => v.includes(MOCK_URL)),
                    ).toBe(true)
                    break
                }
                // File-based mapping (see backendEnv.ts's own case comments): requires a workDir (throws
                // without one), and the mock URL lands in a FILE this call writes into that dir — never in
                // the returned env object's own values (those are just paths/keys). codex is ALONE in this
                // shape now: openclaw and cline each got their OWN dedicated case below once their own config
                // layouts stopped fitting a flat `readdirSync(dir)` scan (openclaw's workDir grew `state`/
                // `workspace` SUBDIRECTORIES a flat readdirSync+readFileSync would throw EISDIR on; cline's
                // providers.json lives one directory DEEPER, `<workDir>/data/settings/providers.json`, not
                // `<workDir>/*`) — corrected here after a code-review finding on an earlier draft of this
                // comment overstated the grouping.
                case 'codex': {
                    expect(() => backendMockEnv(id, MOCK_URL)).toThrow(
                        /workDir/,
                    )
                    const dir = mkdtempSync(
                        join(tmpdir(), `backendenv-driftguard-${id}-`),
                    )
                    const env = backendMockEnv(id, MOCK_URL, dir)
                    expect(Object.keys(env).length).toBeGreaterThan(0)
                    const written = readdirSync(dir)
                        .map(f => readFileSync(join(dir, f), 'utf8'))
                        .join('\n')
                    expect(written).toContain(MOCK_URL)
                    break
                }
                // File-based AND a required 4th `openclawGatewayPort` argument (its Gateway process and the
                // ACP bridge must agree on a port via the SAME written config — see backendEnv.ts's own
                // case comment and openclawGateway.ts). Reads the one config file directly rather than
                // globbing the workDir (which also now contains `state`/`workspace` SUBDIRECTORIES this
                // call mkdirSync's — readdirSync+readFileSync over those would throw EISDIR).
                case 'openclaw': {
                    expect(() => backendMockEnv(id, MOCK_URL)).toThrow(
                        /workDir/,
                    )
                    const dir = mkdtempSync(
                        join(tmpdir(), `backendenv-driftguard-${id}-`),
                    )
                    expect(() => backendMockEnv(id, MOCK_URL, dir)).toThrow(
                        /openclawGatewayPort/,
                    )
                    const env = backendMockEnv(id, MOCK_URL, dir, 47600)
                    expect(Object.keys(env).length).toBeGreaterThan(0)
                    expect(
                        readFileSync(join(dir, 'openclaw.json5'), 'utf8'),
                    ).toContain(MOCK_URL)
                    break
                }
                // File-based, one directory DEEPER than codex/openclaw's own config files
                // (`<workDir>/data/settings/providers.json`, not `<workDir>/*`) — reads that ONE known path
                // directly rather than reusing the flat `readdirSync(dir)` codex gets away with.
                case 'cline': {
                    expect(() => backendMockEnv(id, MOCK_URL)).toThrow(
                        /workDir/,
                    )
                    const dir = mkdtempSync(
                        join(tmpdir(), `backendenv-driftguard-${id}-`),
                    )
                    const env = backendMockEnv(id, MOCK_URL, dir)
                    expect(Object.keys(env).length).toBeGreaterThan(0)
                    const written = readFileSync(
                        join(dir, 'data', 'settings', 'providers.json'),
                        'utf8',
                    )
                    expect(written).toContain(`${MOCK_URL}/v1`)
                    break
                }
                // Hidden ACP-ADAPTER entries (catalog.ts's `hidden` doc comment): each bridges a CLI that
                // already has its own native row above (claude, codex) — deliberately never given a
                // SEPARATE row of their own, so this function throws (an unknown id in the switch) rather
                // than silently returning {}.
                case 'claude-code-acp':
                case 'codex-acp':
                    expect(() => backendMockEnv(id, MOCK_URL)).toThrow()
                    break
                default:
                    // A NEW id landed in BACKEND_IDS that this switch has no case for — this is the guard
                    // actually firing. Add a case above (and a real row or an explicit throw in
                    // backendEnv.ts) rather than widening this default to swallow it.
                    throw new Error(
                        `mockLlm.test.ts's drift guard has no case for backend id "${id}" — add one above (and a matching row/throw in backendEnv.ts) before this can pass.`,
                    )
            }
        }
    })

    test('claude maps ANTHROPIC_BASE_URL/AUTH_TOKEN/API_KEY — verified live end-to-end', () => {
        expect(backendMockEnv('claude', MOCK_URL)).toEqual({
            ANTHROPIC_BASE_URL: MOCK_URL,
            ANTHROPIC_AUTH_TOKEN: 'mock',
            ANTHROPIC_API_KEY: 'mock',
        })
    })

    test('codex requires a workDir (its real mechanism is a $CODEX_HOME/config.toml file, not a bare env var — verified live this task; the old OPENAI_BASE_URL row was confirmed WRONG)', () => {
        expect(() => backendMockEnv('codex', MOCK_URL)).toThrow(/workDir/)

        const dir = mkdtempSync(join(tmpdir(), 'backendenv-codex-test-'))
        const env = backendMockEnv('codex', MOCK_URL, dir)
        expect(env.CODEX_HOME).toBe(dir)
        const toml = readFileSync(join(dir, 'config.toml'), 'utf8')
        expect(toml).toContain(`base_url = "${MOCK_URL}/v1"`)
        expect(toml).toContain('wire_api = "responses"') // "chat" is REJECTED by this codex version
        expect(toml).toContain('model_provider = "mock"')
    })

    test('opencode maps a runtime OPENCODE_CONFIG_CONTENT carrying an inline custom-provider block pointed at the mock', () => {
        const env = backendMockEnv('opencode', MOCK_URL)
        const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT)
        expect(config.provider.mock.options.baseURL).toBe(`${MOCK_URL}/v1`)
    })

    test('gemini maps GOOGLE_GEMINI_BASE_URL/GEMINI_API_KEY — env routing, old-shape handshake, AND full turn completion all verified live (see the case comment)', () => {
        expect(backendMockEnv('gemini', MOCK_URL)).toEqual({
            GOOGLE_GEMINI_BASE_URL: MOCK_URL,
            GEMINI_API_KEY: 'mock',
        })
    })

    test("cline requires a workDir (its real mechanism is a $CLINE_DIR/data/settings/providers.json file — a LATER task found a live-verified CLINE_API_KEY bypass; see backendEnv.ts's case comment for the full, source-cited finding, correcting this row's earlier 'no bypass exists' conclusion)", () => {
        expect(() => backendMockEnv('cline', MOCK_URL)).toThrow(/workDir/)

        const dir = mkdtempSync(join(tmpdir(), 'backendenv-cline-test-'))
        const env = backendMockEnv('cline', MOCK_URL, dir)
        expect(env.CLINE_DIR).toBe(dir)
        expect(env.CLINE_PROVIDER).toBe('openai-compatible')
        expect(env.CLINE_API_KEY).toBeTruthy()
        const providers = readFileSync(
            join(dir, 'data', 'settings', 'providers.json'),
            'utf8',
        )
        expect(providers).toContain(`${MOCK_URL}/v1`)
        expect(providers).toContain('"openai-compatible"')
    })

    test('goose maps ANTHROPIC_HOST + GOOSE_PROVIDER=anthropic — verified live end-to-end this task (upgraded from GUESSED)', () => {
        const env = backendMockEnv('goose', MOCK_URL)
        expect(env.ANTHROPIC_HOST).toBe(MOCK_URL)
        expect(env.GOOSE_PROVIDER).toBe('anthropic')
    })

    test('openclaw requires a workDir + a gateway port (a config.json5 file, not a bare env var); config redirection AND full-turn model routing both verified live (see the case comment)', () => {
        expect(() => backendMockEnv('openclaw', MOCK_URL)).toThrow(/workDir/)

        const dir = mkdtempSync(join(tmpdir(), 'backendenv-openclaw-test-'))
        expect(() => backendMockEnv('openclaw', MOCK_URL, dir)).toThrow(
            /openclawGatewayPort/,
        )

        const env = backendMockEnv('openclaw', MOCK_URL, dir, 47601)
        expect(env.OPENCLAW_CONFIG_PATH).toBe(join(dir, 'openclaw.json5'))
        expect(env.OPENCLAW_STATE_DIR).toBe(join(dir, 'state'))
        const config = JSON.parse(
            readFileSync(env.OPENCLAW_CONFIG_PATH, 'utf8'),
        )
        expect(config.models.providers.mock.baseUrl).toBe(`${MOCK_URL}/v1`)
        expect(config.gateway.port).toBe(47601)
        expect(config.gateway.mode).toBe('local')
        // The other required-but-non-obvious config this file's case comment documents as load-bearing
        // (not cosmetic) — see backendEnv.ts's openclaw case for why each of these is needed for a turn
        // to complete at all, not just test hygiene.
        expect(config.agents.defaults.workspace).toBe(join(dir, 'workspace'))
        expect(config.agents.defaults.skipBootstrap).toBe(true)
        expect(config.canvasHost.enabled).toBe(false)
        expect(config.browser.enabled).toBe(false)
        expect(config.update.checkOnStart).toBe(false)
    })

    test('an unrecognized backend id throws rather than silently returning an empty (no-op) mapping', () => {
        expect(() => backendMockEnv('not-a-real-backend', MOCK_URL)).toThrow()
    })
})
