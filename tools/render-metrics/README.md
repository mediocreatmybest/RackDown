# Renderer output metrics

Geometric quality measures for rendered RackDown SVG, with recorded baselines.

This exists because renderer changes need a signal between *"the unit tests still
pass"* and *"it looks alright in the playground"*. Routing work in particular
changes output in ways that no semantic assertion notices — every defect
recorded in issue #202 was present while the full gate was green.

It does **not** replace visual dogfood. Metrics say whether output moved and by
how much; only a person can say whether it reads better. `AGENTS.md` still
requires a playground or Obsidian check for renderer changes.

## Running it

The harness measures the built core, so build first:

```bash
pnpm --filter @rackdown/core build
```

Then:

```bash
pnpm metrics report                    # table for every document and routing mode
pnpm metrics report --mode perimeter   # one routing mode
pnpm metrics report --json             # machine-readable
pnpm metrics assert                    # compare against baselines.json, non-zero exit on regression
pnpm metrics update                    # re-record baselines.json
```

The unit tests for the measures themselves run with the rest of the tools:

```bash
node --test tools/render-metrics/metrics.test.mjs
node --test tools/render-metrics/presentation.test.mjs
```

## What is measured

All values are millimetres in layout space, rounded to whole millimetres.
Sub-millimetre precision is noise at rack scale and would make baselines
brittle. Lower is better for every measure except `connections`.

| Measure | What it means | Why it matters |
| --- | --- | --- |
| `connections` | Routes found in the SVG | Sanity check — a drop means connections stopped rendering |
| `crossings` | Segment intersections between distinct routes | Readability. Self-intersection within one route is not counted |
| `occludedMm` | Route length drawn underneath a device body | **The strongest readability signal.** A crossing is legible; a cable that vanishes under a server and reappears elsewhere is not |
| `foreignRackTransitMm` | Route length inside a rack body that neither endpoint belongs to | Guard rail — see the note below |
| `externalBoxInteriorRoutes` | Routes entering any external box, including their own target | Complete-path callout clearance |
| `foreignExternalStemRoutes` | Routes entering another external's final 2.5 × 6 mm bottom approach | Protects the association between a callout and its connections |
| `localDeviceInteriorRoutes` | Same-row, same-projection device connections entering device interiors | Detects unsafe local attachment geometry |
| `externalRows` | Populated bottom callout rows | Pins bounded overflow packing; additional rows are expected for dense scenes |
| `totalLengthMm` | Sum of all route lengths | Catches "fixes" that remove crossings by going the long way round |
| `bends` | Direction changes across all routes | Visual noise. Collinear joins are not bends |
| `viewportWidthMm` / `viewportHeightMm` | Diagram extent | Catches unbounded corridor growth (issue #202 defect B) |

### Reading occlusion

A route lying exactly *on* a device edge is **not** counted as occluded — it is
drawn on the border and remains visible. This matters more than it sounds:
`direct` routing draws same-rack connections as vertical lines at exactly the
device right edge, and counting those as hidden inflates `direct` occlusion
several-fold. `EDGE_EPSILON_MM` in `metrics.mjs` is what makes that correct.

### Reading foreign-rack transit

This is currently **zero across the whole corpus**, and that is expected. It is a
guard against a regression that has not happened yet, not an active signal.

It deliberately does not catch issue #202 defect A. That route re-enters *its
own* rack rather than crossing an unrelated one, so it is not "foreign" transit —
`occludedMm` is the measure that catches it. `foreignRackTransitMm` is here
because the inter-row corridor proposed as R2 could plausibly start routing
through third-party racks, and that should fail loudly when it does.

## Baselines

`baselines.json` records current output. **These are current behaviour, not
targets** — some entries record known defects, and those carry a `note` saying
so. `assert` compares against them and fails on regression.

Tolerances are per-measure:

```json
"tolerance": {
  "totalLengthMm": { "relative": 0.02 },
  "viewportWidthMm": { "absolute": 2 },
  "viewportHeightMm": { "absolute": 2 }
}
```

Measures with no tolerance entry must match exactly. `crossings`, `occludedMm`
and `foreignRackTransitMm` are deliberately in that group — a single millimetre
of new occlusion is a real change and should be looked at, not absorbed.

Improvements are reported but never fail the run:

```
improved  examples/routing.rackdown::perimeter  occludedMm: 482 -> 0
```

After making a change that moves the numbers, review the diff and re-record:

```bash
pnpm metrics update
```

`update` preserves any `note` fields already attached to an entry, so
annotations survive re-recording. Commit the regenerated file with the change
that caused it, so the diff shows the effect.

## Corpus

The three canonical examples and the valid fixtures listed in `CORPUS`, each
rendered in all four routing modes — 48 results. The garage fixture pins C3
attachments and two projected power callouts; the dense fixture pins 18
externals in six rows.

Several fixtures have no connections at all. Those rows are near-empty by design:
they pin rack and device geometry, so a layout change that silently moved racks
still fails `assert`.

Broken fixtures are deliberately excluded. Their purpose is diagnostic recovery,
which `fixtures.test.js` already protects, and their geometry is not meaningful.

To add a document, put it in `CORPUS` in `index.mjs` and run `update`.

## Implementation notes

The SVG is parsed with regular expressions rather than a DOM. That is normally a
poor idea; here the input is this repository's own renderer output, generated
line by line from templates in `renderer.ts`, not arbitrary SVG. Keeping the
harness dependency-free is worth more than generality — but it does mean
**changing the markup shape in `renderer.ts` can silently break extraction**.
`metrics.test.mjs` pins the shapes that are relied on, so that failure is loud.

`computeMetrics` takes both the layout and the SVG. Endpoint identity is semantic
(which devices a connection joins) while geometry is projected (where those
devices ended up on the canvas), and only the SVG knows the second.

Length-inside-rectangle measures are computed by sampling at 0.5mm rather than by
exact segment/rectangle clipping. The clipping maths has more edge cases than it
is worth here, and at that step the error is far below anything that changes a
verdict.

## Not wired into `pnpm check`

`check` runs before `build`, and this harness needs the built core. Run it after
`pnpm build`, or wire it into CI as a separate step. Left out of the default gate
deliberately rather than by oversight.

## Presentation geometry review

Generate eight focused SVGs and a review page after building core:

```bash
node tools/render-metrics/presentation.mjs /tmp/rackdown-presentation-review
node --test tools/render-metrics/metrics.test.mjs tools/render-metrics/presentation.test.mjs
```

The cases cover two siblings, three C3 connections, bottom overflow, garage
power callouts, six and eighteen crowded externals, wide labels and Unicode.
The tests inspect complete logical routes, target boundaries, collision counts
and final extents. They do not measure font ink.

### Intentional perimeter baseline changes

Only these five original corpus rows change geometry. Every change is confined
to bottom-perimeter external routes; the other 35 original rows retain their
existing metrics. Direct, orthogonal, lanes and right-placement geometry also
remain unchanged when compared with the preceding implementation.

| Document | Total length | Bends | Viewport height | Reason |
| --- | --- | --- | --- | --- |
| `examples/home-lab.rackdown` | 2601 → 2988 | 15 → 16 | 1171 → 1197 | Two callouts pack near their front-device centre. One route uses the clear left exterior approach; the other gains a final top-centre leg. |
| `examples/routing.rackdown` | 3095 → 3367 | 20 → 21 | 943 → 969 | The callout moves from the combined projection centre to its source projection centre and gains a final vertical leg. |
| `examples/shared-rows.rackdown` | 1133 → 1405 | 16 → 17 | 460 → 486 | The external moves to its source projection centre and gains a final vertical leg. Existing device-device routes are unchanged. |
| `fixtures/valid/external-link.rackdown` | 689 → 719 | 2 → 3 | 638 → 664 | X is unchanged; the measured floor raises the box 30 mm and adds the final vertical leg. |
| `fixtures/valid/front-rear.rackdown` | 938 → 1209 | 10 → 11 | 638 → 664 | The external moves to its front source projection centre and gains a final vertical leg. |

The ordinary box floor increases by 30 mm. The viewport grows by 26 mm because
the previous routing envelope already extended 4 mm beyond the box. These
whole-millimetre results match the accepted reference values exactly.

### Browser acceptance follow-up

The workspace has no installed Chromium/Playwright test dependency. A permanent
browser runner is deferred to avoid adding a browser installation and CI job
for this change. Core generation remains independent of browser and font
measurement. Native SVG review can verify route presentation, but cannot stand
in for Chromium label acceptance or Obsidian desktop/mobile review.

The future `external-labels.browser.mjs` runner should load the generated SVGs,
measure each label's **unclipped** `getBBox()` against its 68.2 × 14 mm inner
rectangle, and repeat with clip guards enabled and removed. It must fail on
overflow before clipping and must exercise wide ASCII, NFC/decomposed text,
CJK, Arabic/Hebrew, flags and ZWJ emoji. Measurements must never feed back into
core generation or change its fixed deterministic width budget.
