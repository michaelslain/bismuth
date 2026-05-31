// app/src/icons/registry-core.ts
//
// Pure icon-resolution logic, decoupled from lucide-solid so it can be unit
// tested in a non-DOM environment (importing lucide-solid throws server-side).
// `registry.ts` binds this to the real lucide manifest.

/** Fold a name to a comparable key: lowercase, strip every non-alphanumeric char. */
export const normalizeIconKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface IconEntry<T> {
  /** Canonical Lucide PascalCase name, e.g. "CarFront". */
  name: string;
  Component: T;
}

export interface IconRegistry<T> {
  /** Resolve a spec to a component, or null if it isn't a known icon. */
  resolve(spec: string | null | undefined): T | null;
  /** Every icon (canonical name + component), sorted by name. */
  all(): IconEntry<T>[];
  /** All canonical names, sorted. */
  names(): string[];
}

/**
 * Build a registry over a `name -> component` manifest (PascalCase keys).
 *
 * Resolution is case/separator-insensitive ("CarFront" === "car-front"), and
 * the "Li"/"Lu" prefix is a fallback only — so a real icon like "List" beats
 * stripping "LiSt", and the legacy vault convention "LiHouse" still resolves.
 */
export function createIconRegistry<T>(manifest: Record<string, T>): IconRegistry<T> {
  const byNorm = new Map<string, IconEntry<T>>();
  for (const name of Object.keys(manifest)) {
    byNorm.set(normalizeIconKey(name), { name, Component: manifest[name] });
  }

  let cachedAll: IconEntry<T>[] | null = null;

  const resolve = (spec: string | null | undefined): T | null => {
    if (!spec) return null;
    const raw = spec.trim();
    if (!raw) return null;

    const direct = byNorm.get(normalizeIconKey(raw));
    if (direct) return direct.Component;

    const prefixed = /^(?:Li|Lu)(.+)$/.exec(raw);
    if (prefixed) {
      const stripped = byNorm.get(normalizeIconKey(prefixed[1]));
      if (stripped) return stripped.Component;
    }
    return null;
  };

  const all = (): IconEntry<T>[] => {
    if (!cachedAll) cachedAll = Array.from(byNorm.values()).sort((a, b) => a.name.localeCompare(b.name));
    return cachedAll;
  };

  return { resolve, all, names: () => all().map((e) => e.name) };
}
