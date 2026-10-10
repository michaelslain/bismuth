// The vault map: a bounded structural overview of a vault (folders, clusters, hubs, tags, surfaces)
// and the local neighbourhood of one note, for agents that need orientation before searching.
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { getFileAccess } from './fileAccess'
import { readAllNotes } from './readAllNotes'
import { mapWithConcurrency } from './concurrency'
import { buildVaultGraph } from './vault'
import { detectCommunityHierarchy } from './community'
import { parseFrontmatter } from './frontmatter'
import { extractTags } from './tags'
import { extractWikilinks } from './wikilinks'
import { extractTasks } from './taskParse'
import { isBasePath } from './bases/baseFile'
import { isDeniedPath, type DenyEntry } from './visibility'
import type { GraphNode } from './graph'

export type VaultMapFolder = { path: string; notes: number; recent: number; kinds: string[]; keys: string[]; naming?: string }
export type VaultMapCluster = { id: string; label: string; size: number; exemplars: string[]; folders: string[] }
export type VaultMapHub = { path: string; inLinks: number; outLinks: number; cluster?: string }
export type VaultMap = {
    notes: number
    folders: VaultMapFolder[]
    clusters: VaultMapCluster[]
    hubs: VaultMapHub[]
    tags: { tag: string; count: number }[]
    surfaces: { bases: string[]; taskNotes: number; taskFolders: string[]; flashcardNotes: number; dailyFolder?: string; templatesFolder?: string }
    recent: { path: string; updated: string }[]
    builtAt: string
}

const DAY_MS = 86_400_000
const RECENT_DAYS = 14
const MIN_CLUSTER_NOTES = 3
// Mirrors stampCommunities (engine.ts): a graph under this many nodes is left unclustered.
const MIN_NODES_FOR_CLUSTERING = 30
const MAX_HUBS = 10
const MAX_RECENT = 10
const DATE_NAME = /^\d{4}-\d{2}-\d{2}(?:\b|_|\s|$)/

type NoteInfo = {
    id: string
    rel: string
    folder: string
    keys: string[]
    kind?: string
    tags: string[]
    mtime: number
    openTasks: boolean
    isBase: boolean
}

type Loaded = {
    nodes: GraphNode[]
    notes: Map<string, NoteInfo>
    out: Map<string, Set<string>>
    back: Map<string, Set<string>>
    tagsOf: Map<string, string[]>
    tagCounts: Map<string, number>
    cluster: Map<string, { id: string; label: string }>
    members: Map<string, string[]>
    degree: Map<string, number>
}

function topN(counts: Map<string, number>, n: number): string[] {
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, n)
        .map(([k]) => k)
}

function bump(m: Map<string, number>, k: string, by = 1) {
    m.set(k, (m.get(k) ?? 0) + by)
}

function folderPrefix(folder: string, depth: number): string {
    return folder.split('/').slice(0, depth).join('/')
}

async function load(
    root: string,
    deny: DenyEntry[],
    withMeta: boolean,
): Promise<Loaded> {
    const { graph } = await buildVaultGraph(root)
    const denied = (rel: string) => deny.length > 0 && isDeniedPath(deny, rel)

    // Visibility first: a denied note must not shape clusters, labels, degrees or counts.
    const dropped = new Set<string>()
    for (const n of graph.nodes)
        if (n.kind === 'note' && denied(`${n.id}.md`)) dropped.add(n.id)
    const edges = graph.edges.filter(
        e => !dropped.has(e.from) && !dropped.has(e.to),
    )
    const live = new Set<string>()
    for (const e of edges) {
        live.add(e.from)
        live.add(e.to)
    }
    const nodes = graph.nodes.filter(
        n =>
            !dropped.has(n.id) &&
            (n.kind !== 'tag' || live.has(n.id)),
    )

    const noteNodes = nodes.filter(n => n.kind === 'note')
    const notes = new Map<string, NoteInfo>()
    const rels = noteNodes.map(n => `${n.id}.md`)
    const { statNote } = await getFileAccess()
    const contents = withMeta
        ? await readAllNotes(root, rels)
        : []
    const mtimes = new Map<string, number>()
    if (withMeta) {
        await mapWithConcurrency(rels, 32, async rel => {
            const st = await statNote(root, rel).catch(() => null)
            if (st) mtimes.set(rel, st.mtimeMs)
        })
    }
    const contentOf = new Map(contents.map(c => [c.rel, c.content]))
    for (const n of noteNodes) {
        const rel = `${n.id}.md`
        const slash = rel.lastIndexOf('/')
        const info: NoteInfo = {
            id: n.id,
            rel,
            folder: slash >= 0 ? rel.slice(0, slash) : '',
            keys: [],
            tags: [],
            mtime: mtimes.get(rel) ?? 0,
            openTasks: false,
            isBase: false,
        }
        const content = contentOf.get(rel)
        if (content !== undefined) {
            const { data, body } = parseFrontmatter(content)
            info.keys = Object.keys(data)
            if (typeof data.type === 'string') info.kind = data.type
            info.isBase = data.type === 'base'
            info.tags = extractTags(data, body)
            if (content.includes('[ ]') || content.includes('[/]'))
                info.openTasks = extractTasks(content, rel).some(
                    t => t.status === 'todo' || t.status === 'in-progress',
                )
        }
        notes.set(n.id, info)
    }

    const out = new Map<string, Set<string>>()
    const back = new Map<string, Set<string>>()
    const tagsOf = new Map<string, string[]>()
    const tagCounts = new Map<string, number>()
    const degree = new Map<string, number>()
    for (const e of edges) {
        if (e.kind === 'tag') {
            const t = e.to.slice('tag:'.length)
            if (!tagsOf.has(e.from)) tagsOf.set(e.from, [])
            tagsOf.get(e.from)!.push(t)
            bump(tagCounts, t)
            continue
        }
        if (e.kind !== 'link' || e.from === e.to) continue
        if (!out.has(e.from)) out.set(e.from, new Set())
        if (!back.has(e.to)) back.set(e.to, new Set())
        out.get(e.from)!.add(e.to)
        back.get(e.to)!.add(e.from)
    }
    for (const id of notes.keys())
        degree.set(id, (out.get(id)?.size ?? 0) + (back.get(id)?.size ?? 0))

    const cluster = new Map<string, { id: string; label: string }>()
    const members = new Map<string, string[]>()
    if (nodes.length >= MIN_NODES_FOR_CLUSTERING) {
        const assign = detectCommunityHierarchy(
            nodes.map(n => ({ id: n.id, label: n.label, kind: n.kind })),
            edges.map(e => ({ from: e.from, to: e.to })),
        )
        const byComm = new Map<number, { label: string; ids: string[] }>()
        for (const n of nodes) {
            const a = assign.get(n.id)
            if (!a) continue
            const g = byComm.get(a.community) ?? { label: a.label, ids: [] }
            g.ids.push(n.id)
            byComm.set(a.community, g)
        }
        for (const [c, g] of byComm) {
            const noteIds = g.ids.filter(id => notes.has(id))
            const id = `c${c}`
            members.set(id, noteIds)
            for (const nid of noteIds) cluster.set(nid, { id, label: g.label })
        }
    }
    return {
        nodes,
        notes,
        out,
        back,
        tagsOf,
        tagCounts,
        cluster,
        members,
        degree,
    }
}

export async function buildVaultMap(
    root: string,
    opts?: { deny?: DenyEntry[]; now?: Date },
): Promise<VaultMap> {
    const deny = opts?.deny ?? []
    const now = opts?.now ?? new Date()
    const L = await load(root, deny, true)
    const cutoff = now.getTime() - RECENT_DAYS * DAY_MS
    const all = [...L.notes.values()]

    // folders: top two levels, one pass over the notes
    type Acc = {
        notes: number
        recent: number
        keys: Map<string, number>
        kinds: Map<string, number>
        dated: number
    }
    const acc = new Map<string, Acc>()
    const touch = (path: string): Acc => {
        let a = acc.get(path)
        if (!a) {
            a = {
                notes: 0,
                recent: 0,
                keys: new Map(),
                kinds: new Map(),
                dated: 0,
            }
            acc.set(path, a)
        }
        return a
    }
    for (const n of all) {
        const base = n.rel.slice(n.rel.lastIndexOf('/') + 1).replace(/\.md$/i, '')
        const paths = n.folder
            ? [folderPrefix(n.folder, 1), folderPrefix(n.folder, 2)]
            : ['(root)']
        for (const p of new Set(paths)) {
            const a = touch(p)
            a.notes++
            if (n.mtime >= cutoff) a.recent++
            for (const k of n.keys) bump(a.keys, k)
            if (n.kind) bump(a.kinds, n.kind)
            if (DATE_NAME.test(base)) a.dated++
        }
    }
    const folders: VaultMapFolder[] = [...acc.entries()]
        .map(([path, a]) => ({
            path,
            notes: a.notes,
            recent: a.recent,
            kinds: topN(a.kinds, 3).filter(k => a.kinds.get(k)! / a.notes >= 0.3),
            keys: topN(a.keys, 5),
            ...(a.dated >= 3 && a.dated / a.notes >= 0.6
                ? { naming: 'YYYY-MM-DD' }
                : {}),
        }))
        .sort(
            (a, b) =>
                b.notes - a.notes || (a.path < b.path ? -1 : 1),
        )

    // clusters
    const clusters: VaultMapCluster[] = []
    for (const [id, ids] of L.members) {
        if (ids.length < MIN_CLUSTER_NOTES) continue
        const ranked = ids
            .map(nid => ({
                id: nid,
                label: nid.slice(nid.lastIndexOf('/') + 1),
                degree: L.degree.get(nid) ?? 0,
            }))
            .sort(
                (a, b) =>
                    b.degree - a.degree || (a.id < b.id ? -1 : 1),
            )
        const fc = new Map<string, number>()
        for (const nid of ids) {
            const f = L.notes.get(nid)!.folder
            bump(fc, f ? folderPrefix(f, 2) : '(root)')
        }
        clusters.push({
            id,
            label: L.cluster.get(ids[0])!.label,
            size: ids.length,
            exemplars: ranked.slice(0, 3).map(r => `${r.id}.md`),
            folders: topN(fc, 3),
        })
    }
    clusters.sort((a, b) => b.size - a.size || (a.id < b.id ? -1 : 1))

    // hubs
    const hubs: VaultMapHub[] = all
        .map(n => ({
            path: n.rel,
            inLinks: L.back.get(n.id)?.size ?? 0,
            outLinks: L.out.get(n.id)?.size ?? 0,
            cluster: L.cluster.get(n.id)?.id,
        }))
        .filter(h => h.inLinks + h.outLinks > 0)
        .sort(
            (a, b) =>
                b.inLinks + b.outLinks - (a.inLinks + a.outLinks) ||
                (a.path < b.path ? -1 : 1),
        )
        .slice(0, MAX_HUBS)
    for (const h of hubs) if (h.cluster === undefined) delete h.cluster

    // surfaces
    const { listBases } = await getFileAccess()
    const baseFiles = (await listBases(root).catch(() => [] as string[])).filter(
        p => isBasePath(p) && !(deny.length > 0 && isDeniedPath(deny, p)),
    )
    const bases = [
        ...new Set([...baseFiles, ...all.filter(n => n.isBase).map(n => n.rel)]),
    ].sort()
    const taskFolderCounts = new Map<string, number>()
    let taskNotes = 0
    let flashcardNotes = 0
    for (const n of all) {
        if (n.openTasks) {
            taskNotes++
            bump(
                taskFolderCounts,
                n.folder ? folderPrefix(n.folder, 1) : '(root)',
            )
        }
        if (n.tags.includes('flashcards')) flashcardNotes++
    }
    const dated = folders.filter(
        f =>
            f.naming === 'YYYY-MM-DD' &&
            f.path !== '(root)' &&
            !/(^|\/)archive/i.test(f.path),
    )
    const dailyFolder = dated.sort(
        (a, b) => b.recent - a.recent || b.notes - a.notes,
    )[0]?.path
    const templatesFolder = folders.find(f =>
        /^templates?$/i.test(f.path.slice(f.path.lastIndexOf('/') + 1)),
    )?.path
    const surfaces: VaultMap['surfaces'] = {
        bases,
        taskNotes,
        taskFolders: topN(taskFolderCounts, 3),
        flashcardNotes,
    }
    if (dailyFolder) surfaces.dailyFolder = dailyFolder
    if (templatesFolder) surfaces.templatesFolder = templatesFolder

    const recent = all
        .filter(n => n.mtime >= cutoff)
        .sort((a, b) => b.mtime - a.mtime || (a.rel < b.rel ? -1 : 1))
        .slice(0, MAX_RECENT)
        .map(n => ({ path: n.rel, updated: new Date(n.mtime).toISOString() }))

    const tags = [...L.tagCounts.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, 15)
        .map(([tag, count]) => ({ tag, count }))

    return {
        notes: all.length,
        folders,
        clusters,
        hubs,
        tags,
        surfaces,
        recent,
        builtAt: now.toISOString(),
    }
}

type Detail = {
    bases: number // base names listed (0 = count and folders only)
    recent: boolean
    tags: boolean
    exemplars: boolean
    clusters: number
    hubs: number
    sub: number // second-level folder lines
    folderDetail: boolean
}

function render(map: VaultMap, d: Detail): string {
    const lines: string[] = []
    lines.push(`# vault map (${map.notes} notes)`)
    const tops = map.folders.filter(f => !f.path.includes('/'))
    const subs = map.folders.filter(f => f.path.includes('/'))
    lines.push('', '## folders')
    const fline = (f: VaultMapFolder, indent: string) => {
        let s = `${indent}- ${f.path}/ ${f.notes}`
        if (f.path === '(root)') s = `${indent}- (root) ${f.notes}`
        if (d.folderDetail) {
            if (f.recent) s += `, ${f.recent} recent`
            if (f.kinds.length) s += `, types: ${f.kinds.join(' ')}`
            if (f.keys.length) s += `, keys: ${f.keys.join(' ')}`
            if (f.naming) s += `, named ${f.naming}`
        }
        return s
    }
    for (const t of tops) {
        lines.push(fline(t, ''))
        for (const s of subs
            .filter(s => s.path.startsWith(`${t.path}/`))
            .slice(0, d.sub))
            lines.push(fline(s, '  '))
    }
    if (d.hubs > 0 && map.hubs.length) {
        lines.push('', '## hubs')
        for (const h of map.hubs.slice(0, d.hubs))
            lines.push(`- ${h.path} (${h.inLinks} in, ${h.outLinks} out)`)
    }
    if (d.clusters > 0 && map.clusters.length) {
        lines.push('', '## clusters')
        for (const c of map.clusters.slice(0, d.clusters)) {
            let s = `- ${c.label} (${c.size})`
            if (d.exemplars)
                s += `: ${c.exemplars.join(', ')}; in ${c.folders.join(', ')}`
            lines.push(s)
        }
    }
    const sf = map.surfaces
    const sl: string[] = []
    if (sf.bases.length) {
        const counts = new Map<string, number>()
        for (const b of sf.bases) {
            const i = b.lastIndexOf('/')
            bump(counts, i >= 0 ? folderPrefix(b.slice(0, i), 1) : '(root)')
        }
        const where = topN(counts, 3).join(', ')
        const names = sf.bases.slice(0, d.bases).join(', ')
        sl.push(
            `bases: ${sf.bases.length}${where ? ` (mostly in ${where})` : ''}${names ? `: ${names}` : ''}`,
        )
    }
    if (sf.taskNotes)
        sl.push(
            `open tasks in ${sf.taskNotes} notes${sf.taskFolders.length ? ` (mostly ${sf.taskFolders.join(', ')})` : ''}`,
        )
    if (sf.flashcardNotes) sl.push(`${sf.flashcardNotes} flashcard notes`)
    if (sf.dailyFolder) sl.push(`daily notes: ${sf.dailyFolder}/`)
    if (sf.templatesFolder) sl.push(`templates: ${sf.templatesFolder}/`)
    if (sl.length) lines.push('', '## surfaces', ...sl.map(s => `- ${s}`))
    if (d.tags && map.tags.length)
        lines.push(
            '',
            '## tags',
            map.tags.map(t => `#${t.tag} ${t.count}`).join(', '),
        )
    if (d.recent && map.recent.length) {
        lines.push('', '## recent')
        for (const r of map.recent) lines.push(`- ${r.path} ${r.updated.slice(0, 10)}`)
    }
    return lines.join('\n')
}

export function formatVaultMap(map: VaultMap, budgetChars: number): string {
    const full: Detail = {
        bases: 5,
        recent: true,
        tags: true,
        exemplars: true,
        clusters: 50,
        hubs: MAX_HUBS,
        sub: 5,
        folderDetail: true,
    }
    // Least important first: recent, tags, cluster exemplars, base names; clusters
    // stay until hubs and subfolder lines are already at their minimum.
    const lean: Detail = { ...full, recent: false, tags: false, exemplars: false }
    const ladder: Detail[] = [
        full,
        { ...full, recent: false },
        { ...full, recent: false, tags: false },
        lean,
        { ...lean, bases: 0 },
        { ...lean, bases: 0, clusters: 20, hubs: 5, sub: 3 },
        { ...lean, bases: 0, clusters: 10, hubs: 3, sub: 1 },
        { ...lean, bases: 0, clusters: 5, hubs: 3, sub: 0 },
        { ...lean, bases: 0, clusters: 5, hubs: 0, sub: 0 },
        { ...lean, bases: 0, clusters: 5, hubs: 0, sub: 0, folderDetail: false },
        { ...lean, bases: 0, clusters: 0, hubs: 0, sub: 0, folderDetail: false },
    ]
    let last = ''
    for (const d of ladder) {
        last = render(map, d)
        if (last.length <= budgetChars) return last
    }
    // Still too long (hundreds of top-level folders): cut at a line boundary.
    const cut = last.slice(0, budgetChars)
    const nl = cut.lastIndexOf('\n')
    return nl > 0 ? cut.slice(0, nl) : cut
}

export type VaultNeighbourhood = { path: string; cluster?: string; outLinks: string[]; backLinks: string[]; siblings: string[]; tags: string[]; memories: string[] }

export async function vaultNeighbourhood(
    root: string,
    note: string,
    opts?: { deny?: DenyEntry[]; memoryDir?: string; channel?: 'chat' | 'daemon' },
): Promise<VaultNeighbourhood | null> {
    const deny = opts?.deny ?? []
    const L = await load(root, deny, false)
    const id = note.replace(/\.md$/i, '')
    if (!L.notes.has(id)) return null
    const paths = (ids: Iterable<string> | undefined) =>
        [...(ids ?? [])].filter(i => L.notes.has(i)).map(i => `${i}.md`).sort()
    const c = L.cluster.get(id)
    const siblings = c
        ? (L.members.get(c.id) ?? [])
              .filter(i => i !== id)
              .sort(
                  (a, b) =>
                      (L.degree.get(b) ?? 0) - (L.degree.get(a) ?? 0) ||
                      (a < b ? -1 : 1),
              )
              .slice(0, 12)
              .map(i => `${i}.md`)
        : []
    const memories: string[] = []
    if (opts?.memoryDir) {
        const { listMarkdown } = await getFileAccess()
        const rels = await listMarkdown(opts.memoryDir).catch(() => [] as string[])
        const mem = await readAllNotes(opts.memoryDir, rels)
        const base = id.slice(id.lastIndexOf('/') + 1)
        const rel = relative(resolve(root), resolve(opts.memoryDir))
        const prefix = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : null
        // Strict by default: a memory note's own visibility decides, never the path prefix.
        const chatOk = opts.channel === 'chat'
        for (const m of mem) {
            const vis = parseFrontmatter(m.content).data.visibility
            if (vis === 'hidden' || (vis === 'chat-only' && !chatOk)) continue
            if (prefix && deny.length > 0 && isDeniedPath(deny, `${prefix}/${m.rel}`))
                continue
            if (extractWikilinks(m.content).some(t => t === base || t === id))
                memories.push(m.rel.replace(/\.md$/i, ''))
        }
        memories.sort()
    }
    return {
        path: `${id}.md`,
        ...(c ? { cluster: c.label } : {}),
        outLinks: paths(L.out.get(id)),
        backLinks: paths(L.back.get(id)),
        siblings,
        tags: [...(L.tagsOf.get(id) ?? [])].sort(),
        memories,
    }
}
