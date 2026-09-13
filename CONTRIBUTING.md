# Contributing

RackDown is still an early project, so contributions do not need to arrive as polished feature proposals. If you have a rack that RackDown cannot describe properly, an awkward bit of syntax, a rendering problem or an idea that would make the documentation more useful, a small example and an explanation of the problem is a good place to start.

We generally prefer small changes that solve a real problem we can point at. New syntax in particular is much easier to reason about when there is an example showing why the current language falls short.

Right now we are trying to keep RackDown focused on rack documentation in a simple format. That may move over time, but a new feature should have a fairly clear reason to live here.

We also prefer straightforward code and boring dependencies where they do the job. Host-specific behaviour should stay in the relevant adapter where practical and not into the core function itself.

## Getting started

To test the development setup:

1. Use Node.js 22 or newer and the pnpm version pinned in `package.json`.
2. From the project root:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm dev
```

`pnpm check` runs formatting and lint checks, typechecking, tests and curated catalogue verification. `pnpm build` builds the packages and browser playground.

If you want to poke at RackDown interactively while working on something, run:

```bash
pnpm dev
```

The playground should then be available at <http://127.0.0.1:4173>.

## Tests and behaviour

Tests should protect behaviour we actually care about: parsing and resolution, diagnostics, recovery and deterministic output. Focused assertions are usually more useful than enormous whole-diagram SVG snapshots that fail because three pixels moved sideways.

Malformed input and unknown hardware are useful test cases. RackDown tries to recover from both, so please test the unhappy path when a change touches that behaviour.

If a change affects how a rack looks, please look at the resulting diagram as well. A test suite can tell us that the SVG is deterministic; it is less gifted at telling us that a cable now takes the scenic route through half the rack.

## Device catalogue changes

The generated catalogue files should not be edited by hand. Change the selected inputs or the generator, then regenerate the output so the source, provenance and generated data continue to agree.

The curated and full catalogues have different generation and verification paths, and the upstream revision is deliberately pinned. [Upstream catalogue](docs/upstream-catalogue.md) explains how that works and what needs to move together when the data is updated.

## Where to look next

The [language specification](docs/specification.md) describes how RackDown currently behaves and the choices behind the language.

The [architecture](docs/architecture.md) explains how core, device data, rendering and host integrations currently fit together.

If those documents and the code disagree, please call it out. Stale documentation is considerably easier to fix when somebody notices it before we start treating it as archaeology.
