const ENTRIES = {
  3: "· journal", 8: "· journal", 9: "· graphis scripta", 12: "· journal",
  14: "· walking notes", 15: "· journal", 16: "· recall 4", 19: "· journal",
  22: "· reading.base", 24: "· journal", 29: "· journal",
};

function CalendarView() {
  const [span, setSpan] = React.useState("month");
  const days = Array.from({ length: 35 }, (_, i) => {
    const n = i - 4;
    return { n: n >= 1 && n <= 30 ? n : null, e: ENTRIES[n], today: n === 15 };
  });
  const hours = Array.from({ length: 17 }, (_, i) => String(i + 6).padStart(2, "0") + ":00");
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="viewbar">
        <Crumb label="CALENDAR" meta={{ month: "September 2029 · 18 entries", week: "week 37 · Sep 09–15",
                                        day: "Saturday 2029-09-15 · 5 events" }[span]} />
        <ViewBarSpacer />
        <SegmentedToggle value={span} onChange={setSpan}
          options={[{ id: "month", label: "MONTH" }, { id: "week", label: "WEEK" }, { id: "day", label: "DAY" }]} />
      </div>
      {span === "month" ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", borderBottom: "1px solid var(--border)",
                        fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-eyebrow)", color: "var(--faint)" }}>
            {["MON","TUE","WED","THU","FRI","SAT","SUN"].map((d) => <div key={d} style={{ padding: "6px 8px" }}>{d}</div>)}
          </div>
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7,1fr)", gridAutoRows: "1fr" }}>
            {days.map((d, i) => (
              <div key={i} style={{ borderRight: "1px solid var(--border-soft)", borderBottom: "1px solid var(--border-soft)",
                                    padding: "5px 7px", overflow: "hidden", fontSize: "var(--fs-micro)", color: "var(--text-muted)" }}>
                <span style={{ display: "inline-block", padding: "0 3px",
                               color: d.today ? "var(--on-accent)" : d.n ? "var(--fg)" : "var(--faint)",
                               background: d.today ? "var(--accent)" : "transparent" }}>{d.n ?? ""}</span>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden" }}>{d.e ?? ""}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {hours.map((h) => (
            <div key={h} style={{ flex: 1, display: "flex", alignItems: "center", gap: 12, padding: "0 16px",
                                  borderBottom: "1px solid var(--border-soft)", fontSize: "var(--fs-ui)",
                                  color: "var(--text-muted)", background: h === "07:00" ? "var(--accent-soft)" : "transparent" }}>
              <span style={{ width: 44, flex: "none", color: "var(--faint)" }}>{h}</span>
              <span style={{ color: "var(--faint)" }}>{h === "07:00" || h === "16:00" ? "+--" : "|"}</span>
              <span style={{ color: h === "07:00" ? "var(--accent)" : "var(--text-muted)" }}>
                {h === "07:00" ? "journal · The long way home" : h === "16:00" ? "recall · 4 cards due" : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
