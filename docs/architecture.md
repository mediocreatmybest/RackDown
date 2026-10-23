# Architecture

RackDown is split into a small host-neutral core, optional device data and a few host integrations around it.

```text
source -> parse() -> RackDocument -> resolve() -> RackLayout -> renderer
                                       ^
                                optional DeviceIndex
```

Source handling, device enrichment and host behaviour stay separate. The same core runs in the CLI, Obsidian, the browser playground and the Hugo proof without depending on any one host.

The [specification](specification.md) describes the source language and behaviour. This page is more about how the implementation is divided up.

## How the packages fit together

`@rackdown/core` handles parsing and recovery, source-facing identity resolution, rack geometry, diagnostics, renderer-neutral contracts and deterministic SVG. Its main API is:

```ts
parse(source: string): RackDocument
resolve(document: RackDocument, devices?: DeviceIndex): RackLayout
toSvg(layout: RackLayout, options?: SvgRenderOptions): string
```

At this stage we keep core independent of Obsidian, the DOM, filesystem or network APIs, YAML and NetBox. That keeps the parser, resolver and renderer usable from different hosts without pulling host-specific assumptions into the middle of the project.

`@rackdown/devices` contains the reusable catalogue data and discovery helpers. Core only needs the compact `DeviceIndex` shape, so upstream YAML stays outside the core format. `createDeviceCatalogue(index)` provides `getDevice`, `searchDevices`, `listEndpoints` and `searchEndpoints` for any compatible index.

The search helpers are there to help authors and hosts find device information. They do not change endpoint resolution or quietly introduce fuzzy matching into the language.

Hosts can use core and devices independently. We currently keep parsing and resolution in core rather than maintaining separate versions inside each host package. Having three slightly different parsers would get ugly fairly quickly.

There are two catalogue products under `@rackdown/devices`: a small three-device curated index used by tests and the playground, and the full pinned offline payload used by the CLI and Obsidian. They share the same device semantics.

The `@rackdown/devices/full-catalogue` entry point provides source metadata, validation and a lazy decoder/provider. Hosts load the exported `full-catalogue.b64` asset using whatever build or loading mechanism makes sense for them; simply importing the entry point does not perform I/O.

See [Upstream catalogue](upstream-catalogue.md) for how those files are generated, pinned and checked, along with the limitations we currently know about.

## Author choices and catalogue information

`RackDocument` records what we understood from the source. During resolution, an explicit placement height wins first, then an enriched catalogue height, then the generic fallback. Local labels similarly take precedence over catalogue model names.

We prefer catalogue information to help describe what the author wrote rather than overrule it. Unknown devices and endpoints therefore remain usable. If known facts disagree with the source, RackDown may report that as a diagnostic instead of treating it as a compatibility failure.

Useful device facts currently include identity, manufacturer, model, part number, U-height, full-depth and airflow metadata. Endpoint facts can include names, labels, conservative aliases, kind/type, management-only status and PoE information.

The resolver keeps the useful facts in RackDown-owned metadata rather than passing the NetBox schema through the rest of the program. If information is missing, rendering falls back to something generic instead of requiring every device definition to be complete.

Quoted endpoints preserve names containing spaces. Endpoint-local `adhoc` records that an endpoint is intentionally outside the known catalogue and suppresses only that endpoint's unknown-endpoint warning. It does not hide unrelated diagnostics, and it does not turn a known endpoint into an unknown one.

## Rack layout and front/rear views

`RackLayout` contains the resolved rack and device geometry along with the semantic relationships needed by renderers and hosts.

Resolution converts either U1 numbering direction into one physical top-origin coordinate system. Fractional U positions and heights are supported. If a placement overflows the rack, we keep enough information to render and diagnose it rather than silently moving it somewhere that fits.

Placements on the same rack face with the same starting U and resolved height form an equal-width shared row. Their left-to-right order follows source order. Intersections that only partially overlap, or use different heights, remain ordinary overlaps and should warn.

Shared rows are a way of expressing that the author wants several things to occupy the same vertical interval. We are not currently trying to infer their real physical widths from catalogue metadata. Connection anchors follow the split rectangles that result.

Front and rear are two ordered views of the same rack. If no view is requested we use front only, and devices are front-mounted unless the source says `rear`.

Each face has its own vertical occupancy. Asking for a rear view does not copy front-mounted equipment into it, and a catalogue `fullDepth` fact does not currently make a device appear automatically on the opposite face. Connections remain one graph across both views.

## Rendering

The SVG renderer deals with drawing: front/rear projections, callout rectangles, route lanes, fan-out, padding, path commands and stroke mechanics. `buildCableSchedule(layout, selection?)` separately projects semantic connections into host-neutral rows without asking the SVG renderer to produce or parse output.

We keep those details out of the physical `RackLayout` model where we can. SVG also happens to use millimetres, but that does not make every SVG coordinate a statement about the real rack. Keeping that distinction gives us room for other renderers to present the same layout differently later.

External `[[targets]]` keep their identity in `RackLayout`, while the renderer decides how to present them. SVG currently places them along the bottom by default, with right-side callouts available as an option. A host such as Obsidian can decide what clicking or hovering over that target should do.

Current routing options are `direct`, `orthogonal`, `lanes` and `perimeter`. `direct` is the simple core default and fallback. The Obsidian adapter currently chooses `perimeter` because it generally produces a more useful rack view there.

Endpoint fan-out is approximate. We are not claiming that a rendered cable leaves the exact physical port position on the device. Shared corridors and sibling routes can also still get visually crowded, which is one of the less glamorous realities of drawing a lot of cables in a small space.

Portable connection styling currently consists of `color`, `pattern` (`solid`, `dashed`, `dotted`), `width` and `opacity`. Automatic colour differentiation and monochrome rendering are available programmatically. Exact SVG dash arrays, path commands and stroke details remain renderer implementation choices.

There is currently no RackDown source syntax for choosing route algorithms, styling cables or positioning external callouts. Those are presentation options selected by the host or renderer.

SVG uses CSS variables for themes, has no font dependency and keeps external target information in its semantic/accessibility data. The renderer supports pixel, physical and responsive root sizing. Its viewBox covers the complete presentation scene, including routes; a host can choose its own on-screen scale without changing exported SVG. Given the same source, device index and rendering options, we expect deterministic output. SVG IDs use either a stable namespace supplied by the host or one derived deterministically by core, without timestamps or random IDs.

## Hosts and integrations

`@rackdown/cli` reads a source file or stdin, loads the pinned full offline catalogue, then calls core parsing and resolution once. `check` reports diagnostics; `render` calls `toSvg`; `schedule` calls `buildCableSchedule` and formats Markdown, CSV or JSON. The CLI owns filesystem and standard-stream I/O, option validation and exit codes. Core does not know about those interfaces.

`obsidian-rackdown` registers RackDown fenced blocks, calls the normal core pipeline, displays diagnostics beneath the diagram and adds Obsidian-specific behaviour such as links, hover previews, themes and lifecycle cleanup.

The plugin embeds the full offline catalogue during its build and uses perimeter routing by default. Its persistent per-block connection controls select which routes to display. Its scrollable SVG viewport scales from projected rack bounds and observes pane width, so longer routes do not shrink the rack. Vault handles, DOM objects, connection interaction state and viewport sizing stay inside the adapter.

`apps/playground` uses the same core APIs with the small curated catalogue. Its controls change renderer options rather than changing the RackDown language. Build and development use esbuild to bundle imports from the supported core and devices package entry points.

`apps/hugo-rackdown` is a static-site proof. A prebuild adapter sends fenced RackDown blocks through the built CLI and stores content-addressed SVG assets; a Hugo render hook then inlines those assets. The browser receives the rendered SVG without a client-side parser.
