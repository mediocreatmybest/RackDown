# Fixtures

RackDown is intentionally forgiving, so broken input is an inevitable assumption rather than an afterthought.

The behaviour the parser/resolver/render pipeline must keep this explicit and testable.

## `broken/`

These inputs must never crash the render pipeline.

- `empty.rackdown` — empty source remains a valid input state
- `truncated-rack.rackdown` — incomplete rack declaration during live editing
- `unterminated-label.rackdown` — unfinished quoted label
- `unknown-device.rackdown` — unknown slugs remain drawable
- `unknown-port.rackdown` — arbitrary ports remain connectable
- `duplicate-alias.rackdown` — warn rather than silently choosing an alias
- `unresolved-endpoint.rackdown` — dangling relationships remain diagnosable
- `overlap.rackdown` — vertical occupancy conflict
- `overflow.rackdown` — device extends beyond rack bounds
- `unrecognisable.rackdown` — ignore the nonsense line with a diagnostic; preserve surrounding intent
- `duplicate-views.rackdown` — repeated front/rear view names are deduplicated with a diagnostic
- `malformed-views.rackdown` — an unfinished `views` clause recovers to the default front view
- `fractional-rack.rackdown` — fractional rack heights are rejected with an explicit error diagnostic

## `valid/`

These cover important non-default cases:

- `u1-top.rackdown` — top-down visible numbering
- `fractional-u.rackdown` — 0.5U coordinates and heights
- `unicode.rackdown` — labels are ordinary Unicode text
- `external-link.rackdown` — preserve an external `[[target]]` without resolving it
- `front-rear.rackdown` — front then rear projections with equipment on both mounting faces
- `rear-front.rackdown` — requested view order is presentation intent and is preserved
- `rear-only.rackdown` — a rear-only projection can document explicitly rear-mounted equipment

## Acceptance gate

[The fixture harness](../packages/rackdown-core/src/fixtures.test.js) walks both fixture directories through the public implementation pipeline:

```text
fixture
   ↓
parse()
   ↓
resolve()
   ↓
toSvg()
```

Every fixture must survive without throwing and must produce deterministic layout diagnostics and SVG output. Valid fixtures must not produce error-severity diagnostics.

Focused parser/resolver tests still own exact semantic assertions. The fixture harness is the broad regression net that ensures a broken or half-typed document cannot unexpectedly take down the whole pipeline.

Tests should prefer parsed/resolved data and diagnostics over whole SVG snapshots. Cosmetic SVG changes should not churn unrelated layout tests.

The malformed-input success condition is normally:

> render something sensible and explain the problem; do not throw.
