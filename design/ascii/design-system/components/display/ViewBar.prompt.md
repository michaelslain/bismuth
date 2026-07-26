The 46px view header — one per content view.

```jsx
<ViewBar>
  <Crumb label="DAEMON INBOX" meta="3 proposals · last run 03:14" />
  <ViewBarSpacer />
  <SegmentedToggle value={tab} onChange={setTab} options={tabs} />
</ViewBar>
```

Order is fixed: crumb, meta, spacer, controls. Controls never sit on the left.
