# @rackdown/core

Host-neutral parsing, rack layout, diagnostics and deterministic SVG rendering.
Core has no runtime dependencies and works without a catalogue or host adapter.

```ts
import { parse, resolve, toSvg } from '@rackdown/core';

const source = 'rack "Example" 8U 19in u1 bottom\n8 switch "Core"';
const document = parse(source);
const layout = resolve(document);
const svg = toSvg(layout, { namespace: 'example-rack' });
```

For optional enrichment, pass a compatible `DeviceIndex` as the second argument
of `resolve`. Explicit heights and local labels take precedence over catalogue
defaults. Unknown devices and endpoints remain usable with diagnostics where
appropriate. The devices package supplies catalogue data and discovery separately.

`RackDocument` describes author intent; `RackLayout` contains renderer-neutral
resolved geometry and relationships. Front/rear projections, equal-width shared
rows, quoted endpoints and endpoint-local `adhoc` all use the same pipeline.
External references separate display labels from host link intent without core resolving targets.

SVG supports CSS-variable themes, bottom/right external callouts and direct,
orthogonal, lanes or perimeter routing. Styling and routing are programmatic
options, not source syntax. A stable namespace separates SVG IDs when a host
embeds several diagrams. Hosts own navigation and lifecycle behaviour.

## Connection selection

`resolve` assigns each `LayoutConnection` a required `category`.
An explicit source modifier such as `fibre category network` wins over endpoint
evidence. `category unclassified` suppresses inference. Media is preserved and
never used to infer category. See the [category rules](../../docs/specification.md#connection-category).

```ts
import { parse, resolve, selectConnections, toSvg } from '@rackdown/core';

const layout = resolve(parse(source), deviceIndex); // Complete rack remains authoritative.
const selection = { categories: ['power'] } as const;
const connections = selectConnections(layout, selection);
const svg = toSvg(layout, {
  namespace: 'rack-power',
  connectionSelection: selection,
});
// A later schedule consumer can use `connections` without invoking SVG.
```

`ConnectionSelection` has optional readonly `categories`, `deviceIds` and
`connectionIds` lists. An absent restriction is unrestricted; an empty list
matches nothing. Entries within a list combine with OR; specified fields combine
with AND. Device IDs mean either endpoint, one hop only. Results keep original
connection objects and source order, without duplicates caused by repeated
requested values. Unknown requested values never broaden the selection.

Use exact resolved IDs. A host can find a device by its exact authored `alias`
in `layout.devices`, then supply that device's `id`; do not pass aliases as IDs.
Generated IDs are not persistent identities across source edits.

### Cable schedules

`buildCableSchedule(layout, selection?)` projects selected connections into
small host-neutral rows. It calls `selectConnections()` internally, retains
source order and does not mutate the layout.

```ts
import { buildCableSchedule } from '@rackdown/core';

const rows = buildCableSchedule(layout, {
  categories: ['power', 'network'],
});
```

Each row contains `connectionId`, `category`, optional `media`, and neutral `a`
and `b` endpoints. A device endpoint contains its resolved label, device ID,
optional alias and canonical port name, plus rack ID/name, U position and mount
face. An external endpoint contains its display label and stable resolved
external ID. Schedule rows contain no SVG coordinates, routes, catalogue
objects or resolved host links. Endpoint order reflects authoring order and
does not imply electrical or network direction.

The renderer calculates routes, callout positions and viewport from the complete
layout, then omits unselected connections and unused external callouts. All racks
and devices remain; retained routes, colours and styles stay fixed. Empty views
are valid SVGs. Connection elements expose `data-category` alongside their semantic
`data-connection-id`. Filtered accessible descriptions distinguish the visible
connection count from selected/excluded semantic totals and the number
unclassified in the full document. These counts do not verify cabling completeness.

Equivalent selections produce identical automatic namespaces; different selected
sets contribute to different namespaces. Hosts embedding repeated copies should
still provide a distinct explicit namespace for each SVG instance. Filtering is
a focused presentation, not privacy redaction or host interaction. Hosts can use
the same selector for emphasis without trimming the layout.

`RackLayout` uses `schemaVersion: 2` because each resolved connection now requires
`category`. TypeScript callers constructing `LayoutConnection` objects must supply
it; re-resolving source produces the current layout contract. `RackDocument`
remains at `schemaVersion: 1`. No layout migration machinery is provided.

## Optional connection hover emphasis

Connections expose `.rackdown-connection` alongside `data-connection-id`,
`data-routing`, `data-pattern` and `data-colour-source`, so a host embedding the
SVG inline can opt into follow-the-cable highlighting with ordinary CSS:

```css
.rackdown-connection:hover {
  stroke-width: 4;
  stroke-opacity: 1;
}
svg:has(.rackdown-connection:hover) .rackdown-connection:not(:hover) {
  stroke-opacity: 0.25;
}
```

The hovered connection becomes thicker and fully opaque. Where `:has()` is
supported the other connections dim; where it is not, the direct `:hover` rule
still applies, so the enhancement degrades gracefully. Core emits none of this
CSS: hover emphasis is deliberately host-owned presentation and stays out of
standalone SVG output. Each connection also carries a `<title>` naming its
endpoints and media, which the host tooltip surfaces on hover.

Connection colours are host-themeable by design. Resolved auto and explicit
colours are presentation attributes that ordinary host rules can override, and
monochrome mode reads `--rackdown-connection-stroke`.

## Host theming custom properties

Alongside the existing colour variables, the stylesheet reads six custom
properties for typography and stroke weight. They are host CSS presentation
controls, not RackDown source syntax and not render options: a dense variant, a
large-print variant or a house-font variant is a host stylesheet rather than a
new renderer knob. Every current default is kept as the in-stylesheet fallback,
so output is unchanged when a host sets none of them.

| Property | Controls | Default |
| --- | --- | --- |
| `--rackdown-font` | shared SVG font stack for all diagram text | `ui-sans-serif, system-ui, sans-serif` |
| `--rackdown-title-size` | rack titles | `14px` |
| `--rackdown-label-size` | device, external and empty-diagram labels | `12px` device, `9px` compact device, `10px` external and empty |
| `--rackdown-u-label-size` | rack U labels | `8.5px` |
| `--rackdown-stroke-width` | structural strokes: rack outline, device outline, external callout outline, U lines | `1`, except `0.5` for U lines |
| `--rackdown-connection-width` | connections drawn at the renderer default width | `2` |

Title sizing, label sizing and U-label sizing are independent, so a host can
enlarge body labels without inflating rack titles or the U ruler. Setting
`--rackdown-label-size` deliberately collapses the three label defaults onto one
host-chosen size; leaving it unset preserves the distinct `12px` / `9px` / `10px`
defaults. `--rackdown-stroke-width` behaves the same way: unset it keeps the
thinner U lines, and setting it applies one weight to every structural stroke.

```css
.rackdown-dense {
  --rackdown-font: "Inter", ui-sans-serif, sans-serif;
  --rackdown-title-size: 11px;
  --rackdown-label-size: 8px;
  --rackdown-u-label-size: 7px;
  --rackdown-stroke-width: 0.75;
  --rackdown-connection-width: 1.25;
}
```

### Connection width precedence

`--rackdown-connection-width` applies only to connections that fell back to the
renderer default width. Those elements carry an internal
`rackdown-connection-default-width` marker class and a zero-specificity rule:

```css
:where(.rackdown-connection.rackdown-connection-default-width) {
  stroke-width: var(--rackdown-connection-width, 2);
}
```

The numeric `stroke-width="2"` presentation attribute stays on the element, so a
standalone SVG viewed without the host stylesheet still renders correctly.

A connection carrying a valid `ConnectionVisualStyle.width` — from
`connectionStyle` or from `connectionStyles[id]` — keeps its resolved numeric
`stroke-width` and does not receive the marker class, so the core variable never
erases portable author intent. Precedence runs renderer default, then
`--rackdown-connection-width` as the host default, then explicit portable width.
An invalid width (missing, non-finite, zero or negative) normalises to the
renderer default and is therefore themeable like any other default connection.

A host that genuinely wants to override even an explicit width can still write
an ordinary rule against the connection classes or the data hooks below, which
outranks the zero-specificity default rule:

```css
.rackdown-connection[data-media="fibre"] {
  stroke-width: 3;
}
```

That is host-owned presentation and needs no additional RackDown API.

## Embedded stylesheet theme

`toSvg` embeds one `<style>` element by default. The `theme` render option
selects which stylesheet is embedded, and nothing else:

```ts
theme?: 'auto' | 'light' | 'dark' | 'none';
```

| Value | Embedded stylesheet |
| --- | --- |
| `auto` | default: light fallbacks plus a `prefers-color-scheme: dark` override block |
| `light` | forces the light fallback scheme |
| `dark` | forces the dark fallback scheme |
| `none` | emits no embedded `<style>` element at all |

`auto` is the default and preserves current behaviour exactly: an omitted
`theme` and an explicit `theme: 'auto'` produce identical SVG, including the
automatically derived namespace.

`light` and `dark` ignore the viewer's colour-scheme preference for RackDown's
fallback colours. A `dark` diagram stays dark in a light-mode viewer and a
`light` diagram stays light in a dark-mode viewer. Neither introduces a new
palette: both reuse the fallback values `auto` already ships, and both keep the
shared structural, typography and custom-property rules.

Host custom properties keep working under `auto`, `light` and `dark`. The
colour variables and the six typography and stroke-weight properties above are
still read as `var()` fallbacks, so a host stylesheet overrides a forced scheme
the same way it overrides the automatic one.

```ts
const svg = toSvg(layout, {
  theme: 'dark',
});
```

### Host-owned presentation with `none`

`theme: 'none'` removes the entire embedded stylesheet — not part of it. There
is no empty `<style>`, no structural-only subset and no conversion of CSS into
inline `style` attributes. A caller selecting `none` is declaring that the
embedding host supplies the complete presentation CSS, and RackDown makes no
promise that the output looks useful standalone.

Because core emits no rules, core also consumes none of RackDown's CSS
variables in that mode. Setting `--rackdown-rack-fill` changes nothing on its
own; the host stylesheet must target the classes and data hooks directly. That
includes monochrome connections, which normally rely on core's
`--rackdown-connection-stroke` rule — under `none` the host owns that rule too.

What `none` does **not** remove is the semantic and per-element output. Classes,
`data-*` hooks, `id`, `role`, `aria-labelledby`, `aria-describedby`, `<title>`, `<desc>`, `viewBox`,
`width`/`height`, clip paths and geometry are all unchanged, as are the resolved
connection presentation attributes: `stroke`, `stroke-width`, `stroke-opacity`,
`stroke-linecap`, `stroke-linejoin` and `stroke-dasharray`. Portable
`ConnectionVisualStyle` intent survives intact, so `connectionStyle: { width: 3.5 }`
still renders `stroke-width="3.5"` under every theme including `none`.

```ts
const hostOwnedSvg = toSvg(layout, {
  theme: 'none',
});
```

This is most useful when a host renders many diagrams into one document and
wants a single shared stylesheet rather than one duplicated embedded stylesheet
per diagram.

Because `theme` changes generated output, a non-default value participates in
the automatically derived namespace, so `auto`, `light`, `dark` and `none` get
distinct derived ids. An explicit `namespace` is still used verbatim.

## SVG intrinsic sizing

`toSvg` provides three sizing modes through the `sizing` render option:

```ts
sizing?: 'pixels' | 'physical' | 'responsive';
```

| Value | Root `<svg>` dimensions | Purpose |
| --- | --- | --- |
| `pixels` | default: unitless numeric `width` and `height` | preserves existing intrinsic dimensions for pixel-oriented viewers |
| `physical` | `width` and `height` with explicit `mm` units | print-oriented and physical documentation consumers |
| `responsive` | omits root `width` and `height` entirely | container-driven sizing for web and static-document embeds |

`pixels` is the default and preserves existing intrinsic unitless root
dimensions: an omitted `sizing` and an explicit `sizing: 'pixels'` produce
byte-identical SVG output.

`physical` emits `width` and `height` with explicit `mm` units (for example
`width="1039mm" height="1127mm"`). The renderer's geometry is already
millimetre-derived, so physical mode makes that intent explicit on the root
element without rescaling geometry, altering routing or recalculating viewports.

`responsive` omits the root `width` and `height` attributes completely while
preserving the numeric `viewBox`. Omitting intrinsic width and height allows the
embedding host or container to control the rendered size while the viewBox
preserves the diagram's coordinate system and aspect ratio. Responsive mode does
not inject responsive CSS into core: embedding hosts remain responsible for
container sizing.

Sizing does not alter `RackLayout` or route geometry, and it composes cleanly
with `theme` (for example `{ sizing: 'responsive', theme: 'none' }` or
`{ sizing: 'physical', theme: 'dark' }`). Non-default sizing modes (`physical`
and `responsive`) participate in the automatically derived namespace, ensuring
distinct IDs when an explicit namespace is not supplied.

## Root accessibility markup

Root SVG output provides accessible structure and metadata:

- `role="img"` identifies the diagram as an image.
- `<title>` is the first child of the root element, identifying the diagram.
- `<desc>` is the second child of the root element, providing a concise deterministic summary of diagram contents (for example `2 racks, 12 devices, 8 connections.`).
- `aria-labelledby` references the title as the accessible name (`aria-labelledby="<namespace>-title"`), while `aria-describedby` references the desc as the accessible description (`aria-describedby="<namespace>-desc"`).

## SVG host data hooks

The renderer emits semantic `data-*` attributes throughout its SVG output so an
embedding host can style whole classes of output, identify rendered objects and
build host interactions without parsing generated element IDs. Element IDs are
namespaced per diagram and exist to keep several embedded diagrams distinct;
prefer the class and data-attribute selectors below when targeting output.

| Element | Attribute | Value |
| --- | --- | --- |
| Root `<svg>` | `data-external-placement` | `bottom` \| `right` — where external callouts are placed |
| | `data-connection-routing` | `direct` \| `orthogonal` \| `lanes` \| `perimeter` — routing mode the diagram was rendered with |
| | `data-connection-colour-mode` | `auto` \| `monochrome` — connection colour mode |
| Rack projection `.rackdown-rack-group` | `data-rack-id` | resolved rack identifier |
| | `data-face` | `front` \| `rear` — projection this group draws |
| | `data-width-inches` | declared rack width in inches |
| Rack U label `.rackdown-u-label` | `data-u` | rack unit the label marks |
| Device `.rackdown-device-group` | `data-device-id` | resolved device identifier |
| | `data-device-type` | resolved device type, for example `switch`, `shelf` or `blank` |
| | `data-position-u` | resolved rack position |
| | `data-u-height` | resolved device U height |
| | `data-mount-face` | `front` \| `rear` — face the device is mounted on |
| | `data-alias` | optional; present only when the placement carries an alias |
| | `data-item-role` | optional; currently `blank` or `shelf`, present only for those items |
| Connection `.rackdown-connection` | `data-connection-id` | resolved connection identifier |
| | `data-routing` | `direct` \| `orthogonal` \| `lanes` \| `perimeter` — routing resolved for this connection |
| | `data-media` | optional; connection media metadata, present only when supplied |
| | `data-pattern` | `solid` \| `dashed` \| `dotted` — resolved line pattern |
| | `data-colour-source` | `auto` \| `explicit` \| `monochrome` — how the stroke colour was resolved |
| External `.rackdown-external-group` | `data-external-id` | resolved external identifier |
| | `data-label` | human-readable external label |
| | `data-link-style` | `none` \| `wiki` \| `markdown` — link intent style |
| | `data-target` | optional; navigation target for linked externals (`wiki` or `markdown`), omitted for plain externals |
| | `data-placement` | `bottom` \| `right` — where this callout sits |

Optional hooks are omitted rather than emitted empty when they do not apply, so
write selectors that tolerate their absence.

```css
.rackdown-connection[data-media="fibre"] {
  stroke: #e69f00;
}

.rackdown-device-group[data-mount-face="rear"] {
  opacity: 0.9;
}

.rackdown-device-group[data-item-role="shelf"] {
  opacity: 0.75;
}
```

The fibre rule needs no custom property and no specificity tricks: resolved `auto` and
`explicit` connection colours are ordinary SVG `stroke` presentation attributes,
which a host `stroke:` declaration overrides directly. Monochrome connections
carry no resolved per-element stroke and read `--rackdown-connection-stroke`
instead, as described above.

Selecting on these hooks is a host presentation and integration choice. It is
not source validation and not topology inference, and it does not require a
globally consistent mapping between a semantic value and an appearance: two
hosts may colour `data-media="fibre"` differently and neither document is
invalid. Semantic metadata and presentation intent stay separate by design.

See the [specification](../../docs/specification.md) for source semantics and
[architecture](../../docs/architecture.md) for integration boundaries.
