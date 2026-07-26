// The ::inbox tab — see app/src/InboxView.tsx. Daemon-authored pages under
// .daemon/pages/, grouped due / scheduled / resolved. A list, never cards.
const DOT = { pending: "var(--text-muted)", working: "var(--accent)", done: "var(--green)",
              failed: "var(--rose)", dismissed: "var(--text-muted)" };

const PAGES = [
  { status: "pending", title: "Reply drafts", source: "cron:answer-emails", time: "2h ago", group: "due",
    body: "Three replies drafted and waiting: the Fife field trip, the lichen sample request, and a scheduling note from Perth.",
    actions: [["SEND ALL", "selected"], ["DISMISS", "unselected"]] },
  { status: "pending", title: "Vault review — week 37", source: "cron:vault-review", time: "6h ago", group: "due",
    body: "Nine notes have no inbound link after 90 days. Proposed: archive to .attic/2029-09, reversible for 30 days.",
    actions: [["ARCHIVE", "selected"], ["REVIEW", "normal"], ["DISMISS", "unselected"]] },
  { status: "working", title: "Consolidate walking notes", source: "cron:dream", time: "11h ago", group: "due",
    body: "Four fragments from the last fortnight read as one thought. Merge them into a single note under journal/?",
    actions: [["…", "selected"], ["DISMISS", "unselected"]] },
  { status: "pending", title: "Morning digest", source: "cron:dream", time: "in 7h", group: "scheduled",
    body: "What changed in the vault overnight, and what the memory layer wrote about it." },
  { status: "done", title: "Link two orphan fragments", source: "cron:dream", time: "yesterday", group: "resolved",
    body: "fragments/09-09 and fragments/09-11 both describe the same lichen script.",
    note: "Merged into [[graphis scripta]]. 2 files removed, 1 created." },
  { status: "failed", title: "Sync reading.base with Storygraph", source: "cron:answer-emails", time: "2d ago", group: "resolved",
    body: "Pull finished dates for the six books marked reading.",
    note: "Marked failed — no response from the daemon." },
];

function PageRow({ page }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 2px",
                  borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", marginTop: 5, flexShrink: 0,
                     background: DOT[page.status] }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 12.5, color: "var(--fg)" }}>{page.title}</span>
          <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{page.source}</span>
          <span style={{ marginLeft: "auto", fontSize: "var(--fs-micro)", color: "var(--faint)", whiteSpace: "nowrap" }}>{page.time}</span>
        </div>
        <div style={{ fontSize: "var(--fs-ui)", color: "var(--text-muted)", marginTop: 2,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{page.body}</div>
        {page.note ? (
          <div style={{ fontSize: "var(--fs-micro)", color: "var(--faint)", marginTop: 3,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{page.note}</div>
        ) : null}
      </div>
      {page.actions ? (
        <div style={{ display: "flex", gap: 6, flexShrink: 0, paddingTop: 1 }}>
          {page.actions.map(([label, tone]) => (
            <Button key={label} size="sm" state={tone === "unselected" ? "unselected" : tone === "selected" ? "selected" : "normal"}>
              {label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SectionHead({ children, count, toggle }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-micro)",
                  fontWeight: 600, textTransform: "uppercase", letterSpacing: "var(--ls-eyebrow)",
                  color: "var(--text-muted)", padding: "14px 2px 5px" }}>
      {children} <span style={{ opacity: .6, fontWeight: 400 }}>{count}</span>
      {toggle ? <span style={{ marginLeft: "auto", fontSize: "var(--fs-micro)", textTransform: "none", opacity: .7 }}>{toggle}</span> : null}
    </div>
  );
}

function DaemonView() {
  const [showResolved, setShowResolved] = React.useState(true);
  const of = (g) => PAGES.filter((p) => p.group === g);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <ViewBar>
        <Crumb label="INBOX" meta="3 need review · 1 scheduled" />
        <ViewBarSpacer />
        <span style={{ color: "var(--faint)", fontSize: "var(--fs-micro)" }}>daemon idle · last run 03:14</span>
      </ViewBar>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 16px 16px",
                    maxWidth: 760, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <SectionHead count={of("due").length}>Needs review</SectionHead>
        {of("due").map((p) => <PageRow key={p.title} page={p} />)}
        <SectionHead count={of("scheduled").length}>Scheduled</SectionHead>
        {of("scheduled").map((p) => <PageRow key={p.title} page={p} />)}
        <div onClick={() => setShowResolved((v) => !v)} style={{ cursor: "pointer" }}>
          <SectionHead count={of("resolved").length} toggle={showResolved ? "hide" : "show"}>Recently resolved</SectionHead>
        </div>
        {showResolved ? of("resolved").map((p) => <PageRow key={p.title} page={p} />) : null}
      </div>
    </div>
  );
}
