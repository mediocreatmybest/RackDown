# Obsidian stable viewport — Stage A

**Goal:** Keep rack scale independent of routes, with native scrolling inside notes.
**Spec:** User-supplied “Obsidian Stable Viewport and Zoom Controls”, Stage A only.
**Architecture:** Read existing SVG viewBox and projected rack rectangles; a pure calculation fits their combined width at no more than nominal scale. A small Obsidian lifecycle child applies full SVG dimensions and observes available width. CSS supplies bounded native scrolling.
**Tech stack:** Existing TypeScript, Obsidian MarkdownRenderChild, ResizeObserver, Vitest.

## Constraints

- Standalone repository, local branch from origin/main, no upstream or publishing.
- No core, DSL, schema, routing, export, dependency, or CI changes.
- Preserve category filtering, host navigation, and route interactions.
- Stage B toolbar, zoom settings, and frontmatter remain out of scope.

## Tasks

- [x] Regression: extend the existing host fixture with generated rack rectangles. Compare calculated displayed rack sizes for no, short, external, and dense routes across 6/12/42/52U and multiple/front/rear projections. Run tests and observe failure before implementation.
- [x] Geometry and lifecycle: add `viewport.ts`, separating finite positive geometry validation and size calculation from SVG/observer ownership. Fit projected rack union width, cap scale at 1, retain full viewBox dimensions. Test malformed/empty geometry, hidden containers, resizing without rendering, replacement, and unload cleanup.
- [x] CSS: constrain block/diagram width, use native overflow and 65vh maximum height, stable scrollbar gutter, remove theme max-width shrinking, expose a labelled keyboard-focusable scroll region.
- [x] Verify: run Obsidian tests and typecheck, `pnpm check`, `pnpm build`; inspect diff and perform a fresh review. Inspect in a browser if available; report real Obsidian reading view/Live Preview acceptance separately.
- [x] Commit completed Stage A locally as `fix(obsidian): stabilise rack viewport sizing`, then stop.

## Review focus

Hidden-to-visible panes must recover; scrollbar appearance must not oscillate scale; filters must size replacement SVGs; invalid geometry must remain readable; multiple projections must share one uniform scale.

## Execution record

- Clean origin/main baseline `1d31b11`, local branch `feat/obsidian-stable-viewport`, no upstream.
- Baseline: 124 Obsidian tests passed.
- Use the existing checkout as explicitly requested. Implement inline; the user supplied the design and requested implementation, so no additional design approval cycle is needed.
- Regression observed before implementation: rack width changed from 93.83px to 83.24px at 100px available width when connections were added. It now remains 100px while the full SVG width grows.
- Independent review found left routing margins could initially hide the rack. Added a failing test, then initial horizontal positioning around projected rack bounds. Hidden panes wait for positive width; later user scrolling is not reset. Follow-up review found no outstanding material issues.
- Browser inspection: 650px column (635px after scrollbar gutter) displays single racks at nominal 482.6px; 300px column (285px after gutter) displays them at approximately 285px regardless of connections. Minor subpixel rounding is expected. Tall 52U content scrolls within 65vh; keyboard End reached the external endpoints at the bottom. Front/rear, empty, light/dark views inspected.
- Real Obsidian reading view, Live Preview, split panes/sidebar changes, mobile touch, and installed themes remain manual acceptance items. No running Obsidian instance was available; the browser fixture does not substitute for host acceptance.
- Final verification: Obsidian tests (139 passed), Obsidian typecheck, `pnpm check` (including 817 core tests), `pnpm build`, and `git diff --check` all passed. No core/export files changed.
