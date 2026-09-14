# RackDown

**Write or record the rack, RackDown draws it.**

RackDown describes equipment racks in plain text and turns them into diagrams.
Keep the source in notes or Git, review changes as text, and render the same rack in different tools.
The document stays readable even without using a renderer.

```rackdown
rack "Example Rack" 8U 19in u1 bottom views front rear

8 switch "Core" as core
5 2U server "Host" as host
rear 2 pdu "Power" as power

core:1 -- host:"NIC 1" adhoc
core:2 -- [[Upstream Rack]]
power:1 -- host:power1
```

Try it in the playground with `pnpm dev`. The diagram shows front and rear views
in the declared order, with external targets shown as annotations. More
[examples](examples/) cover catalogue devices, routing and shared rows.

> [!NOTE]
> Please note that I'm not a software developer by trade, I also don't code in TypeScript/JavaScript/etc., and this project is an experiment due to my dripping hatred of rack diagrams being recorded in spreadsheets.
> RackDown has been created with a combination of tools, including Codex, Claude, Gemini, and a bunch of manual editing and tweaking, with weeks and weeks of testing.
> As the famous poet Limpbizkit says, "Results May Vary".

## Optional enrichment

Generic and unknown devices will always remain valid. An optional catalogue adds typical heights, model names and endpoint facts; but it does not decide what you can install or connect.
Explicitly set heights and local labels should always take precedence over catalogue defaults.
Quoted endpoint names and `adhoc` let you describe the actual installation when using catalogue slugs and data.

RackDown's device data is pulled from the [NetBox Community Device Type Library](https://github.com/netbox-community/devicetype-library).
Its users and contributors maintain awesome hardware definitions that make this enrichment possible. It is a great project, so check it out.
RackDown is an independent muckabout project and does not claim affiliation with anyone.

## Packages and hosts

| Component              | Purpose                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `@rackdown/core`       | Host-neutral parsing, resolution, `RackLayout` and SVG rendering; no runtime dependencies |
| `@rackdown/devices`    | Optional catalogue data and reusable device/endpoint discovery                            |
| `@rackdown/cli`        | Command-line interface for SVG diagram rendering and syntax/semantic checking             |
| `obsidian-rackdown`    | Optional adapter for fenced blocks, links, themes and diagnostics in Obsidian             |
| `@rackdown/hugo-proof` | Minimal Hugo proof site rendering fenced blocks via CLI prebuild and render hook          |
| `apps/playground`      | Browser demo using the same core APIs and a small curated catalogue                       |

Core works without Obsidian, a browser or a catalogue. Hosts supply source and
optional enrichment, then choose how to display the result.

## Command-line interface

Render a diagram to SVG or check a document for diagnostics:

```bash
# Render to SVG (stdout or output file)
rackdown render rack.rackdown -o rack.svg

# Check for diagnostics (exits non-zero on error)
rackdown check rack.rackdown
```

### Hugo static-site integration

A minimal proof demonstrates Hugo rendering fenced `rackdown` blocks to inline SVG at build time using the CLI prebuild adapter and native code-block render hook:

```bash
pnpm --filter @rackdown/cli build
pnpm --filter @rackdown/hugo-proof prepare:rackdown
hugo --source apps/hugo-rackdown
```

## Obsidian presentation controls

In Obsidian's RackDown plugin settings, choose routing (Perimeter, Direct,
Orthogonal or Lanes), external placement (Bottom or Right), connection colour
(Auto or Monochrome), and theme (Auto, Light or Dark). Defaults are Perimeter,
Bottom, Auto colour and Auto theme. Auto theme follows Obsidian. Settings are
saved across plugin reloads. Reading View updates when a setting changes;
existing Live Preview blocks pick up changes on their next normal render.

Diagrams automatically use responsive sizing to fit the note pane. Hover or
keyboard-focus a connection to emphasise it. Its context menu offers **Hide
connection**, also available through Shift+F10 or the Context Menu key when
focused. A hidden-route count and **Show all** button restore hidden routes.
Hiding is temporary, local to that rendered block, and resets on rerender; it
never changes the note or saved settings.

## Development and Getting started

To test the development setup:

1. Use Node.js 22 or newer and the pnpm version pinned in `package.json`.
2. From the project root:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm dev
```

The playground should then be available at <http://127.0.0.1:4173>.

### Want To Contribute?

Do you see any issues, or suggestions, maybe fixes, please open an issue or submit a pull request. 
Connector routing is something that needs love and attention, so feel free to contribute improvements or suggestions. 
Do I have too much waffling here? To much text perhaps? 
Just imagine, you could help fix that problem! YES, YOU! See [Contributing](CONTRIBUTING.md) for more fun and excitement!

## Status and documentation

FYI, I'm still trying to figure things out. So, no RackDown packages or releases have been created yet, but building the workspace is fairly straight forward.
The Obsidian adapter has been tested on desktop; mobile device validation remains outstanding, and is my primary method of testing.

- [Library specifications](docs/specification.md)
- [Architecture and integrations](docs/architecture.md)
- [Upstream catalogue, licences and generation](docs/upstream-catalogue.md)
- [Why RackDown exists, and really, should it?](HISTORY.md)

RackDown is licensed under [AGPL-3.0-only](LICENSE). The pinned upstream device
data has separate [CC0-1.0 provenance](docs/upstream-catalogue.md).
