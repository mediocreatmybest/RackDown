import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeMetrics,
  extractExternalRects,
  extractRoutes,
  extractViewport,
} from './metrics.mjs';
import { presentationCases } from './presentation.mjs';

for (const { name, layout, svg } of await presentationCases()) {
  test(`${name}: complete route clearance and final extents`, () => {
    assert.ok(!layout.diagnostics.some((d) => d.severity === 'error'));
    const metrics = computeMetrics(layout, svg);
    assert.equal(metrics.connections, layout.connections.length);
    assert.equal(metrics.externalBoxInteriorRoutes, 0);
    assert.equal(metrics.foreignExternalStemRoutes, 0);
    assert.equal(metrics.localDeviceInteriorRoutes, 0);
    assert.equal(metrics.occludedMm, 0);
    const viewport = extractViewport(svg);
    const [, minX, minY] = svg.match(/viewBox="([-\d.]+) ([-\d.]+)/);
    viewport.xMm = Number(minX);
    viewport.yMm = Number(minY);
    const points = extractRoutes(svg).flatMap((route) => route.points);
    const boxes = extractExternalRects(svg);
    points.push(
      ...boxes.flatMap((box) => [
        [box.x, box.y],
        [box.x + box.w, box.y + box.h],
      ]),
    );
    for (const [x, y] of points) {
      assert.ok(x >= viewport.xMm && x <= viewport.xMm + viewport.widthMm);
      assert.ok(y >= viewport.yMm && y <= viewport.yMm + viewport.heightMm);
    }
    for (const box of boxes) {
      assert.equal(box.w, 76.2);
      assert.equal(box.h, 16);
      for (const connection of layout.connections) {
        const endpoint =
          connection.from.kind === 'external'
            ? connection.from
            : connection.to.kind === 'external'
              ? connection.to
              : undefined;
        if (endpoint?.externalId !== box.id) continue;
        const route = extractRoutes(svg).find((r) => r.id === connection.id);
        const target =
          connection.from.kind === 'external'
            ? route.points[0]
            : route.points.at(-1);
        assert.ok(Math.abs(target[0] - box.x - box.w / 2) < 0.001);
        assert.equal(target[1], box.y);
      }
    }
    if (name === 'six-callouts') assert.equal(metrics.externalRows, 2);
    if (name === 'eighteen-callouts') assert.equal(metrics.externalRows, 6);
  });
}
