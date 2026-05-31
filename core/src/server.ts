import { join } from "node:path";
import { watch } from "node:fs";
import { createSseRegistry } from "./sse";
import { buildGraph } from "./engine";
import { attachLayout } from "./layout-cache";
import { listTree, readNote, writeNote, moveEntry, deleteEntry, createEntry } from "./files";
import { commitVault, snapshotMessage } from "./backup";
import { parseFrontmatter, setFrontmatterKey, deleteFrontmatterKey } from "./frontmatter";
import { buildAgentGraph } from "./agents";
import { buildVaultRows } from "./basesData";
import { parseBaseFile } from "./bases/parse";
import { resolveSource } from "./bases/source";
import { upsertRow, deleteRow } from "./bases/rowOps";
import type { GraphData, TreeEntry } from "./graph";
import { collectVaultTasks, toggleTaskLine } from "./tasks";
import { todayISO } from "./dates";
import { collectDecks, dueCards, collectCards, noteCards, applyReview } from "./srs/cards";
import { applyReviewToRow } from "./srs/reviewRow";
import type { ReviewResponse } from "./srs/types";
import type { Row, SourceSpec } from "./bases/types";
import { createTerminalSession, killSession, resizeSession, getSession } from "./terminal";
import { createChangeTracker, isSettingsPath } from "./changeClassifier";
import { initializeSettings, getVaultSchema, serializeSettingsForFrontend, SETTINGS_FILE, readFolderIcons, setFolderIcon } from "./settings";

export interface CoreConfig { vault: string; memory?: string; port?: number }

const enc = new TextEncoder();
const dec = new TextDecoder();

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export function cliArg(name: string): string | undefined {
  const i = Bun.argv.indexOf(`--${name}`);
  return i >= 0 ? Bun.argv[i + 1] : undefined;
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function requireQueryParam(url: URL, param: string): string {
  const value = url.searchParams.get(param);
  if (!value) throw new Error(`missing ?${param}=`);
  return value;
}

/** Request handler type. */
type Handler = (req: Request, url: URL, cfg: CoreConfig) => Promise<Response> | Response;

export function createServer(cfg: CoreConfig) {
  // First launch: write a fully-commented settings.yaml from SETTINGS_SCHEMA.
  // Fire-and-forget so server start stays synchronous; the file lands within ms.
  // Swallow failures (e.g. a non-existent/read-only vault dir in tests) so a
  // missing-config write can never take the whole server down on boot.
  void initializeSettings(cfg.vault).catch(() => {});

  let cachedGraph: GraphData | null = null;
  let cachedTree: TreeEntry[] | null = null;
  let cachedRows: Row[] | null = null;
  let version = 0;
  const sse = createSseRegistry();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingVault = new Set<string>();
  let pendingVaultUnknown = false;
  let pendingMemory = false;

  // Tracks each note's graph/tree-relevant fingerprint (wikilinks + tags + icon),
  // so we can stay silent toward graph/tree consumers when a file is rewritten
  // without changing its connections — e.g. a bot status file restamped every
  // couple of seconds.
  const tracker = createChangeTracker();
  const isHidden = (p: string) => p.split("/").some((seg) => seg.startsWith("."));

  // Clear only the caches a change touched, bump version, and tell subscribers
  // exactly what's dirty. We always bump version (so the editor can reconcile an
  // externally-edited open file), but graph/tree consumers skip refetching when
  // their `dirty` flag is false.
  function applyDirty(paths: string[], dirty: { graph: boolean; tree: boolean }) {
    if (dirty.graph) cachedGraph = null;
    if (dirty.tree) cachedTree = null;
    // Bases rows derive from arbitrary frontmatter/body — rebuild lazily on next read.
    cachedRows = null;
    version++;
    sse.publish({ version, paths, dirty });
  }

  // Re-fingerprint changed vault notes; report whether the graph and/or tree
  // need to change. New/deleted notes are structural (both dirty); a content-only
  // edit that touches no link, tag, or icon is dirty to neither. Non-note and
  // unreadable (e.g. directory) paths are treated as structural to be safe;
  // hidden paths (.git/.trash) never affect graph or tree and are dropped.
  async function classifyVault(paths: string[]): Promise<{ graph: boolean; tree: boolean }> {
    let graph = false;
    let tree = false;
    const notePaths: string[] = [];
    for (const p of paths) {
      if (isHidden(p)) continue;
      if (isSettingsPath(p)) {
        // settings.yaml drives the property registry + appearance — both graph
        // and tree consumers should refetch; /schema reads it fresh on demand.
        graph = true;
        tree = true;
        continue;
      }
      if (!p.endsWith(".md")) { graph = true; tree = true; continue; }
      notePaths.push(p);
    }
    const d = await tracker.classify(notePaths, async (p) => {
      try {
        return (await Bun.file(join(cfg.vault, p)).exists()) ? await readNote(cfg.vault, p) : null;
      } catch {
        return null; // unreadable — treated as removed (structural)
      }
    });
    return { graph: graph || d.graph, tree: tree || d.tree };
  }

  // Single entry point for vault content/structure changes (API mutations +
  // file-watch). With no paths the change extent is unknown, so refresh both.
  async function invalidate(...paths: string[]) {
    const dirty = paths.length === 0
      ? { graph: true, tree: true }
      : await classifyVault(paths);
    applyDirty(paths, dirty);
  }

  /** Schedule vault changes for debounced processing. */
  function scheduleVault(path?: string): void {
    if (path) pendingVault.add(path);
    else pendingVaultUnknown = true;
    arm();
  }

  /** Schedule memory changes for debounced processing. */
  function scheduleMemory(): void {
    pendingMemory = true;
    arm();
  }

  function arm() {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const vaultPaths = [...pendingVault];
      const unknown = pendingVaultUnknown;
      const memory = pendingMemory;
      pendingVault.clear();
      pendingVaultUnknown = false;
      pendingMemory = false;
      void (async () => {
        let dirty = { graph: false, tree: false };
        if (unknown) {
          dirty = { graph: true, tree: true };
        } else if (vaultPaths.length) {
          dirty = await classifyVault(vaultPaths);
        }
        // Memory (3rd brain) feeds the graph, never the vault file tree.
        if (memory) dirty.graph = true;
        applyDirty(unknown ? [] : vaultPaths, dirty);
      })();
    }, 250);
  }

  async function readNoteOrEmpty(vault: string, path: string): Promise<string> {
    const fullPath = join(vault, path);
    const exists = await Bun.file(fullPath).exists();
    return exists ? await readNote(vault, path) : "";
  }

  try {
    watch(cfg.vault, { recursive: true }, (_event, filename) => {
      // Ignore churn in .git (backup commits) and .trash — neither feeds the
      // graph or tree. A null filename means "something changed, extent unknown".
      if (filename && isHidden(filename)) return;
      scheduleVault(filename ?? undefined);
    });
  } catch {
    // vault dir may not exist in test / CI environments
  }
  if (cfg.memory) {
    try {
      watch(cfg.memory, { recursive: true }, () => {
        scheduleMemory();
      });
    } catch {
      // memory dir may be absent
    }
  }

  const routes: Record<string, Handler> = {
    "GET /version": async (_, __) => {
      return Response.json({ version });
    },

    "GET /events": (_, __) => {
      let subscriber: ReadableStreamDefaultController<Uint8Array>;
      let heartbeat: ReturnType<typeof setInterval>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          subscriber = controller;
          sse.subscribe(controller);
          // Send initial snapshot so client knows current version without waiting for next invalidation.
          if (version > 0) {
            controller.enqueue(
              new TextEncoder().encode(`data: {"version":${version},"paths":[]}\n\n`),
            );
          }
          // SSE comment keeps TCP connection alive past Bun's default 10s idleTimeout.
          const ping = new TextEncoder().encode(`: keepalive\n\n`);
          heartbeat = setInterval(() => {
            try {
              controller.enqueue(ping);
            } catch {
              // controller already closed
            }
          }, 5000);
        },
        cancel() {
          clearInterval(heartbeat);
          sse.unsubscribe(subscriber);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        },
      });
    },

    "GET /graph": async (_, __) => {
      if (cachedGraph === null) {
        cachedGraph = attachLayout(await buildGraph(cfg.vault, cfg.memory), cfg.vault);
      }
      return Response.json(cachedGraph);
    },

    "GET /tree": async (_, __) => {
      if (cachedTree === null) cachedTree = await listTree(cfg.vault);
      // Overlay per-folder icons (stored in settings.yaml) onto directory entries.
      // Done per-request on a shallow copy so a folder-icon change is reflected
      // even when the underlying file tree (cachedTree) hasn't structurally changed
      // and so we never mutate the cache with a value tied to a specific request.
      const folderIcons = await readFolderIcons(cfg.vault);
      const entries = cachedTree.map((e) => {
        if (e.kind === "dir" && folderIcons[e.path]) {
          return { ...e, icon: folderIcons[e.path] };
        }
        return e;
      });
      return Response.json(entries);
    },

    "GET /vault-data": async (_, __) => {
      if (cachedRows === null) cachedRows = await buildVaultRows(cfg.vault);
      return Response.json(cachedRows);
    },

    "GET /base": async (_, url) => {
      const path = requireQueryParam(url, "file");
      // readNote() runs the path through resolveInVault (rejects traversal) and
      // throws on a missing file — both surface as 404, with no separate
      // exists() probe that could leak existence or race the read.
      let text: string;
      try {
        text = await readNote(cfg.vault, path);
      } catch {
        return new Response("not found", { status: 404 });
      }
      const name = path.split("/").pop()!.replace(/\.md$/, "");
      return Response.json(parseBaseFile(text, { name, path }));
    },

    "GET /file": async (_, url) => {
      const path = requireQueryParam(url, "path");
      // settings.yaml is opened as a normal file, but a vault that never had one
      // must not surface a blank editor — materialize the schema defaults on first
      // open. Idempotent (no-op if present); the boot init can't be relied on alone
      // since it's fire-and-forget and a long-running server may predate the file.
      if (path === SETTINGS_FILE) await initializeSettings(cfg.vault);
      const noteText = await readNoteOrEmpty(cfg.vault, path);
      return new Response(noteText, { status: 200 });
    },

    "PUT /file": async (req, __) => {
      const { path, contents } = (await req.json()) as { path: string; contents: string };
      await writeNote(cfg.vault, path, contents);
      await invalidate(path);
      return new Response("ok");
    },

    "GET /meta": async (_, url) => {
      const path = requireQueryParam(url, "path");
      const noteText = await readNoteOrEmpty(cfg.vault, path);
      const { data } = parseFrontmatter(noteText);
      return Response.json(data);
    },

    "GET /config": async (_, __) => {
      // Read-only view of how core was launched — surfaced in the settings page.
      return Response.json({ vault: cfg.vault, memory: cfg.memory ?? null });
    },

    "GET /settings": async (_, __) => {
      // Parsed app settings (file merged over defaults) for frontend hydration.
      return Response.json(await serializeSettingsForFrontend(cfg.vault));
    },

    "GET /schema": async (_, __) => {
      // Property registry (from settings.yaml `properties:`) for note validation + autocomplete.
      return Response.json(await getVaultSchema(cfg.vault));
    },

    "GET /agent-graph": async (_, __) => {
      return Response.json(buildAgentGraph());
    },

    "GET /tasks": async (_, __) => {
      return Response.json(await collectVaultTasks(cfg.vault));
    },

    // Single source-resolution endpoint: resolve a SourceSpec (base | notes | tasks)
    // to Row[], following base composition + scoped tasks. Read-only despite POST
    // (the body carries the spec), so it lives here, not in mutatingRoutes.
    "POST /rows": async (req, __) => {
      const { spec } = (await req.json()) as { spec: SourceSpec };
      const rows = await resolveSource(spec, { root: cfg.vault, today: todayISO() });
      return Response.json(rows);
    },

    "POST /backup": async (_, __) => {
      const committed = await commitVault(cfg.vault, snapshotMessage());
      return Response.json({ committed });
    },

    "GET /cards/decks": async (_, __) => {
      return Response.json(await collectDecks(cfg.vault, todayISO()));
    },

    "GET /cards/all": async (_, __) => {
      return Response.json(await collectCards(cfg.vault));
    },

    "GET /cards/note": async (_, url) => {
      const path = requireQueryParam(url, "path");
      return Response.json(await noteCards(cfg.vault, path));
    },

    "GET /cards/due": async (_, url) => {
      const deck = url.searchParams.get("deck") ?? undefined;
      return Response.json(await dueCards(cfg.vault, todayISO(), deck));
    },
  };


  function mutatingHandler(
    run: (req: Request, url: URL) => Promise<Response> | Response,
    pathOf?: (body: any) => string | string[] | undefined,
  ): Handler {
    return async (req, url) => {
      try {
        // Tee the body so we can both read it for path extraction and pass it to run.
        const cloned = req.clone();
        const res = await run(req, url);
        let paths: string[] = [];
        if (pathOf) {
          try {
            const body = await cloned.json();
            const p = pathOf(body);
            if (typeof p === "string") paths = [p];
            else if (Array.isArray(p)) paths = p;
          } catch {
            // body wasn't JSON — that's fine, we just won't know the path
          }
        }
        await invalidate(...paths);
        return res;
      } catch (e) {
        throw new Error((e as Error).message);
      }
    };
  }

  const mutatingRoutes: Record<string, Handler> = {
    "POST /move": mutatingHandler(
      async (req) => {
        const { from, to } = (await req.json()) as { from: string; to: string };
        moveEntry(cfg.vault, from, to);
        return new Response("ok");
      },
      (b) => [b.from, b.to],
    ),

    "POST /delete": mutatingHandler(
      async (req) => {
        const { path } = (await req.json()) as { path: string };
        return Response.json(deleteEntry(cfg.vault, path));
      },
      (b) => b.path,
    ),

    "POST /restore": mutatingHandler(
      async (req) => {
        const { trashPath, to } = (await req.json()) as { trashPath: string; to: string };
        moveEntry(cfg.vault, trashPath, to);
        return new Response("ok");
      },
      (b) => b.to,
    ),

    "POST /create": mutatingHandler(
      async (req) => {
        const { path, kind } = (await req.json()) as { path: string; kind: "file" | "dir" };
        createEntry(cfg.vault, path, kind);
        return new Response("ok");
      },
      (b) => b.path,
    ),

    "POST /set-property": mutatingHandler(
      async (req) => {
        // Used by the Bases kanban drag-drop: flip a single frontmatter key on a note.
        const { path, key, value } = (await req.json()) as { path: string; key: string; value: unknown };
        // Refuse to write to a path that doesn't exist — silently creating notes
        // (which readNoteOrEmpty + writeNote would do) hides mistakes from callers.
        const raw = await readNoteOrEmpty(cfg.vault, path);
        if (raw === "" && !(await Bun.file(join(cfg.vault, path)).exists())) {
          return new Response("note not found", { status: 404 });
        }
        const next = setFrontmatterKey(raw, key, value);
        await writeNote(cfg.vault, path, next);
        return new Response("ok");
      },
      (b) => b.path,
    ),

    "POST /delete-property": mutatingHandler(
      async (req) => {
        // Remove a single frontmatter key (e.g. resetting a note's icon to default).
        const { path, key } = (await req.json()) as { path: string; key: string };
        const raw = await readNoteOrEmpty(cfg.vault, path);
        if (raw === "" && !(await Bun.file(join(cfg.vault, path)).exists())) {
          return new Response("note not found", { status: 404 });
        }
        const next = deleteFrontmatterKey(raw, key);
        await writeNote(cfg.vault, path, next);
        return new Response("ok");
      },
      (b) => b.path,
    ),

    "POST /row/update": mutatingHandler(
      async (req) => {
        // index === null => append a new row; otherwise replace the row at index.
        const { file, index, note } = (await req.json()) as {
          file: string;
          index: number | null;
          note: Record<string, unknown>;
        };
        const text = await readNoteOrEmpty(cfg.vault, file);
        const name = file.split("/").pop()!.replace(/\.md$/, "");
        const next = upsertRow(text, { name, path: file }, index ?? null, note);
        await writeNote(cfg.vault, file, next);
        return new Response("ok");
      },
      (b) => b.file,
    ),

    "POST /row/delete": mutatingHandler(
      async (req) => {
        const { file, index } = (await req.json()) as { file: string; index: number };
        const text = await readNote(cfg.vault, file);
        const name = file.split("/").pop()!.replace(/\.md$/, "");
        const next = deleteRow(text, { name, path: file }, index);
        await writeNote(cfg.vault, file, next);
        return new Response("ok");
      },
      (b) => b.file,
    ),

    "POST /folder-icon": mutatingHandler(
      async (req) => {
        // Assign (or clear) an icon for a folder. Folders have no frontmatter, so
        // the mapping lives in settings.yaml and is overlaid onto /tree dir entries.
        const { path, icon } = (await req.json()) as { path: string; icon?: string | null };
        if (typeof path !== "string" || path.length === 0) {
          return new Response("missing path", { status: 400 });
        }
        // Reject traversal / absolute paths — folder paths are vault-relative.
        const segments = path.split("/");
        if (path.startsWith("/") || segments.some((s) => s === ".." || s === ".")) {
          return new Response("invalid path", { status: 400 });
        }
        await setFolderIcon(cfg.vault, path, icon ?? "");
        return new Response("ok");
      },
      // settings.yaml change → invalidate broadly; pass its path so classifyVault
      // marks both graph & tree dirty (isSettingsPath), refreshing /tree.
      () => "settings.yaml",
    ),

    "POST /tasks/toggle": mutatingHandler(
      async (req) => {
        const { path, line } = (await req.json()) as { path: string; line: number };
        const content = await readNote(cfg.vault, path);
        const lines = content.split("\n");
        if (line < 0 || line >= lines.length) {
          throw new Error("line out of range");
        }
        lines[line] = toggleTaskLine(lines[line], todayISO());
        await writeNote(cfg.vault, path, lines.join("\n"));
        return new Response("ok");
      },
      (b) => b.path,
    ),

    "POST /cards/review": mutatingHandler(
      async (req) => {
        const body = (await req.json()) as {
          id?: string;
          response: ReviewResponse;
          question?: string;
          file?: string;
          index?: number;
        };
        // Row-based review (flashcard base): advance scheduling columns on the row.
        if (body.file != null && body.index != null) {
          const text = await readNote(cfg.vault, body.file);
          const name = body.file.split("/").pop()!.replace(/\.md$/, "");
          const { rows } = parseBaseFile(text, { name, path: body.file });
          const row = rows[body.index];
          if (!row) throw new Error(`row not found: ${body.file}#${body.index}`);
          const note = applyReviewToRow(row.note, body.response, todayISO());
          const next = upsertRow(text, { name, path: body.file }, body.index, note);
          await writeNote(cfg.vault, body.file, next);
          return new Response("ok");
        }
        // Legacy: inline note card identified by `${notePath}::${cardIndex}::${subIndex}`.
        await applyReview(cfg.vault, body.id!, body.response, todayISO(), body.question);
        return new Response("ok");
      },
      (b) => b.file, // row-based reviews invalidate the base file; legacy reviews leave paths empty
    ),
  };

  return Bun.serve({
    port: cfg.port ?? 4321,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") return withCors(new Response(null));

      // Terminal WebSocket upgrade.
      if (req.method === "GET" && url.pathname === "/terminal") {
        const cols = Number(url.searchParams.get("cols"));
        const rows = Number(url.searchParams.get("rows"));
        if (!Number.isInteger(cols) || !Number.isInteger(rows) ||
            cols < 1 || cols > 500 || rows < 1 || rows > 500) {
          return withCors(new Response("bad cols/rows", { status: 400 }));
        }
        const origin = req.headers.get("origin");
        // Allow:
        // - same-origin (no Origin header, e.g. Tauri webview)
        // - localhost/127.0.0.1 on any port (Vite dev server, the Tauri webview, browser-based local dev)
        // - tauri://localhost (Tauri scheme on some platforms)
        const allowed =
          !origin ||
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
          /^tauri:\/\//.test(origin);
        if (!allowed) {
          return withCors(new Response("forbidden origin", { status: 403 }));
        }
        const session = createTerminalSession({ cwd: cfg.vault, cols, rows });
        const ok = server.upgrade(req, { data: { sessionId: session.id } });
        if (!ok) {
          killSession(session.id);
          return withCors(new Response("upgrade failed", { status: 400 }));
        }
        return new Response(null, { status: 101 }); // upgrade response is sent by Bun
      }

      const route = `${req.method} ${url.pathname}`;
      const handler = routes[route] ?? mutatingRoutes[route];

      if (!handler) {
        return withCors(new Response("not found", { status: 404 }));
      }

      try {
        const res = await handler(req, url, cfg);
        return withCors(res);
      } catch (e) {
        return withCors(new Response((e as Error).message, { status: 400 }));
      }
    },

    websocket: {
      open(ws) {
        const data = ws.data as { sessionId: string; dataSub?: { dispose(): void }; exitSub?: { dispose(): void } };
        const s = getSession(data.sessionId);
        if (!s) { ws.close(); return; }
        // Pipe PTY -> ws. Store disposables so we can clean them up on close.
        data.dataSub = s.pty.onData((d: string) => { ws.send(enc.encode(d)); });
        data.exitSub = s.pty.onExit(() => { try { ws.close(); } catch { /* */ } });
      },
      message(ws, msg) {
        const { sessionId } = ws.data as { sessionId: string };
        const s = getSession(sessionId);
        if (!s) return;
        const bytes = msg instanceof ArrayBuffer
          ? new Uint8Array(msg)
          : msg instanceof Uint8Array
            ? msg
            : new TextEncoder().encode(msg as string);
        if (bytes.length === 0) return;
        const tag = bytes[0];
        if (tag === 0x00) {
          s.pty.write(dec.decode(bytes.subarray(1)));
        } else if (tag === 0x01 && bytes.length >= 5) {
          const view = new DataView(bytes.buffer, bytes.byteOffset + 1, 4);
          const cols = view.getUint16(0, true);
          const rows = view.getUint16(2, true);
          resizeSession(sessionId, cols, rows);
        }
      },
      close(ws) {
        const data = ws.data as { sessionId: string; dataSub?: { dispose(): void }; exitSub?: { dispose(): void } };
        // Dispose PTY listeners immediately so no ws.send is called on the closed socket.
        data.dataSub?.dispose();
        data.exitSub?.dispose();
        // Grace period to absorb kernel/network races. No resume in v1.
        setTimeout(() => killSession(data.sessionId), 3000);
      },
    },
  });
}

if (import.meta.main) {
  const vault = cliArg("vault");
  const memory = cliArg("memory");
  if (!vault || !memory) {
    console.error("usage: server --vault <2nd-brain dir> --memory <3rd-brain dir> [--port n]");
    process.exit(1);
  }
  const portArg = cliArg("port");
  const s = createServer({ vault, memory, port: portArg ? Number(portArg) : 4321 });
  console.log(`core listening on http://localhost:${s.port}`);
}
