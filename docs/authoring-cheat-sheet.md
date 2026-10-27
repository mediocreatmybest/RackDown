# RackDown authoring cheat sheet

Start with a basic rack:

```rackdown
rack "Server Rack" 12U
12 "Patch Panel"
10 2U "Production Server"
8 switch "Core Switch"
1 2U ups "UPS"
```

A complete, nonempty quoted label needs no device type and produces no missing-type warning. It declares a generic device, including with `rear` or an optional alias. Empty or unterminated labels and missing devices still warn.

Add connections and shared rows when needed:

```rackdown
rack "Workshop" 12U views front rear
12 switch "Core Switch" as core notes "Primary switch"
10 device "Mini PC A" as pc-a
10 device "Mini PC B" as pc-b
core:"Port 1" -- pc-a:"NIC 1" fibre category network
pc-b:"Console Port" adhoc -- core:2 category console notes "Service console"
notes for pc-a "Virtualisation host"
notes at rear 1 "Keep access clear"
```

- **Display label and alias:** A quoted device label, such as `"Core Switch"`, is the displayed name. `as core` is an optional short source reference. Choose distinct aliases across the RackDown block; duplicate aliases warn and can make a reference ambiguous. A bare device reference such as `core` names the whole device. Exact aliases take precedence over labels, then device types; ambiguous references warn rather than picking one.
- **Device and port references:** `core` refers to the device; `core:2` refers to one port. Quote a multiword port name after the colon, as in `core:"Port 1"`. Quote a display name to reference it directly: `"Core Switch":1 -- "Gateway":1`, or `"Core Switch" -- "Gateway"` for whole devices. Aliases remain optional; a unique type such as `ups` also works without `as`.
- **Media and category:** The optional media token after the destination describes the cable (`fibre` above). `category network` classifies the connection as `power`, `network`, `console` or `unclassified`. Media alone does not determine the category.
- **Endpoint-local `adhoc`:** Place `adhoc` beside the endpoint it qualifies, on either side of `--`. It suppresses only that endpoint's unknown-port catalogue warning; it does not suppress other diagnostics.
- **Notes:** Add `notes "plain text"` last on a device or connection; repeat it for multiple notes. Use `notes for pc-a "text"` for a device reference or `notes at [front|rear] 3 "text"` for a position on the current rack (front by default). Hosts control presentation; default SVG exports omit notes.
- **Shared rows:** Ordinary devices on the same rack face, at the same starting U and resolved height, share one row equally in source order. The two devices at U10 above split the front row. Different spans still overlap; `blank` and `shelf` have separate occupancy rules.

Racks require whole-number heights from 1U to 120U. Device positions and heights may be fractional. See the [specification](specification.md) for the complete syntax, validation and recovery rules.
