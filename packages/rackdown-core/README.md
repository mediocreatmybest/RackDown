# `@rackdown/core`

Host-neutral parsing, rack layout, diagnostics and deterministic SVG rendering. Core has no runtime dependencies and works without a device catalogue or host adapter.

## Quick start

```ts
import { parse, resolve, toSvg } from '@rackdown/core';

const source = 'rack "Example" 8U 19in u1 bottom\n8 switch "Core"';
const document = parse(source);
const layout = resolve(document);
const svg = toSvg(layout, { namespace: 'example-rack' });
```

Pass a compatible `DeviceIndex` to `resolve(document, devices)` for optional device and endpoint enrichment. Explicit heights and local labels take precedence over catalogue defaults. Unknown devices and endpoints remain usable, with diagnostics where appropriate.

`RackDocument` records parsed source intent. `RackLayout` contains resolved geometry and semantic relationships. The language and its validation rules are documented in the [specification](../../docs/specification.md).

## Select connections

`resolve()` assigns every `LayoutConnection` a required `category`: `power`, `network`, `console` or `unclassified`. An explicit valid category wins over endpoint evidence; media does not determine category. See [connection category rules](../../docs/specification.md#connection-category).

Use `selectConnections()` to select a host-neutral subset without mutating or trimming the layout:

```ts
import { parse, resolve, selectConnections, toSvg } from '@rackdown/core';

const layout = resolve(parse(source), deviceIndex);
const selection = { categories: ['power'] } as const;

const connections = selectConnections(layout, selection);
const svg = toSvg(layout, {
  namespace: 'rack-power',
  connectionSelection: selection,
});
```

`ConnectionSelection` accepts optional readonly `categories`, `deviceIds` and `connectionIds` lists.

- An omitted field is unrestricted; an empty list matches nothing.
- Values within one list use OR; supplied fields combine with AND.
- `deviceIds` matches connections incident to either endpoint, one hop only.
- Exact resolved IDs are required. Find a device by its exact authored alias in `layout.devices`, then use its resolved `id`.
- Unknown values never widen the selection. Results preserve source order and contain no duplicates.

Filtering is a presentation choice, not privacy redaction or equipment removal. The renderer calculates routes and viewport from the complete layout, then omits unselected connection elements. Racks and devices remain; unused external callouts are omitted. Empty selections produce valid SVG.

## Build cable schedules

`buildCableSchedule(layout, selection?)` projects selected semantic connections into host-neutral rows. It does not call the SVG renderer or mutate the layout.

```ts
import { buildCableSchedule } from '@rackdown/core';

const rows = buildCableSchedule(layout, {
  categories: ['power', 'network'],
});
```

Rows contain `connectionId`, `category`, optional `media`, and neutral endpoints `a` and `b`. Device endpoints include resolved device/port and rack information; external endpoints include their display label and resolved ID. Rows contain no SVG coordinates, routes, catalogue objects or resolved host links. Endpoint order follows the source and does not imply electrical or network direction.

The source `RackDocument` uses `schemaVersion: 1`. `RackLayout` uses `schemaVersion: 2` because `LayoutConnection.category` is required. TypeScript callers constructing layout objects must provide that field; no layout migration machinery is supplied.

## SVG options

`toSvg(layout, options?)` renders deterministic SVG. Presentation options are programmatic renderer settings, not RackDown source syntax.

| Option | Values | Default |
| --- | --- | --- |
| `theme` | `auto`, `light`, `dark`, `none` | `auto` |
| `sizing` | `pixels`, `physical`, `responsive` | `pixels` |
| `externalPlacement` | `bottom`, `right` | `bottom` |
| `routing` | `direct`, `orthogonal`, `lanes`, `perimeter` | `direct` |
| `colourMode` | `auto`, `monochrome` | `auto` |
| `namespace` | stable string | deterministically derived |

- `theme: 'auto'` embeds the default light fallback and a dark-mode override. `light` and `dark` force the fallback scheme. `none` omits the embedded stylesheet and leaves complete presentation to the host.
- `sizing: 'pixels'` keeps unitless root dimensions. `physical` adds `mm` units. `responsive` omits root `width` and `height`, leaving the host to size the SVG around its `viewBox`.
- `routing: 'direct'` is the simple default/fallback; `perimeter` is used by the Obsidian adapter.
- Explicit namespaces are used verbatim. Otherwise, core derives stable IDs from the input and render options. Hosts embedding multiple copies should supply a distinct namespace for each instance.

The renderer retains semantic metadata and accessible root markup (`role`, `<title>`, `<desc>`, `aria-labelledby` and `aria-describedby`). It emits class and `data-*` hooks so hosts can style or identify racks, devices, connections and external references without parsing generated IDs.

## Host styling

The embedded stylesheet reads CSS custom properties for colours, typography and stroke weights. Hosts can override them without changing source syntax or renderer options.

| Property | Purpose | Default |
| --- | --- | --- |
| `--rackdown-font` | Diagram text font stack | `ui-sans-serif, system-ui, sans-serif` |
| `--rackdown-title-size` | Rack titles | `14px` |
| `--rackdown-label-size` | Device, external and empty-diagram labels | Distinct defaults when unset |
| `--rackdown-u-label-size` | Rack U labels | `8.5px` |
| `--rackdown-stroke-width` | Structural strokes | `1` (`0.5` for U lines) |
| `--rackdown-connection-width` | Default connection stroke width | `2` |

Connection elements include `.rackdown-connection` and data hooks such as `data-connection-id`, `data-routing`, `data-pattern`, `data-colour-source` and optional `data-media`. Hosts may add hover emphasis with CSS; core does not embed hover-interaction rules.

For the complete SVG data-hook table, CSS custom-property reference, connection-width precedence, hover styling, theme behaviour, sizing modes and accessibility markup, see the [SVG rendering and host integration reference](../../docs/svg-rendering-and-host-integration.md). The [specification](../../docs/specification.md) documents source-language behaviour, not the complete SVG hook list. Under `theme: 'none'`, core emits no stylesheet, so the host must define all presentation rules itself.

## Boundaries

Core does not resolve filesystem, network or vault targets in external references. It preserves link intent for hosts to handle. It does not infer network topology, VLANs, routing, physical cable paths, hardware compatibility or installation safety.

See [architecture](../../docs/architecture.md) for package responsibilities and host integrations.
