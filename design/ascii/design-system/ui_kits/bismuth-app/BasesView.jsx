const ROWS = [
  { title: "The Overstory", status: "reading", rating: 4, tag: "#lichen", p: 0.7, active: true },
  { title: "Ways of Being", status: "reading", rating: 5, tag: "#attention", p: 0.4 },
  { title: "Underland", status: "to read", rating: 0, tag: "#walking", p: 0 },
  { title: "The Mushroom at the End of the World", status: "finished", rating: 4, tag: "#lichen", p: 1 },
  { title: "How to Do Nothing", status: "finished", rating: 5, tag: "#attention", p: 1 },
  { title: "Braiding Sweetgrass", status: "reading", rating: 3, tag: "#third-brain", p: 0.5 },
  { title: "Field Notes from a Catastrophe", status: "abandoned", rating: 0, tag: "#walking", p: 0.1 },
];
const COLS = "1fr 96px 78px 120px 110px";

function BasesView() {
  const [kind, setKind] = React.useState("table");
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="viewbar">
        <Crumb label="reading.base" meta="24 rows · 6 fields · sorted by status" />
        <ViewBarSpacer />
        <SegmentedToggle value={kind} onChange={setKind}
          options={[{ id: "table", label: "TABLE" }, { id: "cards", label: "CARDS" }, { id: "board", label: "BOARD" }]} />
      </div>
      <div className="asc-table" style={{ flex: 1, overflow: "auto" }}>
        <div className="thead" style={{ display: "grid", gridTemplateColumns: COLS }}>
          <div>TITLE</div><div>STATUS</div><div>RATING</div><div>TAGS</div><div>PROGRESS</div>
        </div>
        {ROWS.map((r) => (
          <div key={r.title} className={"trow" + (r.active ? " active" : "")}
               style={{ display: "grid", gridTemplateColumns: COLS }}>
            <div style={{ color: "var(--fg)" }}>{r.title}</div>
            <div><StatusText status={r.status} /></div>
            <div><Stars value={r.rating} /></div>
            <div>{r.tag}</div>
            <div><AsciiMeter value={r.p} /></div>
          </div>
        ))}
        <div style={{ padding: "12px 16px", color: "var(--faint)", fontSize: "var(--fs-micro)" }}>
          …17 more rows · filter: status != archived
        </div>
      </div>
    </div>
  );
}
