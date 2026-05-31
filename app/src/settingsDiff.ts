// app/src/settingsDiff.ts
// Pure leaf-diff between two nested settings objects. Used by the settings store to
// persist only the keys that actually changed (one PATCH per leaf) instead of
// overwriting the whole settings.yaml — which would clobber comments, the property
// registry, and any unknown keys the backend is told to preserve.

export interface LeafChange {
  path: string[];
  value: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Walk `next`, emitting a `{ path, value }` for every leaf whose value differs from
 * `prev` (arrays are compared whole as leaves). Keys present only in `prev` are
 * ignored — the store never drops keys, and we must not emit deletions.
 */
export function diffLeaves(prev: unknown, next: unknown, path: string[] = []): LeafChange[] {
  const out: LeafChange[] = [];
  if (!isPlainObject(next)) return out;
  const prevObj = isPlainObject(prev) ? prev : {};
  for (const key of Object.keys(next)) {
    const nv = next[key];
    const pv = prevObj[key];
    const here = [...path, key];
    if (isPlainObject(nv)) {
      out.push(...diffLeaves(pv, nv, here));
    } else if (JSON.stringify(nv) !== JSON.stringify(pv)) {
      out.push({ path: here, value: nv });
    }
  }
  return out;
}
