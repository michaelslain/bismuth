// A Storybook-only in-memory Transport (app/src/api.ts's `Transport` interface — the same
// seam app/src/mobile/inProcessTransport.ts implements to run the whole app with no HTTP
// server on iPad, so an in-memory fake here is known-feasible). Lets a story call
// `setTransport(fakeTransport(...))` and then use the real `api` object (tree/read/write/
// resolveRows/...) against seeded in-memory data instead of a live backend. NOT a story file
// itself — the `*.stories.*` glob (see `.storybook/main.ts`) skips underscore-prefixed files.
//
// Covers the paths `api`'s most-used verbs hit: GET /tree, GET /file, PUT /file, POST /rows.
// Every other mutation (move/create/delete/toggle/...) gets a generic 200 ack rather than a
// per-route implementation — a story exercising those usually isn't asserting on the response.
// An unmapped GET throws instead of guessing a shape, since a silently-wrong response is worse
// than a loud "add a case here" error.
import type { Transport } from "../api";
import type { TreeEntry } from "../../../core/src/graph";
import type { Row, SourceSpec } from "../../../core/src/bases/types";

export interface FakeTransportSeed {
  /** Vault-relative path -> file contents. Drives GET/PUT /file and the default /tree. */
  files?: Record<string, string>;
  /** Overrides the /tree response derived from `files` (one flat file entry per key). */
  tree?: TreeEntry[];
  /** POST /rows (api.resolveRows): a fixed Row[] for every spec, or a resolver keyed by spec. */
  rows?: Row[] | ((spec: SourceSpec) => Row[]);
}

function splitPath(pathAndQuery: string): { pathname: string; params: URLSearchParams } {
  const qIdx = pathAndQuery.indexOf("?");
  if (qIdx === -1) return { pathname: pathAndQuery, params: new URLSearchParams() };
  return { pathname: pathAndQuery.slice(0, qIdx), params: new URLSearchParams(pathAndQuery.slice(qIdx + 1)) };
}

/** Build an in-memory Transport over a plain `Map<path, contents>`. Call `setTransport
 *  (fakeTransport(...))` (app/src/api.ts) before rendering a component that calls `api.*` —
 *  e.g. in a story's `render`, or a decorator shared by every story in a file. */
export function fakeTransport(seed: FakeTransportSeed = {}): Transport {
  const files = new Map<string, string>(Object.entries(seed.files ?? {}));
  const tree = seed.tree ?? [...files.keys()].map((path): TreeEntry => ({ path, kind: "file" }));
  const resolveRows = typeof seed.rows === "function" ? seed.rows : () => seed.rows ?? [];

  return {
    getJson: async <T>(path: string): Promise<T> => {
      const { pathname } = splitPath(path);
      if (pathname === "/tree") return tree as unknown as T;
      if (pathname === "/version") return { version: 1 } as unknown as T;
      throw new Error(`fakeTransport: unhandled GET ${path}`);
    },
    getText: async (path: string): Promise<string> => {
      const { pathname, params } = splitPath(path);
      if (pathname === "/file") return files.get(params.get("path") ?? "") ?? "";
      throw new Error(`fakeTransport: unhandled GET(text) ${path}`);
    },
    post: async (path: string, body: unknown): Promise<Response> => {
      const { pathname } = splitPath(path);
      if (pathname === "/rows") {
        const { spec } = body as { spec: SourceSpec };
        return new Response(JSON.stringify(resolveRows(spec)), { headers: { "Content-Type": "application/json" } });
      }
      return new Response("ok");
    },
    put: async (path: string, body: unknown): Promise<Response> => {
      const { pathname } = splitPath(path);
      if (pathname === "/file") {
        const { path: p, contents } = body as { path: string; contents: string };
        files.set(p, contents);
        return new Response("ok");
      }
      return new Response("ok");
    },
    postJson: async <T>(path: string, body: unknown): Promise<T> => {
      const { pathname } = splitPath(path);
      if (pathname === "/rows") {
        const { spec } = body as { spec: SourceSpec };
        return resolveRows(spec) as unknown as T;
      }
      throw new Error(`fakeTransport: unhandled POST(json) ${path}`);
    },
    writeFileChecked: async (path: string, contents: string, baseText: string) => {
      const current = files.get(path) ?? "";
      if (current !== baseText) return { conflict: true as const, current };
      files.set(path, contents);
      return { conflict: false as const };
    },
    uploadAsset: async () => {
      throw new Error("fakeTransport: uploadAsset is not supported");
    },
    assetUrl: (target: string) => target,
    eventsUrl: () => "",
    base: () => "fake://storybook",
  };
}
