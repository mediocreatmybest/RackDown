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

The three `examples/` documents plus every `fixtures/valid/` document, each
rendered in all four routing modes — 40 results.

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
