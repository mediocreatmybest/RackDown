# @rackdown/cli

Command-line interface for RackDown equipment rack diagrams and cable schedules.

The CLI provides standalone diagram rendering and syntax/semantic validation without requiring an Obsidian vault, a browser, or an active network connection.

## Installation and Usage

`@rackdown/cli` is currently a private workspace package.

```bash
# Render to stdout
rackdown render rack.rackdown

# Render to an SVG file
rackdown render rack.rackdown -o rack.svg

# Read from stdin and render to stdout
cat rack.rackdown | rackdown render -

# Write a Markdown cable schedule to stdout
rackdown schedule rack.rackdown

# Select documented power and network relationships
rackdown schedule rack.rackdown \
  --category power \
  --category network \
  --format md

# Write documented network relationships as CSV
rackdown schedule rack.rackdown \
  --category network \
  --format csv \
  -o network-cables.csv

# Check for diagnostics (exits non-zero on error)
rackdown check rack.rackdown

# Check from stdin
cat rack.rackdown | rackdown check -
```

## Commands

### `rackdown render <file.rackdown|-> [-o <out.svg|->] [options]`

Renders a RackDown document to SVG.

- **Source**: A file path or `-` to read from stdin.
- **Output (`-o, --output`)**: Specifies the destination file path. If omitted or set to `-`, SVG output is written directly to stdout.
- **Diagnostics**: Any non-fatal warnings or information diagnostics are written to stderr.
- **Errors**: If any error-severity diagnostic is encountered, diagnostics are emitted to stderr, no SVG is output or written to disk, and the command exits with code `1`.

#### Render Options

The CLI inherits `@rackdown/core` defaults unless explicitly overridden by the following flags:

- `--routing direct|orthogonal|lanes|perimeter`: Connection routing mode (default: `direct`).
- `--externals bottom|right`: External target placement (default: `bottom`).
- `--colour auto|monochrome`: Connection colour mode (default: `auto`).
- `--theme auto|light|dark|none`: SVG theme stylesheet (default: `auto`).
- `--sizing pixels|physical|responsive`: Root SVG dimension sizing mode (default: `pixels`).

### `rackdown check <file.rackdown|->`

Validates a RackDown document and reports parser and resolver diagnostics to stderr.

- **Source**: A file path or `-` to read from stdin.
- **Output**: Purely diagnostic. If no diagnostics exist, stdout and stderr remain empty.
- **Exit Code**: Exits `0` if there are no errors (including when warnings or info diagnostics exist); exits `1` if any error-severity diagnostic is produced.

### `rackdown schedule <file.rackdown|-> [-o <output|->] [options]`

Builds a cable schedule from the resolved `RackLayout`; source is not parsed a
second time and SVG output is not inspected.

- **Source**: A file path or `-` to read from stdin.
- **Output (`-o, --output`)**: A file path, or stdout when omitted or set to `-`.
- **Format (`--format md|csv|json`)**: Markdown by default; CSV uses the same columns, while JSON returns structured schedule rows under schedule `schemaVersion: 1`.
- **Category (`--category power|network|console|unclassified`)**: Exact, repeatable filter values combined with OR. With no category flag, all documented connections are included.
- **Diagnostics**: Warnings are written to stderr without preventing output. Error diagnostics prevent output and exit with code `1`. A valid empty selection still exits `0` and emits format-appropriate headers or an empty JSON array.

The columns use neutral **Endpoint A** and **Endpoint B** terminology. Their
order preserves RackDown authoring order and does not imply electrical or
network direction. `unclassified` is valid data, not a validation error.
Schedules report documented RackDown relationships; they do not verify that
real-world cabling is complete.

## Exit Codes

- `0`: Successful execution (including clean runs and runs with info or warning diagnostics).
- `1`: Source validation failed (one or more error-severity diagnostics were produced).
- `2`: CLI usage error (e.g. unknown command, invalid flag/enum, missing argument) or unexpected runtime/filesystem failure.

## Diagnostics

Diagnostics are written deterministically to stderr in plain text:

```text
<source>:<line>:<severity>: <message>
<source>:<line>:<column>: <severity>: <message>
<source>:<line>:<severity>: <message> [hint: <hint>]
```

When reading from stdin, `<source>` is labelled as `<stdin>`.

## Device Catalogue

The CLI uses the pinned full offline device catalogue from `@rackdown/devices` by default. No network requests are made.

## Deferred Features

The following features are intentionally deferred to future iterations:
- Device search and discovery (`devices search`);
- Raster and PDF output (PNG, PDF);
- Connection emphasis options;
- GitHub Actions workflows;
- File watch mode and configuration files.
