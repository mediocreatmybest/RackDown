# RackDown authoring cheat sheet

```rackdown
rack "Workshop" 12U views front rear
12 switch "Core Switch" as core
10 device "Mini PC A" as pc-a
10 device "Mini PC B" as pc-b
core:"Port 1" -- pc-a:"NIC 1" fibre category network
pc-b:"Console Port" adhoc -- core:2 category console
```

- **Display label and alias:** A quoted device label, such as `"Core Switch"`, is the displayed name. `as core` is an optional short source reference. Choose distinct aliases across the RackDown block; duplicate aliases warn and can make a reference ambiguous. A bare device reference such as `core` names the whole device. Exact aliases take precedence over labels, then device types; ambiguous references warn rather than picking one.
- **Device and port references:** `core` refers to the device; `core:2` refers to one port. Quote a multiword port name after the colon, as in `core:"Port 1"`. Quoted multiword device references are not yet supported in connections. Use a unique short alias until [issue #34](https://github.com/mediocreatmybest/RackDown/issues/34) is implemented.
- **Media and category:** The optional media token after the destination describes the cable (`fibre` above). `category network` classifies the connection as `power`, `network`, `console` or `unclassified`. Media alone does not determine the category.
- **Endpoint-local `adhoc`:** Place `adhoc` beside the endpoint it qualifies, on either side of `--`. It suppresses only that endpoint's unknown-port catalogue warning; it does not suppress other diagnostics.
- **Shared rows:** Ordinary devices on the same rack face, at the same starting U and resolved height, share one row equally in source order. The two devices at U10 above split the front row. Different spans still overlap; `blank` and `shelf` have separate occupancy rules.

Racks require whole-number heights from 1U to 120U. Device positions and heights may be fractional. See the [specification](specification.md) for the complete syntax, validation and recovery rules.
