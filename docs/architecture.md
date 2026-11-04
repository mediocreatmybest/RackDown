# Architecture

RackDown separates the language and layout engine from device data and host integrations.

```text
source -> parse() -> RackDocument -> resolve() -> RackLayout -> renderer
                                      ^
                              optional DeviceIndex
```

The [specification](specification.md) defines source syntax and behaviour. This page describes where responsibilities live.

## Packages and responsibilities

### `@rackdown/core`

Core parses source, recovers from malformed lines, resolves source-facing references, calculates rack geometry, reports diagnostics and renders deterministic SVG.

```ts
parse(source: string): RackDocument
resolve(document: RackDocument, devices?: DeviceIndex): RackLayout
toSvg(layout: RackLayout, options?: SvgRenderOptions): string
```

Core does not depend on Obsidian, the DOM, filesystem/network APIs, YAML or NetBox. `RackDocument` preserves author intent; `RackLayout` contains resolved geometry and semantic relationships.

### `@rackdown/devices`

The devices package provides reusable catalogue data and discovery helpers. Core consumes the compact `DeviceIndex` contract rather than upstream NetBox-shaped data.

- `createDeviceCatalogue(index)` exposes `getDevice`, `searchDevices`, `listEndpoints` and `searchEndpoints`.
- A small curated index is used by tests and the playground.
- The full pinned offline catalogue is used by the CLI and Obsidian.
- `@rackdown/devices/full-catalogue` exposes metadata, validation and a lazy decoder/provider. Importing the entry point does not itself perform I/O.

Catalogue search helps authors and hosts find information; it does not change language resolution or introduce fuzzy matching. See [upstream catalogue](upstream-catalogue.md) for provenance, generation and verification rules.

## Resolution and layout

Explicit source values take precedence over catalogue defaults: a placement's explicit U-height wins over catalogue height, and a local label wins over a catalogue model name. Unknown devices and endpoints remain usable. Conflicting known facts may produce diagnostics rather than compatibility failures.

The catalogue can provide identity, manufacturer/model/part number, U-height, full-depth and airflow facts, and endpoint metadata. The resolver stores useful facts in RackDown-owned metadata instead of carrying the upstream schema through the application.

Resolution converts either U1 numbering direction into one top-origin coordinate system. Fractional positions and heights are supported. Overflow is retained for rendering and diagnostics rather than silently clamped.

Ordinary placements on the same face with the same starting U and resolved height share an equal-width row in source order. Partial overlaps and different-height intersections remain overlaps. `blank` and `shelf` have separate occupancy rules.

Front and rear are ordered projections of the same rack. Devices are front-mounted unless marked `rear`; requesting a rear view does not duplicate front-mounted devices, and `fullDepth` metadata does not automatically create an opposite-face placement. Occupancy checks are independent per face, while connections form one semantic graph.

## Rendering

The SVG renderer owns presentation geometry: external callouts, routes, lanes, fan-out, padding and stroke mechanics. It supports `direct`, `orthogonal`, `lanes` and `perimeter` routing, plus `bottom` or `right` external callouts. Core defaults to `direct` routing and bottom callouts; the Obsidian adapter currently selects perimeter routing.

Connection anchors and fan-out are approximate, not exact physical port coordinates. Crowded routes may still overlap visually. Rendering uses millimetre-derived geometry, but SVG coordinates are not a guarantee of physical placement accuracy.

`buildCableSchedule(layout, selection?)` projects semantic connections into host-neutral rows without inspecting SVG. SVG and schedules consume the same resolved layout but serve different purposes.

The renderer supports CSS-variable theming, accessible SVG markup, host data hooks, and pixel, physical or responsive root sizing. Given the same source, device index and render options, output is deterministic. Hosts can provide stable, distinct namespaces when embedding repeated diagrams.

## Hosts and integrations

- **CLI (`@rackdown/cli`)** reads a file or stdin, loads the pinned offline catalogue, and invokes the core pipeline. It owns file/stream I/O, command options and exit codes. `check` reports diagnostics, `render` writes SVG, and `schedule` writes Markdown, CSV or JSON.
- **Obsidian adapter (`obsidian-rackdown`)** registers fenced blocks, renders diagrams, displays diagnostics and adds host-specific links, hover previews, themes and lifecycle cleanup. It embeds the full offline catalogue and defaults to perimeter routing.
- **Browser playground (`apps/playground`)** uses the same core API with the small curated catalogue. Its controls change render options, not the RackDown language.
- **Hugo proof (`apps/hugo-rackdown`)** renders fenced blocks at build time through the CLI and stores content-addressed SVG assets; the browser does not run a client-side parser.

Host-specific state—vault handles, DOM objects, interaction state, viewport sizing and navigation—stays outside core.
