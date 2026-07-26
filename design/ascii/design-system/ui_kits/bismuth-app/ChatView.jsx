function ChatView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="viewbar">
        <Crumb label="CLAUDE" meta="agent · context: 12 notes · 8.4k tokens" />
        <ViewBarSpacer />
        <SegmentedToggle value="chat" onChange={() => {}}
          options={[{ id: "chat", label: "CHAT" }, { id: "trace", label: "TRACE" }]} />
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "18px 20px", display: "flex",
                    flexDirection: "column", gap: 16, fontSize: 12.5, lineHeight: "var(--lh-prose)" }}>
        <div style={{ color: "var(--text-muted)" }}>
          <span style={{ color: "var(--accent)" }}>&gt; </span>what have I been circling for the last three weeks?
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: "none", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "var(--fs-ui)", color: "var(--on-accent)", background: "var(--grad)" }}>@</div>
          <div className="asc-prose" style={{ fontSize: 12.5 }}>
            Four nodes account for 61% of your new edges: <a className="asc-wikilink">[[attention as a resource]]</a>,{" "}
            <a className="asc-wikilink">[[walking notes]]</a>, <a className="asc-wikilink">[[third brain]]</a>,{" "}
            <a className="asc-wikilink">[[graphis scripta]]</a>. The last one is new — it entered the vault on 09-09.
          </div>
        </div>
        <Card label="EDGE GROWTH · 21d">
          <div style={{ marginTop: 6 }}>
            <AsciiChart series={[
              { label: "attention", value: 118, color: "var(--graph-0)" },
              { label: "walking", value: 82, color: "var(--graph-1)" },
              { label: "third-brain", value: 57, color: "var(--graph-3)" },
              { label: "lichen", value: 34, color: "var(--graph-4)" }]} />
          </div>
        </Card>
        <div style={{ color: "var(--text-muted)" }}>
          <span style={{ color: "var(--accent)" }}>&gt; </span>write the counter-argument.
        </div>
        <div style={{ color: "var(--text-muted)" }}>
          drafting into <span style={{ color: "var(--accent)" }}>journal/2029-09-15 counter.md</span>
          <span className="asc-caret">_</span>
        </div>
      </div>
      <div style={{ padding: "0 20px 16px" }}>
        <SearchBar placeholder="ask about this vault" trailing={<KbdHint combo="Mod+Enter">send</KbdHint>} />
      </div>
    </div>
  );
}
