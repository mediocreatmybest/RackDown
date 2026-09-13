# Generated example renders

Files in this directory are **derived artefacts**. The `.rackdown` sources in the
parent directory remain authoritative.

Each committed SVG is produced by the real `@rackdown/cli` binary from a source
declared in [`../examples.json`](../examples.json):

```text
examples/*.rackdown -> rackdown render -> examples/generated/*.svg
```

To add a canonical render, add an entry to the `generated` array in
`examples.json` and run:

```bash
pnpm examples:generate
```

Commit the resulting SVG in the same pull request as the change that altered it.
CI runs `pnpm examples:verify`, which re-renders every declared entry and fails
when a committed SVG is stale, missing or no longer declared. CI never commits
regenerated SVGs itself.

Verification is a byte comparison, so the committed SVGs must stay LF-encoded.
`.gitattributes` already enforces `* text=auto eol=lf` for the whole tree, which
keeps the comparison stable on Windows checkouts as well as Linux.
