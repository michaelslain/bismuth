const { useState } = React;

const TABS = [
  { id: "graph", glyph: "⁘", label: "graph" },
  { id: "editor", glyph: "✎", label: "2029-09-15 journal" },
  { id: "bases", glyph: "▤", label: "reading.base" },
  { id: "calendar", glyph: "▦", label: "calendar" },
  { id: "chat", glyph: "◈", label: "CLAUDE" },
  { id: "daemon", glyph: "✳", label: "inbox" },
];

const TREE = [
  { id: "f-journal", label: "journal/", glyph: "▸" },
  { id: "editor", label: "2029-09-15", glyph: "✎", depth: 1 },
  { id: "d14", label: "2029-09-14", glyph: "✎", depth: 1 },
  { id: "d12", label: "2029-09-12", glyph: "✎", depth: 1, last: true },
  { id: "f-bases", label: "bases/", glyph: "▸" },
  { id: "bases", label: "reading.base", glyph: "▤", depth: 1, last: true },
  { id: "f-agents", label: "agents/", glyph: "▸" },
  { id: "chat", label: "CLAUDE", glyph: "◈", depth: 1 },
  { id: "daemon", label: "inbox", glyph: "✳", depth: 1, last: true },
  { id: "f-inbox", label: "inbox/", glyph: "▸", last: true, meta: "(3)" },
];

const PATHS = {
  graph: "~/vault/.index/graph.db",
  editor: "~/vault/journal/2029-09-15.md",
  bases: "~/vault/bases/reading.base",
  calendar: "~/vault/.index/calendar",
  chat: "~/vault/agents/CLAUDE.md",
  daemon: "~/vault/.daemon/pages/",
};

function Shell() {
  const [view, setView] = useState("graph");
  const [tabsOpen, setTabsOpen] = useState(false);
  const View = { graph: GraphView, editor: EditorView, bases: BasesView,
                 calendar: CalendarView, chat: ChatView, daemon: DaemonView }[view];

  return (
    <div className="asc-app" style={{ minHeight: "100vh", display: "flex", alignItems: "flex-start",
                                                 justifyContent: "center", padding: 30, background: "var(--rail)" }}>
      <div className="asc-window">
        <div className="asc-strip">
          <span className="asc-wordmark">bismuth</span>
          <span style={{ color: "var(--faint)" }}>//</span>
          <span>~/vault</span>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 6, color: "var(--faint)" }}>
            <span>[-]</span><span>[+]</span><span>[x]</span>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "266px 1fr auto" }}>
          <div className="asc-rail">
            <div>
              <div style={{ padding: "0 12px 6px" }}><span className="asc-eyebrow">VAULT</span></div>
              <AsciiTree rows={TREE} activeId={view} onSelect={(id) => TABS.some((t) => t.id === id) && setView(id)} />
            </div>
            <div style={{ flex: 1 }} />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px 6px" }}>
                <span className="asc-eyebrow">GRAPH</span>
                <div style={{ flex: 1 }} />
                <span onClick={() => setView("graph")}
                      style={{ cursor: "pointer", color: "var(--faint)", fontSize: "var(--fs-micro)" }}>[ open ]</span>
              </div>
              <div onClick={() => setView("graph")}
                   style={{ position: "relative", margin: "0 12px", aspectRatio: "1 / 1", overflow: "hidden",
                            cursor: "pointer", border: "1px solid var(--border)", background: "var(--graph-bg)" }}>
                <MiniGraph />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
            <View />
          </div>

          <TabRail tabs={TABS} value={view} onChange={setView} open={tabsOpen} onToggle={() => setTabsOpen((v) => !v)} />
        </div>

        <div className="asc-statusbar">
          <span>{PATHS[view]}</span>
          <span>ln 24, col 12</span>
          <span>md · utf-8</span>
          <div style={{ flex: 1 }} />
          <span>daemon: idle</span>
          <KbdHints items={[{ combo: "Mod+O", label: "switcher" }, { combo: "Mod+K", label: "commands" }]} />
        </div>
      </div>
    </div>
  );
}
