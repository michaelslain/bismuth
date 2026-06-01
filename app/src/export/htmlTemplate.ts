// app/src/export/htmlTemplate.ts

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif;
         max-width: 760px; margin: 2.5rem auto; padding: 0 1.5rem;
         line-height: 1.6; color: #1a1a1a; }
  h1,h2,h3 { line-height: 1.25; margin-top: 1.6em; }
  pre { background: #f4f4f5; padding: 1rem; border-radius: 6px; overflow: auto; }
  code { background: #f4f4f5; padding: 0.1em 0.35em; border-radius: 4px; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 3px solid #d4d4d8; margin: 0; padding-left: 1rem; color: #52525b; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #d4d4d8; padding: 0.4rem 0.6rem; text-align: left; }
  th { background: #f4f4f5; }
  img { max-width: 100%; }
`;

/** Wrap rendered body HTML in a standalone, styled document (used for .html export and PDF). */
export function wrapHtmlDocument(body: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}
