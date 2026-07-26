Mutually exclusive chrome switcher — view spans, graph dimensions, brain layers.

```jsx
<SegmentedToggle value={span} onChange={setSpan}
  options={[{id:"month",label:"MONTH"},{id:"week",label:"WEEK"},{id:"day",label:"DAY"}]} />
```

Lives at the right end of a ViewBar, after `<ViewBarSpacer/>`.
