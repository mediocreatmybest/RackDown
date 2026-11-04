# RackDown authoring cheat sheet

Use this page for common syntax. The [specification](specification.md) covers validation, recovery and less common cases.

## 1. Declare a rack and place devices

```rackdown
rack "Server Rack" 12U 19in u1 bottom views front rear

12 "Patch Panel"
10 2U server "Production Server" as server
8 switch "Core Switch" as core
1 2U ups "UPS" as ups
rear 2 pdu "Rear PDU" as pdu
```

- Rack heights are whole numbers from `1U` to `120U`.
- Device positions and heights can be fractional.
- `u1 top` is the default numbering direction; `u1 bottom` reverses the physical numbering.
- Devices mount on the front unless prefixed with `rear`.
- A nonempty quoted label can declare a generic device without a type. For example, `12 "Patch Panel"` is valid.

## 2. Connect devices

```rackdown
core:1 -- server:"NIC 1" fibre category network
ups:out1 -- pdu:input category power
server:serial adhoc -- core:2 category console
core:3 -- external "ISP Handover"
core:4 -- [[Infrastructure/Racks/Garage|Garage Rack]]
```

- `device` refers to a whole device; `device:port` refers to a port.
- Use quotes for names containing spaces or punctuation, for example `"Core Switch":"Port 1"`.
- Aliases declared with `as name` are optional, but must be unique and contain no whitespace.
- Connection media (such as `fibre`) and category are separate. Categories are `power`, `network`, `console` and `unclassified`.
- Put `adhoc` beside the endpoint it applies to. It suppresses only that endpoint's unknown-catalogue-endpoint warning; it does not hide other diagnostics.
- Unknown devices and endpoints remain documentable. Diagnostics flag issues without discarding useful source unnecessarily.

## 3. Add notes

```rackdown
rack "Lab" 8U views front rear
8 switch "Core" as core notes "Primary switch"
5 "Host" as host
core:1 -- host:1 fibre category network notes "Backup uplink"

notes for host "Runs three virtual machines"
notes at 3 "Temporary installation"
notes at rear 3.5 "Leave rear access clear"
```

- Inline `notes "text"` follows a complete device or connection declaration. Repeat it to add multiple notes.
- `notes for <device-reference> "text"` attaches a note to a device.
- `notes at [front|rear] <position> "text"` annotates a rack position; the face defaults to `front`.
- Notes are source data for hosts to display. Default SVG output omits them.

## 4. Remember the layout rules

- Ordinary devices on the same face, with the same starting U and resolved height, share the row equally in source order.
- Devices with different vertical intervals still overlap and may warn.
- `blank` occupies rack space and participates in overlap checks; `shelf` is supporting geometry and can coexist with equipment.
- Requesting a rear view does not duplicate front-mounted devices. Front and rear have separate occupancy checks.
- RackDown documents the author's intent; it does not prove electrical, mechanical or network safety.

## Reference

- [Full language specification](specification.md)
- [Architecture and package boundaries](architecture.md)
- [Core API and SVG options](../packages/rackdown-core/README.md)
- [CLI commands](../packages/rackdown-cli/README.md)
