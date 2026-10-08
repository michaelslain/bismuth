// Prebuild step: compile the core server into a standalone Tauri sidecar binary.
//
// core (the @bismuth/core HTTP server) is plain Bun/TS and compiles to a single self-contained
// executable (native deps like bun-pty are embedded). Unlike claude-bot (which must ship as source
// because its daemon spawns `bun run` itself), core just needs to run, so a compiled binary is the
// simplest shippable form — a Tauri "sidecar".
//
// It goes through the `Bun.build` API rather than `bun build --compile` because recall's semantic
// channel (core/src/memoryEmbed.ts → @huggingface/transformers → onnxruntime-node) needs three build
// patches the CLI cannot express — see `semanticPatches` below. A naive compile starts and then dies
// the first time the embedder loads. Proven in .claude/bust/memory-recall-spike.md.
//
// Signed builds run it under the hardened runtime: ../src-tauri/Entitlements.plist is what lets it
// JIT and dlopen the bun-pty library it extracts at runtime. Without it the terminal is dead. The
// same entitlement covers the onnxruntime `.node` + dylib staged in resources/ort (see below).
//
// Tauri resolves sidecars by a target-triple suffix, so we name the output
// `bismuth-core-<triple>` and reference `binaries/bismuth-core` in tauri.conf.json
// (externalBin). The binary is heavy (~65MB) and platform-specific → gitignored.
//
// Run: cd app && bun run scripts/build-core-sidecar.ts   (or `bun run build:core-sidecar`)
// Wired into beforeBuildCommand so `tauri build` always has a fresh sidecar.
import { spawnSync } from 'node:child_process'
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { assertBuiltBinary, compileCwd } from './buildUtils'

const here = import.meta.dir
const appDir = join(here, '..') // app/
const repoRoot = join(appDir, '..') // repo root
const serverEntry = join(repoRoot, 'core', 'src', 'server.ts')
// The layout worker (core/src/layoutRunner.ts) is loaded by URL at runtime, which the bundler does not
// follow: a compile embeds a worker only when it is passed as an extra entrypoint. Without it
// the sidecar still works, but layoutRunner logs `[layout] worker unavailable` and every settle runs
// on the request thread again.
const layoutWorkerEntry = join(repoRoot, 'core', 'src', 'layoutWorker.ts')
const outDir = join(appDir, 'src-tauri', 'binaries')
// onnxruntime's native binding + its shared library, staged as a Tauri resource (tauri.conf.json
// `resources`). The compiled binary cannot carry them: an embedded `.node` is extracted without its
// sibling `libonnxruntime` (the rpath is `@loader_path`), so the loader looks beside the sidecar.
const ortOutDir = join(appDir, 'src-tauri', 'resources', 'ort')

// Target triple Tauri expects in the sidecar filename — taken from the Rust host.
function targetTriple(): string {
    const r = spawnSync('rustc', ['-Vv'], { encoding: 'utf8' })
    if (r.status !== 0) {
        console.error(
            'rustc not found — needed to resolve the sidecar target triple',
        )
        process.exit(1)
    }
    const host = r.stdout.split('\n').find(l => l.startsWith('host:'))
    if (!host) {
        console.error('could not parse `host:` from rustc -Vv')
        process.exit(1)
    }
    return host.replace('host:', '').trim()
}

const triple = targetTriple()
const outFile = join(outDir, `bismuth-core-${triple}`)
mkdirSync(outDir, { recursive: true })

// `@huggingface/transformers` resolves from core/, and its `onnxruntime-node` from there: the two can
// sit under different `.bun` store dirs, so never assume a hoisted `node_modules/onnxruntime-node`.
function ortPackageDir(): string {
    const tf = createRequire(join(repoRoot, 'core', 'package.json')).resolve(
        '@huggingface/transformers',
    )
    const entry = createRequire(tf).resolve('onnxruntime-node')
    const marker = `${join('/', 'onnxruntime-node')}`
    return entry.slice(0, entry.lastIndexOf(marker) + marker.length)
}

// Where the native binding is searched at runtime, first hit wins: an explicit override, beside the
// sidecar (`<MacOS>/ort`), then the staged Tauri resources (`<Contents>/Resources/resources/ort`, and
// the flat `Resources/ort` fallback `lib.rs` already tolerates for other resources).
const BINDING_LOADER = `(()=>{const p=require('path'),fs=require('fs');const x=p.dirname(process.execPath);const d=[process.env.BISMUTH_ORT_DIR,p.join(x,'ort'),p.join(x,'..','Resources','resources','ort'),p.join(x,'..','Resources','ort')].filter(Boolean).find(c=>fs.existsSync(p.join(c,'onnxruntime_binding.node')));if(!d)throw new Error('onnxruntime binding not found: ort/ is missing next to the sidecar');const m={exports:{}};process.dlopen(m,p.join(d,'onnxruntime_binding.node'));return m.exports})()`

// A patch that matches nothing is a silent regression (the build still succeeds and the sidecar then
// dies at the first semantic query), so every patch must change its file or the build fails.
function patched(
    path: string,
    pattern: string | RegExp,
    replacement: string,
): string {
    const src = readFileSync(path, 'utf8')
    const out = src.replace(pattern, () => replacement)
    if (out === src) throw new Error(`sidecar patch matched nothing in ${path}`)
    return out
}

// The string patches below are tied to ONE transformers + onnxruntime-node pair (core/package.json pins
// transformers exactly; bun.lock resolves it to this ort). Bump both together and re-prove the patches.
const PATCHED_ORT_VERSION = '1.30.0'

// Each hook records itself here. A hook that never fires (upstream renamed `transformers.node.mjs`,
// moved `binding.js`, changed the exports map) throws nothing by itself, so the build is checked below.
const applied = new Set<string>()
const REQUIRED_PATCHES = ['sharp', 'tf-require', 'ort-binding']

const semanticPatches: Bun.BunPlugin = {
    name: 'semantic-sidecar-patches',
    setup(b) {
        // 1. transformers imports `sharp` eagerly and the compiled binary throws "Could not load
        //    sharp". We never decode images, so stub it. (`--external sharp` is not enough.)
        b.onResolve({ filter: /^sharp$/ }, () => ({
            path: 'sharp',
            namespace: 'sharp-stub',
        }))
        b.onLoad({ filter: /.*/, namespace: 'sharp-stub' }, () => {
            applied.add('sharp')
            return {
                contents:
                    'export default function sharp(){ throw new Error("sharp is stubbed in the sidecar") }',
                loader: 'js',
            }
        })
        // 2. transformers reaches ort via createRequire(...)("onnxruntime-node"), which the bundler
        //    cannot see. A literal require lets it bundle the package.
        b.onLoad({ filter: /transformers\.node\.mjs$/ }, a => {
            const contents = patched(
                a.path,
                'requireFromHere("onnxruntime-node")',
                'require("onnxruntime-node")',
            )
            applied.add('tf-require')
            return { contents, loader: 'js' }
        })
        // 3. binding.js requires a template-literal `.node` path; load it from the staged ort/ dir
        //    instead (see BINDING_LOADER).
        b.onLoad(
            { filter: /onnxruntime-node[\\/]dist[\\/]binding\.js$/ },
            a => {
                const contents = patched(
                    a.path,
                    /require\(`\.\.\/bin\/napi-v6\/.*?\.node`\)/,
                    BINDING_LOADER,
                )
                applied.add('ort-binding')
                return { contents, loader: 'js' }
            },
        )
    },
}

// Stage `ort/`: every file in the package's napi-v6/<platform>/<arch> dir (the binding plus whatever
// shared libraries that platform's build links against — the names carry the ort version).
function stageOrt() {
    const pkgDir = ortPackageDir()
    const version = JSON.parse(
        readFileSync(join(pkgDir, 'package.json'), 'utf8'),
    ).version
    if (version !== PATCHED_ORT_VERSION) {
        console.error(
            `onnxruntime-node ${version} is staged but the sidecar patches were written for ${PATCHED_ORT_VERSION}; re-prove them and bump PATCHED_ORT_VERSION`,
        )
        process.exit(1)
    }
    // BISMUTH_ORT_PLATFORM_OVERRIDE=<platform>/<arch> (e.g. darwin/x64) fakes a host the package ships
    // no binding for, to exercise the placeholder path below. Test hook only.
    const [platform, arch] = (
        process.env.BISMUTH_ORT_PLATFORM_OVERRIDE ??
        `${process.platform}/${process.arch}`
    ).split('/')
    const src = join(pkgDir, 'bin', 'napi-v6', platform, arch)
    rmSync(ortOutDir, { recursive: true, force: true })
    mkdirSync(ortOutDir, { recursive: true })
    if (!existsSync(src)) {
        // onnxruntime ships napi-v6/darwin/arm64 (plus linux/win) only. A host without a binding still
        // builds: tauri's `resources` check needs ort/ to exist, and at runtime the embed worker's load
        // fails ({ready:false}) so recall degrades to BM25 instead of crashing.
        console.warn(
            `warning: no onnxruntime binding for ${platform}/${arch} (${src}); semantic recall will fall back to BM25`,
        )
        writeFileSync(
            join(ortOutDir, 'README.md'),
            `No onnxruntime binding exists for ${platform}/${arch}, so this build has no semantic embedder (recall uses BM25).\n`,
        )
        return
    }
    for (const f of readdirSync(src))
        copyFileSync(join(src, f), join(ortOutDir, f))
    if (!existsSync(join(ortOutDir, 'onnxruntime_binding.node'))) {
        console.error('onnxruntime_binding.node missing after staging ort/')
        process.exit(1)
    }
    console.log(`staged ort → ${ortOutDir}`)
}

console.log(`compiling core → ${outFile}`)
stageOrt()
// bun writes its compile scratch file next to the CWD (see compileCwd), so build from there.
process.chdir(compileCwd(repoRoot))
const build = await Bun.build({
    entrypoints: [serverEntry, layoutWorkerEntry],
    compile: { outfile: outFile },
    plugins: [semanticPatches],
})
if (!build.success) {
    for (const log of build.logs) console.error(String(log))
    console.error('Bun.build --compile failed')
    process.exit(1)
}

const missing = REQUIRED_PATCHES.filter(n => !applied.has(n))
if (missing.length) {
    console.error(
        `sidecar build produced a binary whose embedder would die on first load: patch(es) never applied: ${missing.join(', ')} (upstream layout changed?)`,
    )
    process.exit(1)
}

// Smoke: the file exists and is non-trivial.
assertBuiltBinary(outFile, 'sidecar')
