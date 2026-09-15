# Specification

RackDown is a small, text-first library for describing physical equipment racks in plain text and rendering them as diagrams.

We want the source to stay useful on its own. Someone reading a RackDown file without the renderer should still be able to work out what rack is being described, what equipment is in it, where things sit and what the important connections are.

## 1. What we're trying to do

The aim is to make documenting a rack roughly as quick as typing it into a spreadsheet, while giving us a consistent diagram that can be embedded in Markdown-oriented tools and other hosts.

```text
plain text
   |
   v
RackDown
   |
   v
rack model + diagnostics
   |
   v
renderer
```

Right now Obsidian is one host integration. It is useful, and my primary testing so far, but it is not part of the core language or runtime architecture.

## 2. A few design choices

These are the ideas shaping the current language. They explain why RackDown behaves the way it does today, but they are not meant to read like laws that can never change.

### Useful source text

We want a RackDown file to remain understandable even if the renderer is unavailable. The diagram is generated from the source, but the source should still make sense in a text editor, a note or a Git diff.

### Trying To Keep The Author's Intent

We generally prefer to trust what the author wrote. RackDown may warn when something looks odd or when catalogue information disagrees, but it is not currently trying to decide what hardware someone is allowed to install or connect.

For example:

```rackdown
core:banana -- server:toaster
```

is still a valid relationship if that is what the author wants to document.

### Device metadata and enrichment

A recognised device definition can add useful information such as its usual U-height, model name, depth or airflow facts and known endpoints. Unknown devices and endpoints still render, so the catalogue remains optional.

### Recovering from problems

Rack files are likely to be edited by hand, so we try not to throw the whole diagram away because one line is wrong. Where RackDown can recover sensibly, it keeps the useful parts and reports the problem as a diagnostic.

### What RackDown currently checks

RackDown checks things that affect the diagram, such as overlap, overflow and ambiguous references. We do not try to determine whether hardware is electrically, mechanically or topologically correct.

### Keeping the rack readable

The rack itself should remain the main visual subject. External references and connection paths support the diagram, so we currently keep their presentation separate from the physical rack geometry.

### Keeping core independent

Right now we keep `@rackdown/core` independent of the DOM, filesystem access, network calls, live NetBox data, YAML parsing and Obsidian. That keeps the parser, resolver and renderer usable from different hosts without dragging host-specific assumptions into core.

## 3. Core pipeline

```text
RackDown source
      |
      v
   parse()
      |
      v
 RackDocument
      |
      v
resolve(DeviceIndex?)
      |
      v
  RackLayout
      |
      v
   renderer
```

`RackDocument` should represent what the author wrote. `RackLayout` represents the resolved physical arrangement and semantic relationships. SVG is one rendering of that layout rather than the definition of the rack itself.

## 4. Rack declaration

Preferred forms:

```rackdown
rack "Main Rack" 42U 19in u1 bottom
rack "Wall Rack" 12U 10in u1 top
```

Rack height must be a positive whole number of rack units, for example `12U` or `42U`. Rack width is currently descriptive metadata. The renderer uses a common diagram width for all racks, so `10in` and `19in` do not request literal proportional drawing widths. U1 may be at the top or bottom, and the rendered numbering reflects that choice.

If rack width is omitted, resolution uses 19 inches as the layout default without warning.

Device positions and heights may use fractional U values, but the rack declaration itself uses whole rack units.

### Front and rear views

A rack may request one or both physical projections:

```rackdown
rack "Comms Rack" 12U 19in u1 bottom views front
rack "Comms Rack" 12U 19in u1 bottom views rear
rack "Comms Rack" 12U 19in u1 bottom views front rear
rack "Comms Rack" 12U 19in u1 bottom views rear front
```

If `views` is omitted, the declaration means `views front`.

View order is presentation intent. `views front rear` renders front then rear, while `views rear front` renders rear then front. A face should not be listed twice.

The rack name remains immediately after `rack`. Prefix variants such as `rack front rear "Name" ...` are not accepted syntax.

## 5. Devices

A common placement looks like this:

```rackdown
18 switch "Core Switch"
```

Placements are front-mounted by default.

Rear-mounted equipment uses the `rear` prefix:

```rackdown
rear 4 pdu "PDU A" as pdu-a
rear 3 patch "Rear Patch Panel" as rear-patch
```

Known catalogue slugs may stand on their own:

```rackdown
18 ubiquiti-unifi-dream-machine-pro as gateway
```

When a known slug has no quoted label, enrichment may provide the rendered model name. A quoted label is the author's local display label:

```rackdown
18 ubiquiti-unifi-dream-machine-pro "Main Gateway" as gateway
```

We currently keep these pieces separate:

- slug/type: what the device is;
- label: what this installation calls it;
- alias: how RackDown source refers to it;
- mounting face: which side of the rack the placement is mounted from.

Explicit U-height overrides are allowed:

```rackdown
10 3U dell-poweredge-r740 "PVE01"
```

An explicit height wins over device metadata and may produce a warning when it differs from the known definition.

Known 0U catalogue devices, such as non-rack-mounted micro PCs or small appliances, use 1U placeholder geometry with a warning when no source height is given. Supplying an explicit positive height such as `0.5U` or `1U` tells RackDown how much diagram space to allocate and takes precedence without warning.

Useful generic types work without a device index:

```text
server
switch
router
firewall
patch
ups
pdu
shelf
blank
device
```

### Blank panels and shelves

RackDown currently treats `blank` and `shelf` a little differently from ordinary equipment:

- `blank` represents deliberately occupied or covered rack space, such as blanking panels. It defaults to 1U, allows explicit positive and fractional heights, and participates in normal same-face occupancy checks. It does not join equal-width shared rows. A quoted label such as `1 2U blank "Reserved"` is shown; an unlabeled blank does not display the literal word `blank`, although accessibility metadata is still kept.
- `shelf` represents supporting fixture or background geometry rather than exclusive equipment occupancy. It defaults to 1U, allows explicit positive and fractional heights, and can coexist with ordinary equipment on the same face without overlap warnings. A shelf keeps the full rack width and does not join shared-row splitting. Equipment placed over the same shelf interval can still split equally. Quoted labels such as `10 2U shelf "Micro PCs"` are shown; unlabeled shelves suppress the literal word `shelf` while keeping accessibility metadata.
- `gap` is not part of v0. Unused U-space is already represented by having nothing placed there. We can add dedicated reserved-space syntax later if a real use case makes it worthwhile.

Aliases must be non-empty and contain no whitespace, quotes, colons, brackets or `--`, and they must not start with `//`. Quotes after `as` do not change that shape. An unusable alias warns and is ignored while the device placement is kept.

### Front and rear placement

Requesting a rear view does not copy every front-mounted device into it.

A front-mounted placement belongs to the front face and a rear-mounted placement belongs to the rear face. Known facts such as `fullDepth` are descriptive and do not currently cause automatic opposite-face rendering.

If we add opposite-face enrichment later, it should continue to describe the same physical placement rather than creating a second source device behind the scenes.

## 6. Vertical occupancy and shared rows

U-height affects layout.

A device position is the first occupied coordinate in the direction rack-unit numbers increase. This rule is the same for `u1 top` and `u1 bottom`.

For source position `P` and height `H`:

```text
axisStartU = P - 1
axisEndU   = axisStartU + H
```

Examples:

```rackdown
10 2U server "PVE01"
1  2U ups "UPS"
5.5 0.5U device "Small"
```

Resolution converts that numbering-axis interval into one physical top-origin coordinate system:

```text
u1 top:    topOffsetU = axisStartU
u1 bottom: topOffsetU = rackUnits - axisEndU
```

A placement is within bounds when `axisStartU >= 0` and `axisEndU <= rackUnits`.

### Equal-width shared rows

Multiple placements on the same rack face share a row horizontally when they have the same starting U and the same resolved U-height.

```rackdown
10 device "[[PVE01]]" as pve1
10 device "[[PVE02]]" as pve2
10 device "[[PVE03]]" as pve3
```

The three placements above occupy the same vertical interval, so they render as equal-width thirds in source order. Two matching placements render as halves, four as quarters, and so on.

This is layout behaviour rather than an attempt to infer physical device width. It works with generic, known and custom devices, on front or rear faces, and with fractional-U rows.

Only exact vertical occupancy shares a row. Intersecting intervals with different starts or resolved heights remain ordinary overlaps and should warn.

`blank` and `shelf` follow their own rules and do not participate in equal-width splitting. Ordinary equipment sharing an interval on top of a shelf still splits equally without warning against the shelf.

Connection anchors follow the resulting split device rectangles. Their visual starting points are approximate and should not be read as exact physical port coordinates.

For other overlaps and rack-boundary overflow, RackDown tries to render something useful and reports a warning. It does not silently clamp an invalid placement and pretend it fits.

Front and rear mounting faces have independent vertical occupancy for diagram checks. We do not currently validate opposite-face depth compatibility.

## 7. Connections

Connections are kept in the source because they are useful documentation even without a renderer.

There is one connection operator:

```text
--
```

Only `--` outside quoted endpoint text, plain external labels (`external "..."`), wikilinks (`[[...]]`), and Markdown links (`[...](...)`) is structural. More than one structural operator produces a warning and the connection is ignored.

Basic examples:

```rackdown
core:1 -- gateway:1
core:24 -- gateway:10 fibre
ups:out1 -- server:power1 power
```

### Device identity

Device references are resolved using source-facing identity rather than generated layout IDs.

Resolution order is:

1. exact alias;
2. exact local label;
3. case-insensitive local label;
4. exact device slug/type;
5. case-insensitive device slug/type.

Each layer must identify exactly one device. Ambiguous or unresolved references produce diagnostics instead of choosing a fuzzy or first-looking match.

Generated IDs such as `device-2` are implementation details and are not part of source-language identity.

### Endpoint names

Simple endpoint names need no quotes:

```rackdown
core:1 -- pve1:iDRAC9
```

Endpoint names containing spaces may be quoted:

```rackdown
core:2 -- pve1:"Gig-E 1"
```

Whitespace around the colon boundary is forgiving:

```rackdown
pve1:"Gig-E 1"
pve1: "Gig-E 1"
pve1:iDRAC9
pve1: iDRAC9
pve1:"iDRAC9"
```

Quotes preserve endpoint text. They do not create aliases or change catalogue matching rules.

Known endpoint metadata is optional enrichment. Resolution may canonicalise a reference through a known endpoint name, label or conservative alias, including case-insensitive forms where the result is unambiguous.

An exact canonical name takes precedence when unique. Otherwise, exact labels and aliases share one matching layer, followed by case-insensitive names, labels and aliases. If a layer contains multiple candidates, RackDown warns and keeps the authored text as an ad-hoc endpoint. It does not fall through to another layer or simply pick the first candidate. `adhoc` does not suppress ambiguity warnings.

Unknown endpoint names remain valid ad-hoc endpoints. If a known device definition provides an endpoint set, RackDown may warn and show a bounded list of known canonical endpoints while keeping the author's endpoint.

### Explicit ad-hoc endpoints

The reserved `adhoc` modifier marks one endpoint reference as intentionally outside the known catalogue:

```rackdown
core:3 -- pve1:"Intel X710 Port 1" adhoc
core:4 -- pve1:DAC10Gbit adhoc
```

It may sit beside either device endpoint:

```rackdown
pve1:"Intel X710 Port 1" adhoc -- core:3
core:3 -- pve1:"Intel X710 Port 1" adhoc
```

Its behaviour is intentionally small in scope:

- a known catalogue endpoint remains known even if `adhoc` is supplied;
- an unknown endpoint without `adhoc` remains valid and may warn;
- an unknown endpoint with `adhoc` remains an ad-hoc endpoint but suppresses only its unknown-endpoint catalogue warning;
- `adhoc` does not suppress overlap, unresolved-device or other diagnostics;
- RackDown does not create or persist a separate custom-NIC or custom-port inventory.

### Media token

Connection media is an optional token after the destination endpoint:

```rackdown
core:sfp1 -- gateway:sfp1 fibre
```

On the destination side, `adhoc` and media may appear in either order:

```rackdown
core:3 -- pve1:DAC10Gbit adhoc fibre
core:3 -- pve1:DAC10Gbit fibre adhoc
```

On the source side, only endpoint-local `adhoc` may appear before `--`; media belongs after the destination endpoint.

### Connection category

A connection has one primary category: `power`, `network`, `console` or
`unclassified`. Categories describe connections, not devices. `all` means an
unrestricted selection; it is not a category. Media, endpoint facts and visual
style remain independent.

Add `category <value>` after the optional media token:

```rackdown
ups:out1 -- pdu:input category power
pdu:out1 -- server:psu1 IEC-C13 category power
server:eth0 -- core:1 fibre category network
server:serial -- console:1 adhoc category console
server:odd -- core:odd category unclassified
```

The keyword and category value are case-insensitive; authored media text is
preserved exactly. Destination-side `adhoc` may appear before, after or between
these tokens and still applies only to that endpoint. The source-side grammar,
quoted ports and all external reference forms are unchanged.

| Destination suffix | Media | Explicit intent / recovery |
| --- | --- | --- |
| `fibre` | `fibre` | Absent; use endpoint evidence |
| `category` or `category adhoc` | `category` | Historical one-token media; no annotation |
| `category=network` | `category=network` | Historical media; no annotation |
| `category category network` | Absent | Repeated keyword: warn; unclassified |
| `category NETWORK` | Absent | `network` |
| `FiBrE category network` | `FiBrE` | `network` |
| `category unclassified` | Absent | Suppresses inference |
| `fibre category` | `fibre` | Warn; unclassified |
| `category unknown` or `category all` | Absent | Warn; unclassified |
| `category power category network` | Absent | Duplicate: warn; unclassified, even if values agree |
| `category power extra` | Absent | Extra text: warn; unclassified |

A lone first `category` must remain media for backward compatibility, so it
cannot also diagnose a missing value. With an annotation, media must precede
`category`; media literally named `category` cannot be combined with an explicit
category annotation. Invalid annotations preserve the connection and other rack content,
report token-located warnings, and suppress inference. Parsed recovery records
`category: 'invalid'`; this is never a resolved category.

Resolution uses this order:

1. Explicit valid category, including unclassified, wins. Invalid explicit
   intent recovers to unclassified.
2. Inspect only each known resolved endpoint's exact `kind`:
   `power-port` / `power-outlet` supply power; `interface` supplies network;
   `console-port` / `console-server-port` supply console.
3. If both endpoints supply different categories, return unclassified. Otherwise
   use the category supplied by either or both endpoints. With no evidence,
   return unclassified.

One known endpoint therefore suffices when the other is unknown, ad-hoc,
external, a device without a port, or a front/rear pass-through port. Those other
endpoints supply no evidence; no other cable is traced. Ambiguous port matches
remain ad-hoc and are never rematched for classification. A known endpoint stays
known when authored with `adhoc`, following the existing resolver behaviour.

No classification comes from media (including `power`, `ethernet` and `fibre`),
port shape/type alone, device names/types, aliases, appearance or connection
direction. Management-only interfaces remain network; PoE capability neither
proves live power delivery nor adds a second category or connection. Network is
broader than Ethernet. Category assignment performs no compatibility validation.

`RackLayout` uses `schemaVersion: 2` with a required `LayoutConnection.category`.
The source `RackDocument` remains at `schemaVersion: 1`. Malformed annotations
are explained by parser diagnostics; the resolved layout exposes no classification
reason taxonomy.

### Connections across rack faces

Front/rear projection does not duplicate connections. There is one semantic connection graph regardless of how many rack faces are rendered.

Known endpoint metadata can add factual endpoint information, but RackDown does not currently infer network topology, VLANs, routing, compatibility or physical cable path from it.

## 8. External references

A connection may leave the document using one of four supported forms:

```rackdown
core:1 -- external "ISP Handover"
core:2 -- [[Infrastructure/Racks/Garage]]
core:3 -- [[Infrastructure/Racks/Garage|Garage Rack]]
core:4 -- [Garage Rack](Infrastructure/Racks/Garage.md)
```

Standard web URLs are also supported through the Markdown link syntax:

```rackdown
core:5 -- [Vendor documentation](https://example.com/device)
```

The four forms separate display labels from host navigation intent:

- `external "Label"`: A plain external endpoint with no navigation intent. It renders as an external annotation and does not become a host link.
- `[[Target]]`: Host-native wiki navigation intent. The display label defaults to `Target`. Existing unqualified references like `[[Remote Rack]]` remain supported.
- `[[Target|Label]]`: Host-native wiki navigation intent separating the navigation target `Target` from the friendly display label `Label`.
- `[Label](Target)`: Markdown-style navigation intent with visible display `Label` and navigation target `Target`. In Obsidian, web URLs (`http://` or `https://`) open externally in a new browsing context, while relative or note targets navigate internal vault files. Forward slashes (`/`) are preferred in documented Obsidian paths.

Core preserves the display label along with optional link intent (`style` and `target`), but does not resolve filesystem, network or vault targets. Hosts own navigation and interaction behavior using host-neutral metadata emitted by the renderer (`data-label`, `data-link-style`, and optional `data-target`).

External endpoints remain document information rather than physical rack rectangles. `RackLayout` keeps their identity and intent while the renderer or host decides how to draw and interact with them.

## 9. Comments

Simple line comments use `//`:

```rackdown
// uplink switch
18 switch "Core"
```

## 10. Diagnostics and recovery

The current diagnostic shape is conceptually:

```ts
interface Diagnostic {
  severity: "error" | "warn" | "info";
  line: number;
  column?: number;
  message: string;
  hint?: string;
}
```

Expected diagnostics include:

- unknown device metadata;
- unknown device endpoint when a known endpoint set exists;
- duplicate alias;
- duplicate or malformed rack view clause;
- unresolved or ambiguous device reference;
- unequal or partial overlap;
- rack-boundary overflow;
- invalid rack position;
- explicit height differing from known metadata;
- recoverable malformed input.

Most of these should be warnings. Errors are kept for input that cannot be meaningfully interpreted.

RackDown is line-oriented and recovery-oriented. A malformed line should not destroy valid source around it. Completely unrecognisable input produces a diagnostic and is ignored instead of being assigned invented meaning.

RackDown tries to be forgiving, but it's not a magical psychic wizard.

## 11. Device enrichment and discovery

`resolve()` accepts an optional `DeviceIndex`, and core still works when one is not supplied.

The compact device contract may preserve factual fields such as:

- canonical slug;
- manufacturer/model/part number;
- U-height;
- reliable full-depth and airflow facts;
- endpoint names, labels and conservative aliases;
- endpoint kind/type;
- management-only status;
- PoE mode/type.

We treat these as descriptive facts rather than hardware compatibility rules.

Catalogue lookup and search live outside core. `@rackdown/devices` currently exposes a reusable catalogue wrapper equivalent to:

```ts
const catalogue = createDeviceCatalogue(index);

catalogue.getDevice(slug);
catalogue.searchDevices(query);
catalogue.listEndpoints(slug);
catalogue.searchEndpoints(slug, query);
```

Hosts may use a small, full or custom compatible index without changing parser or resolver behaviour.

We currently avoid inventing semantic aliases such as mapping `wan`, `lan`, `uplink` or `nic1` to a physical endpoint based only on labels or comments. If we cannot identify the endpoint without guessing, we would rather preserve what the author wrote and report what we know.

See [Upstream catalogue](upstream-catalogue.md) for provenance and normalisation rules.

## 12. Rendering and presentation

The current renderer produces deterministic SVG.

`selectConnections(layout, selection)` supplies a host-neutral ordered subset of
semantic connections. Optional `categories`, `deviceIds` and `connectionIds`
lists use OR within each list and AND between fields. Absent fields are
unrestricted, explicitly empty lists match nothing, and unknown values never
widen to all. Device incidence means either endpoint, one hop only, using exact
resolved IDs. Unclassified connections require an explicit `unclassified` entry
in a category-restricted view. Selection does not mutate or trim `RackLayout`.

`toSvg(layout, { connectionSelection: selection })` uses the same selector. It
calculates the full presentation and routing before omitting unselected
connection elements. All racks/devices, shared-row widths and the full-scene
viewport remain. Unused external callouts are omitted, but their reserved space
and the positions of surviving callouts remain. Colours, explicit styles and
routes of retained connections are stable across selections in every routing
mode. Selection contributes to automatic SVG namespaces; explicit host namespaces
remain host-owned. Filtering is not redaction, equipment removal or interactive
emphasis. CLI/Hugo filtering options, Obsidian filtering UI and schedules are not
part of this core capability.

Presentation geometry includes things such as:

- external-callout placement;
- connection path routing;
- route lanes/fan-out;
- decorative padding;
- stroke/dash mechanics.

We keep those details in the renderer rather than treating them as physical `RackLayout` geometry just because SVG also happens to use millimetres.

Current external placement modes are `bottom` and `right`, with bottom as the core renderer default.

Current connection routing modes are:

```text
direct
orthogonal
lanes
perimeter
```

`direct` is the core renderer's simple default and fallback. `perimeter` is the richer routing mode and is currently selected by the Obsidian host.

Visual endpoint fan-out is approximate. It does not claim exact physical port coordinates.

### Local perimeter presentation

Perimeter routing reserves same-row Class H routes first, without changing their
attachment or track policy. It then tries local vertical attachments for devices
in the same rack projection. Their facing edges must have a gap, and their
horizontal spans must overlap. Front and rear are separate projections.

The local vertical attempt is limited to the existing Class V short-hop range:
raw-anchor vertical separation greater than 0.001 mm and at most 88.9 mm. Longer
connections retain the existing lane-consuming strategy so downstream perimeter
allocations remain stable. Facing-edge gaps and overlap widths must exceed the
0.01 mm geometry tolerance.

The preferred X is the midpoint of the horizontal overlap. Attachments use the
bottom edge of the upper device and the top edge of the lower device, trying
offsets of 0, -2.5 and +2.5 mm. Out-of-bounds positions are unavailable, never
clamped or compressed. Straight vertical routes are preferred. If those fail,
at most six Z-shaped candidates use distinct fan positions and one horizontal
seam halfway between the facing edges. They are ordered by length, then upper
and lower fan order. No candidate leaves the overlap/gap rectangle or its rack.

Every complete local vertical route is checked against all device interiors,
including both endpoint devices; boundary contact is legal. Rounded elbows are
also checked using conservative control-point bounding boxes. A local vertical
route keeps 2.5 mm centreline separation from reserved Class H routes and earlier
accepted local vertical routes. That geometric separation does not promise
painted-stroke clearance at every display scale or custom thickness.

Only accepted routes reserve local space. They consume no perimeter corridor
state, and failed candidates consume no state. Existing attachment fan counts
still include every connection. Geometry ordering remains top-down by raw-anchor
mean Y, with source order breaking ties. Exhausted or blocked local attempts
fall back to the existing perimeter strategy; source direction, RackLayout and
direct/orthogonal/lanes behaviour are unchanged.

### Connection style intent

Renderer-neutral connection style intent currently includes:

```text
color
pattern: solid | dashed | dotted
width
opacity
```

Automatic colour differentiation and monochrome rendering are supported programmatically. Exact SVG dash arrays, path commands and stroke mechanics remain renderer implementation details.

There is currently no accepted source-language syntax for routing or connection styling. Hosts and renderers choose those presentation options.

## 13. Deterministic output

Given the same source, device index and render options, RackDown should produce the same output.

We avoid timestamps, random IDs and unstable ordering in generated output.

SVG IDs are namespaced. A host may supply a stable namespace; otherwise core derives one deterministically.

Generated catalogue data follows the same reproducibility approach described in [Upstream catalogue](upstream-catalogue.md).

## 14. Current scope

This is the scope we are aiming at for the current version. It is useful as a boundary for 0.1.0, not a promise that RackDown can never grow beyond it.

### Included right now

- arbitrary rack height;
- 10-inch and 19-inch descriptive rack width;
- U1 top or bottom;
- fractional-U-capable coordinates;
- ordered front/rear views;
- front and rear mounting intent;
- generic devices and optional known slugs;
- aliases and local labels;
- known or explicit U-height;
- equal-width shared rows for identical vertical occupancy;
- simple connections;
- quoted endpoint names;
- unknown endpoints and explicit endpoint-local `adhoc` intent;
- semantic external references;
- optional device enrichment and catalogue discovery;
- diagnostics and recovery;
- deterministic SVG;
- renderer-owned external placement;
- deterministic renderer-owned connection routing;
- renderer-neutral programmatic connection style intent;
- browser playground;
- optional host adapters such as Obsidian.

### Outside of our scope

- DCIM/IPAM;
- live NetBox queries;
- network topology modelling;
- VLAN/IP semantics;
- power or thermal calculations;
- mechanical compatibility enforcement;
- automatic opposite-face device presence from incomplete metadata;
- physical port-coordinates or placement accuracy;
- explicit horizontal slot/width syntax or physical-width inference;
- drag-and-drop editing; (It would be nice in the host adapters though)
- host-specific semantics in core.
