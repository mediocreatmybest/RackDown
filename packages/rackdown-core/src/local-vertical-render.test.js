import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  extractDeviceRects,
  extractExternalRects,
  extractRoutes,
  routeEntersRect,
} from '../../../tools/render-metrics/metrics.mjs';
import { parse } from './parser.js';
import { roundedRoutePath, toSvg } from './renderer.js';
import { resolve } from './resolver.js';

const fixture = (name) =>
  readFileSync(
    new URL(`../../../fixtures/valid/${name}.rackdown`, import.meta.url),
    'utf8',
  );
const reduced = fixture('local-vertical-shared-row');
const full = fixture('local-vertical-garage');
const options = {
  namespace: 'local-vertical',
  connectionRouting: 'perimeter',
  externalPlacement: 'bottom',
};
const render = (source) => {
  const layout = resolve(parse(source));
  return { layout, svg: toSvg(layout, options) };
};
const routeLength = (routes) =>
  routes.reduce(
    (sum, { points }) =>
      sum +
      points
        .slice(1)
        .reduce(
          (length, p, i) =>
            length + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]),
          0,
        ),
    0,
  );
const hRoute = [
  [120.65, 222.25],
  [120.65, 216.25],
  [361.95, 216.25],
  [361.95, 222.25],
];
const permutations = (items) =>
  items.length === 0
    ? [[]]
    : items.flatMap((item, i) =>
        permutations(items.filter((_, j) => j !== i)).map((rest) => [
          item,
          ...rest,
        ]),
      );

// Frozen routes of all five unaffected connections from the pre-change head.
const unchanged = [
  [
    [482.6, 158.075],
    [488.95, 158.075],
    [495.3, 158.075],
    [495.3, 376.575],
    [488.95, 376.575],
    [482.6, 376.575],
  ],
  hRoute,
  [
    [482.6, 511.175],
    [488.95, 511.175],
    [488.95, 488.325],
    [501.65, 488.325],
    [501.65, 465.475],
    [508, 465.475],
  ],
  [
    [482.6, 379.075],
    [488.95, 379.075],
    [488.95, 546.1],
    [241.3, 546.1],
    [241.3, 576.1],
  ],
  [
    [990.6, 467.975],
    [996.95, 467.975],
    [996.95, 566.1],
    [749.3, 566.1],
    [749.3, 576.1],
  ],
];

describe('local vertical rendered presentation', () => {
  it.each([
    ['reduced', reduced, 88.9, 0],
    ['full', full, 1470.35, 14],
  ])(
    '%s fixture has distinct ownership and complete device clearance',
    (_name, source, length, bends) => {
      const { layout, svg } = render(source);
      expect(layout.diagnostics.some((d) => d.severity === 'error')).toBe(
        false,
      );
      const routes = extractRoutes(svg);
      expect(routeLength(routes)).toBeCloseTo(length, 6);
      expect(computeMetrics(layout, svg)).toMatchObject({
        bends,
        crossings: 0,
        occludedMm: 0,
        externalBoxInteriorRoutes: 0,
        foreignExternalStemRoutes: 0,
      });
      // The existing localDeviceInteriorRoutes metric only covers same-row H.
      // This independent whole-route check includes vertical endpoint interiors.
      for (const route of routes) {
        expect(
          extractDeviceRects(svg).some((rect) =>
            routeEntersRect(route.points, rect),
          ),
        ).toBe(false);
      }
    },
  );

  it('attaches the reduced pair to the two overlap midpoints', () => {
    expect(extractRoutes(render(reduced).svg).map((r) => r.points)).toEqual([
      [
        [120.65, 222.25],
        [120.65, 177.8],
      ],
      [
        [361.95, 222.25],
        [361.95, 177.8],
      ],
    ]);
  });

  it('keeps the full fixture H, side, cross-projection and external routes frozen', () => {
    const { svg } = render(full);
    const routes = extractRoutes(svg).map((r) => r.points);
    expect([routes[0], routes[1], ...routes.slice(4)]).toEqual(unchanged);
    expect(routes.slice(2, 4)).toEqual([
      [
        [118.15, 222.25],
        [118.15, 177.8],
      ],
      [
        [364.45, 222.25],
        [364.45, 177.8],
      ],
    ]);
    expect(
      extractExternalRects(svg).map(({ x, y, w, h }) => [x, y, w, h]),
    ).toEqual([
      [203.2, 576.1, 76.2, 16],
      [711.2, 576.1, 76.2, 16],
    ]);
  });

  const lines = full.trim().split('\n');
  const miniLinks = lines.filter((line) => line.startsWith('mpc'));
  it.each(permutations(miniLinks).map((order) => [order]))(
    'preserves H for source ordering %j',
    (order) => {
      let i = 0;
      const source = lines
        .map((line) => (line.startsWith('mpc') ? order[i++] : line))
        .join('\n');
      const { layout, svg } = render(source);
      const h = layout.connections.find(
        (c) => c.from.anchor.yMm === c.to.anchor.yMm,
      );
      expect(extractRoutes(svg).find((r) => r.id === h.id)?.points).toEqual(
        hRoute,
      );
      const verticals = extractRoutes(svg).filter((r) => r.points.length === 2);
      expect(
        verticals.map((r) => r.points[0][0]).sort((a, b) => a - b),
      ).toEqual([118.15, 364.45]);
      expect(computeMetrics(layout, svg).crossings).toBe(0);
    },
  );

  it.each(['8 device "Blocker"', '8.5 0.25U device "Fractional blocker"'])(
    'uses the old shallow fallback with %s',
    (blocker) => {
      const source = reduced.replace(
        '7 device "Mini PC 01"',
        `${blocker}\n7 device "Mini PC 01"`,
      );
      const { layout, svg } = render(source);
      expect(layout.diagnostics.some((d) => d.severity === 'error')).toBe(
        false,
      );
      const routes = extractRoutes(svg);
      expect(routes.map((r) => r.points)).toEqual([
        [
          [482.6, 244.475],
          [488.95, 244.475],
          [488.95, 154.325],
          [482.6, 154.325],
        ],
        [
          [482.6, 244.475],
          [488.95, 244.475],
          [488.95, 156.825],
          [482.6, 156.825],
        ],
      ]);
    },
  );

  it('checks the actual rounded Z elbow, whose curve can enter a device between clear legs', () => {
    const route = [
      [47.5, 80],
      [47.5, 60],
      [52.5, 60],
      [52.5, 40],
    ];
    const obstruction = { x: 51.7, y: 59.2, w: 0.3, h: 0.3 };
    expect(routeEntersRect(route, obstruction)).toBe(false);
    const d = roundedRoutePath(route.map(([xMm, yMm]) => ({ xMm, yMm })));
    expect(d).toContain('L 50,60 Q 52.5,60 52.5,57.5');
    // At t=0.5 this rendered quadratic lies inside the obstruction. The
    // routing test rejects this candidate using the conservative elbow box.
    const point = [
      0.25 * 50 + 0.5 * 52.5 + 0.25 * 52.5,
      0.25 * 60 + 0.5 * 60 + 0.25 * 57.5,
    ];
    expect(point[0]).toBeGreaterThan(obstruction.x);
    expect(point[0]).toBeLessThan(obstruction.x + obstruction.w);
    expect(point[1]).toBeGreaterThan(obstruction.y);
    expect(point[1]).toBeLessThan(obstruction.y + obstruction.h);
  });
});
