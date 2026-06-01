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
 * Deep equality comparison for settings values.
 * Handles primitives, arrays, and plain objects.
 * Ignores object key ordering (both {a, b} and {b, a} are equal).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  // Same reference
  if (a === b) return true;

  // Handle null and undefined
  if (a == null || b == null) return a === b;

  // Different types
  if (typeof a !== typeof b) return false;

  // Primitives (string, number, boolean)
  if (typeof a !== "object") return a === b;

  // Arrays: length + element-wise comparison
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  // Plain objects: all keys must exist on both and values must match
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);

    // Check if same set of keys (ignores order)
    if (keysA.length !== keysB.length) return false;
    const keySetB = new Set(keysB);
    if (!keysA.every(k => keySetB.has(k))) return false;

    // Recursively compare values
    return keysA.every(k => deepEqual(a[k], b[k]));
  }

  // One is array, other is object, or other edge cases
  return false;
}

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
    } else if (!deepEqual(nv, pv)) {
      out.push({ path: here, value: nv });
    }
  }
  return out;
}
