function EditorView() {
  return (
    <div style={{ flex: 1, overflow: "auto", background: "var(--editor)", padding: "26px 0" }}>
      <div style={{ maxWidth: 620, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: "var(--fs-display)", fontWeight: 600, letterSpacing: "var(--ls-display)" }}>
          The long way home
        </div>
        <MarkdownField frontmatter={{ "icon:": "(*)", "created:": "2029-09-15T07:12",
                                      "tags:": "[attention, walking, third-brain]", "brain:": "2" }}>
          I walked the long way home and let the day unspool behind me. The <span className="asc-wordmark">bismuth</span> daemon
          had already stitched the morning to <a className="asc-wikilink">[[attention as a resource]]</a> before
          I thought to. The graph remembers what I don't.
        </MarkdownField>
        <div style={{ fontSize: "var(--fs-lead)" }}><span style={{ color: "var(--accent)" }}>##</span> the quiet between entries</div>
        <div className="asc-prose">
          Three days without writing and the vault still moved. <span className="asc-tag">#walking</span> keeps
          returning to the same four nodes, which is either a habit or a thesis.
        </div>
        <div className="asc-callout">
          <span style={{ color: "var(--accent)" }}>&gt; NOTE</span>&nbsp; the quiet between entries is not emptiness —
          it is the part the agent fills in for me.
        </div>
        <div style={{ fontSize: 12, lineHeight: "var(--lh-prose)", color: "var(--text-muted)" }}>
          <div style={{ whiteSpace: "pre" }}>- [x]  re-read <span className="asc-wikilink">[[walking notes]]</span></div>
          <div style={{ whiteSpace: "pre" }}>- [x]  merge two orphan fragments</div>
          <div style={{ whiteSpace: "pre" }}>- [ ]  ask CLAUDE for a counter-argument</div>
        </div>
        <Card label="FIG. 1 — ENTRIES / WEEK">
          <div style={{ marginTop: 6 }}>
            <AsciiChart width={12} series={[
              { label: "w33", value: 3 }, { label: "w34", value: 6 },
              { label: "w35", value: 9 }, { label: "w36", value: 5 }]} />
          </div>
        </Card>
      </div>
    </div>
  );
}
