// app/src/export/htmlTemplate.ts
import type { ExportTheme } from "./types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface ThemeVars {
  scheme: "dark" | "light";
  bg: string;
  fg: string;
  muted: string;
  border: string;
  codeBg: string;
}

const THEMES: Record<ExportTheme, ThemeVars> = {
  dark: { scheme: "dark", bg: "#1e1e22", fg: "#e7e7ea", muted: "#a1a1aa", border: "#3a3a42", codeBg: "#2a2a31" },
  light: { scheme: "light", bg: "#ffffff", fg: "#1a1a1a", muted: "#52525b", border: "#d4d4d8", codeBg: "#f4f4f5" },
};

function styles(t: ThemeVars): string {
  return `
  :root { color-scheme: ${t.scheme}; }
  html, body { margin: 0; background: ${t.bg}; }
  body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif;
         max-width: 760px; margin: 0 auto; padding: 2.5rem 1.5rem 3rem;
         line-height: 1.6; color: ${t.fg}; }
  h1,h2,h3 { line-height: 1.25; margin-top: 1.6em; }
  a { color: ${t.fg}; }
  pre { background: ${t.codeBg}; padding: 1rem; border-radius: 6px; overflow: auto;
        white-space: pre-wrap; word-break: break-word; }
  code { background: ${t.codeBg}; padding: 0.1em 0.35em; border-radius: 4px; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid ${t.border}; margin: 0; padding-left: 1rem; color: ${t.muted}; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid ${t.border}; padding: 0.4rem 0.6rem; text-align: left; }
  th { background: ${t.codeBg}; }
  img { max-width: 100%; }
`;
}

/**
 * Wrap rendered body HTML in a standalone, styled document (used for .html export, the
 * pdf render source, and the preview iframe). Defaults to a dark theme.
 */
export function wrapHtmlDocument(body: string, title: string, theme: ExportTheme = "dark"): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${styles(THEMES[theme])}</style>
</head>
<body>
${body}
</body>
</html>`;
}
