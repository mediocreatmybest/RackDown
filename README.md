# RackDown

**Describe a rack in text. Render it as a diagram.**

RackDown is a text-first format and toolkit for documenting equipment racks and their connections. Keep layouts readable in notes and Git diffs, then render them as SVG.

```rackdown
rack "Example Rack" 8U 19in views front rear

8 switch "Core" as core
5 2U server "Host" as host
rear 2 pdu "Power" as power

core:1 -- host:"NIC 1" fibre category network
power:1 -- host:power1 category power
core:2 -- [[Infrastructure/Racks/Upstream]]
```

## Example diagram

The image below is a separate example, rendered from [`examples/3-node-shelf.rackdown`](examples/3-node-shelf.rackdown). It is **not** the output of the introductory `Example Rack` source shown above.

<a href="examples/generated/3-node-shelf.png">
  <img src="examples/generated/3-node-shelf.png" alt="Rendered RackDown example of a three-node cluster on a shelf; source: examples/3-node-shelf.rackdown" width="450">
</a>

Explore the [`examples/`](examples/) directory for the source and generated diagrams for rack layouts, clusters, connections and shared rows.

## What it supports

- Text-based rack declarations, front/rear views, device placement and aliases.
- Connections with named endpoints, optional media and explicit categories.
- Optional device catalogue enrichment; unknown hardware can still be documented.
- Diagnostics and recovery for malformed or ambiguous input.
- Deterministic SVG rendering, external references and cable schedules.
- Integrations for the CLI, browser playground and Obsidian, plus a Hugo proof.

RackDown records what you document. It does not validate whether an installation is electrically, mechanically or topologically safe.

## Try it locally

Requirements: Node.js 22+ and the pnpm version pinned by the workspace.

```bash
git clone https://github.com/mediocreatmybest/RackDown.git
cd RackDown
pnpm install --frozen-lockfile
pnpm dev
```

Open <http://127.0.0.1:4173> for the playground.

## Command line

Build the workspace CLI, then use it to render, check or export schedules:

```bash
pnpm --filter @rackdown/cli build
node packages/rackdown-cli/dist/cli.mjs render rack.rackdown -o rack.svg
node packages/rackdown-cli/dist/cli.mjs check rack.rackdown
node packages/rackdown-cli/dist/cli.mjs schedule rack.rackdown --category network --format csv -o network-cables.csv
```

The CLI uses the pinned offline device catalogue; it does not require network access.

## Workspace

| Area | Purpose |
| --- | --- |
| `packages/rackdown-core` | Parser, resolver, diagnostics, layout and SVG renderer |
| `packages/rackdown-devices` | Curated and full device catalogues |
| `packages/rackdown-cli` | Render, check and cable-schedule commands |
| `packages/obsidian-rackdown` | Obsidian integration |
| `apps/playground` | Browser playground |
| `apps/hugo-rackdown` | Static-site rendering proof |
| `docs/` | Language, authoring and architecture documentation |

## Development

```bash
pnpm check
pnpm build
```

Start with the [authoring cheat sheet](docs/authoring-cheat-sheet.md), then consult the [specification](docs/specification.md) for complete language behaviour.

- [Architecture](docs/architecture.md)
- [Upstream catalogue](docs/upstream-catalogue.md)
- [Contributing](CONTRIBUTING.md)
- [History](HISTORY.md)

## Project status and licence

RackDown is experimental; workspace packages are not currently presented as published releases. The Obsidian adapter has been tested on desktop; mobile validation remains outstanding.

The project is licensed under **AGPL-3.0-only**. Pinned upstream device data has its own CC0 provenance; see the [catalogue documentation](docs/upstream-catalogue.md).
