# `@rackdown/cli`

Render RackDown source to SVG, check it for diagnostics, or export a cable schedule. The CLI uses the pinned offline device catalogue and does not require a browser, Obsidian vault or network connection.

The package is currently private to the workspace.

## Common commands

```bash
# Render to stdout or a file
rackdown render rack.rackdown
rackdown render rack.rackdown -o rack.svg

# Read source from stdin
cat rack.rackdown | rackdown render -

# Check source
rackdown check rack.rackdown
cat rack.rackdown | rackdown check -

# Export all documented connections as Markdown
rackdown schedule rack.rackdown

# Export network connections as CSV
rackdown schedule rack.rackdown --category network --format csv -o network-cables.csv

# Select multiple categories
rackdown schedule rack.rackdown \
  --category power \
  --category network \
  --format md
```

Use `-` as the input path to read stdin. For `render` and `schedule`, omitted output or `-o -` writes to stdout.

## Commands

### `render <file|-> [-o <file|->]`

Renders a document to SVG.

| Option | Values | Default |
| --- | --- | --- |
| `-o, --output` | File path or `-` for stdout | stdout |
| `--routing` | `direct`, `orthogonal`, `lanes`, `perimeter` | `direct` |
| `--externals` | `bottom`, `right` | `bottom` |
| `--colour` | `auto`, `monochrome` | `auto` |
| `--theme` | `auto`, `light`, `dark`, `none` | `auto` |
| `--sizing` | `pixels`, `physical`, `responsive` | `pixels` |

Non-fatal diagnostics go to stderr. If any error-severity diagnostic is produced, the CLI writes no SVG and exits with code `1`.

### `check <file|->`

Reports parser and resolver diagnostics to stderr. It produces no output when there are no diagnostics. Warnings and informational diagnostics do not cause failure; an error-severity diagnostic exits with code `1`.

### `schedule <file|-> [-o <file|->] [options]`

Builds a cable schedule from the resolved layout. It does not parse source a second time or inspect SVG output.

| Option | Values | Default |
| --- | --- | --- |
| `-o, --output` | File path or `-` for stdout | stdout |
| `--format` | `md`, `csv`, `json` | `md` |
| `--category` | `power`, `network`, `console`, `unclassified` | All categories |

Repeat `--category` to include multiple categories; values combine with OR. With no category filter, all documented connections are included. A valid empty selection still exits successfully and emits the format's empty representation or headers.

Schedule columns use **Endpoint A** and **Endpoint B**. Their order follows the source and does not imply electrical or network direction. `unclassified` is valid data, not a validation error. A schedule documents RackDown relationships; it does not prove that real-world cabling is complete.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success, including runs with warnings or informational diagnostics |
| `1` | Source produced an error-severity diagnostic |
| `2` | CLI usage error or unexpected runtime/filesystem failure |

Usage errors include unknown commands, invalid flags or enum values, and missing arguments.

## Diagnostic format

Diagnostics are deterministic plain text on stderr:

```text
<source>:<line>:<severity>: <message>
<source>:<line>:<column>: <severity>: <message>
<source>:<line>:<severity>: <message> [hint: <hint>]
```

For stdin, `<source>` is `<stdin>`.

## Deferred features

Not currently implemented: device search/discovery commands, PNG/PDF output, connection-emphasis options, GitHub Actions workflows, watch mode and configuration files.
