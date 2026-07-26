import React from "react";

/**
 * The note-editing surface: a frontmatter block, then ruled prose. Wikilinks and
 * tags are tinted inline; the underline IS the paper.
 */
export function MarkdownField({ frontmatter, children, className }) {
  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: "var(--sp-5)" }}>
      {frontmatter ? (
        <div className="asc-frontmatter">
          <div>---</div>
          {Object.entries(frontmatter).map(([k, v]) => (
            <div key={k} style={{ whiteSpace: "pre" }}>{k.padEnd(8)} {String(v)}</div>
          ))}
          <div>---</div>
        </div>
      ) : null}
      <div className="asc-prose">{children}</div>
    </div>
  );
}
