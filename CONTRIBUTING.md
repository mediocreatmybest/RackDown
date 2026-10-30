# Contributing

Small, focused contributions are welcome: a rack that cannot be described, confusing syntax, a rendering issue, a documentation gap or a concrete improvement to the project.

Prefer changes that solve a clear problem. For proposed syntax, include an example that shows why the existing language is insufficient. Keep host-specific behaviour in the relevant adapter where practical, rather than adding host assumptions to core.

## Development setup

Requirements: Node.js 22 or newer and the pnpm version pinned in the root `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm dev
```

The playground should be available at <http://127.0.0.1:4173> after `pnpm dev`.

- `pnpm check` runs formatting and lint checks, typechecking, tests and curated catalogue verification.
- `pnpm build` builds the packages and browser playground.

## Tests and documentation

Add focused tests for the behaviour being changed, especially parsing, resolution, diagnostics, recovery and deterministic output. Include malformed input or unknown hardware cases when relevant.

For rendering changes, inspect the resulting diagram as well as running tests. Deterministic SVG alone does not guarantee that a route is visually useful.

When changing documentation, keep examples aligned with the parser, resolver, renderer and CLI. Prefer linking to the authoritative explanation over repeating long sections across files.

## Device catalogue changes

Do not edit generated catalogue files by hand. Update the selected inputs or generator, then regenerate the output so source, provenance and generated data stay aligned. The curated and full catalogues have different generation and verification paths, and the upstream revision is pinned.

See [upstream catalogue](docs/upstream-catalogue.md) for generation, provenance and verification details.

## Project references

- [Authoring cheat sheet](docs/authoring-cheat-sheet.md) — common syntax and examples.
- [Language specification](docs/specification.md) — full language behaviour, validation and recovery.
- [Architecture](docs/architecture.md) — package responsibilities and integration boundaries.
- [Core API](packages/rackdown-core/README.md) — parsing, selection, schedules and SVG rendering.
- [CLI](packages/rackdown-cli/README.md) — commands, options and exit codes.

If the docs and implementation disagree, please raise it or include a correction in your contribution.
