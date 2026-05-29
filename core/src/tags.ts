const INLINE_TAG = /(?:^|\s)#([A-Za-z0-9_][A-Za-z0-9_/-]*)/g;

export function extractTags(data: Record<string, unknown>, body: string): string[] {
  const seen = new Set<string>();
  const raw = data.tags;

  if (raw !== undefined && raw !== null) {
    const candidates = Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === "string")
      : (typeof raw === "string" ? raw.split(/[,\s]+/) : []);
    for (const c of candidates) {
      const t = c.replace(/^#/, "").trim();
      if (t) seen.add(t);
    }
  }

  for (const m of body.matchAll(INLINE_TAG)) {
    const t = m[1].trim();
    if (t) seen.add(t);
  }

  return [...seen];
}
