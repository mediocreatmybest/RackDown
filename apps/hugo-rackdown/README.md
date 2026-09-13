# RackDown Hugo Integration Proof

This package provides a minimal proof demonstrating that an ordinary Hugo documentation site can contain native fenced `rackdown` code blocks and render them to static inline SVG diagrams at build time.

## How it works

1. **Ordinary authoring**: Authors write standard Markdown with fenced `rackdown` blocks:
   ````markdown
   ```rackdown
   rack "Comms Rack" 12U 19in
   12 switch "Core" as core
   core:1 -- [[Upstream Rack]]
   ```
   ````
2. **Prebuild preparation**: A small Node adapter (`scripts/prepare-rackdown.mjs`) scans `content/`, extracts `rackdown` code blocks, computes a deterministic SHA-256 hash for each block, and executes `@rackdown/cli` via standard I/O:
   ```bash
   node ../../packages/rackdown-cli/dist/cli.mjs render - --sizing responsive
   ```
3. **Generated SVG assets**: Resulting SVG diagrams are written to `assets/rackdown-generated/<sha256>.svg`. These generated assets are ignored by Git and never committed.
4. **Hugo code-block render hook**: Hugo's native code-block hook (`layouts/_markup/render-codeblock-rackdown.html`) hashes `.Inner`, resolves the generated SVG from Hugo's global resource asset system, and inlines the `<svg>` wrapped in `<div class="rackdown-diagram">`.
5. **Static output**: The browser receives pure static HTML with inline SVG. No client-side JavaScript, hydration, or browser-side parser is required.
6. **Error handling**: Diagnostic errors from the RackDown CLI stop the prebuild step with file and line context. If Hugo is executed without running the prebuild step first, the render hook halts the Hugo build with a clear error.

## Running the proof

From the repository root or `RackDown/`:

```bash
# 1. Build the RackDown CLI
pnpm --filter @rackdown/cli build

# 2. Prepare RackDown SVG assets for Hugo
pnpm --filter @rackdown/hugo-proof prepare:rackdown

# 3. Build the Hugo site
hugo --source apps/hugo-rackdown
```

This is an integration boundary proof, not yet a published Hugo module or theme.
