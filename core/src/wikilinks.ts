const LINK = /\[\[([^\]]+?)\]\]/g;

export function extractWikilinks(md: string): string[] {
  const out = new Set<string>();
  for (const m of md.matchAll(LINK)) {
    const raw = m[1];
    const target = raw.split("|")[0].split("#")[0].trim();
    if (target) out.add(target);
  }
  return [...out];
}
