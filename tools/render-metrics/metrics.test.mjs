import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bendCount,
  computeMetrics,
  crossingCount,
  extractDeviceRects,
  extractRackRects,
  extractRoutes,
  extractViewport,
  lengthInsideRects,
  parseRoutePath,
  routeLength,
  segmentsCross,
} from './metrics.mjs';

const square = [{ x: 0, y: 0, w: 10, h: 10 }];

test('routeLength sums segments', () => {
  assert.equal(
    routeLength([
      [0, 0],
      [3, 0],
      [3, 4],
    ]),
    7,
  );
  assert.equal(routeLength([[0, 0]]), 0);
});

test('bendCount ignores collinear joins', () => {
  assert.equal(
    bendCount([
      [0, 0],
      [5, 0],
      [10, 0],
    ]),
    0,
  );
  assert.equal(
    bendCount([
      [0, 0],
      [5, 0],
      [5, 5],
    ]),
    1,
  );
  assert.equal(
    bendCount([
      [0, 0],
      [5, 0],
      [5, 5],
      [10, 5],
    ]),
    2,
  );
});

test('segmentsCross detects interior crossings only', () => {
  const horizontal = [
    [0, 5],
    [10, 5],
  ];
  assert.equal(
    segmentsCross(horizontal, [
      [5, 0],
      [5, 10],
    ]),
    true,
  );

  // Parallel, and collinear-overlapping, are not crossings.
  assert.equal(
    segmentsCross(horizontal, [
      [0, 7],
      [10, 7],
    ]),
    false,
  );
  assert.equal(
    segmentsCross(horizontal, [
      [2, 5],
      [8, 5],
    ]),
    false,
  );

  // A T-junction touches an endpoint rather than crossing through it.
  assert.equal(
    segmentsCross(horizontal, [
      [5, 5],
      [5, 10],
    ]),
    false,
  );

  // Segments whose infinite lines would meet outside both spans.
  assert.equal(
    segmentsCross(horizontal, [
      [20, 0],
      [20, 10],
    ]),
    false,
  );
});

test('crossingCount ignores self-intersection within one route', () => {
  const selfCrossing = {
    id: 'a',
    points: [
      [0, 0],
      [10, 10],
      [10, 0],
      [0, 10],
    ],
  };
  assert.equal(crossingCount([selfCrossing]), 0);

  assert.equal(
    crossingCount([
      {
        id: 'a',
        points: [
          [0, 5],
          [10, 5],
        ],
      },
      {
        id: 'b',
        points: [
          [5, 0],
          [5, 10],
        ],
      },
    ]),
    1,
  );
});

test('lengthInsideRects measures only the enclosed portion', () => {
  // Runs from x=-10 to x=20 at y=5; 10mm of that is inside the 10x10 square.
  const measured = lengthInsideRects(
    [
      [-10, 5],
      [20, 5],
    ],
    square,
  );
  assert.ok(
    Math.abs(measured - 10) < 0.1,
    `expected about 10mm inside, measured ${measured}`,
  );

  assert.equal(
    lengthInsideRects(
      [
        [50, 50],
        [60, 60],
      ],
      square,
    ),
    0,
  );
  assert.equal(
    lengthInsideRects(
      [
        [0, 5],
        [10, 5],
      ],
      [],
    ),
    0,
  );
});

test('lengthInsideRects does not count a route running along an edge', () => {
  assert.equal(
    lengthInsideRects(
      [
        [0, 0],
        [10, 0],
      ],
      square,
    ),
    0,
  );
});

test('lengthInsideRects does not double-count overlapping rectangles', () => {
  const overlapping = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 5, y: 0, w: 10, h: 10 },
  ];
  const measured = lengthInsideRects(
    [
      [-5, 5],
      [20, 5],
    ],
    overlapping,
  );
  assert.ok(
    Math.abs(measured - 15) < 0.1,
    `expected about 15mm inside, measured ${measured}`,
  );
});

test('parseRoutePath recovers logical route points from the rounded path grammar', () => {
  // Two rounded corners: each contributes only its control point.
  assert.deepEqual(
    parseRoutePath('M 0,0 L 37,0 Q 40,0 40,3 L 40,37 Q 40,40 43,40 L 80,40'),
    [
      [0, 0],
      [40, 0],
      [40, 40],
      [80, 40],
    ],
  );

  // A two-point route carries no curve.
  assert.deepEqual(parseRoutePath('M 0,0 L 40,40'), [
    [0, 0],
    [40, 40],
  ]);

  // A collinear interior point stays an ordinary `L` and is a route point.
  assert.deepEqual(parseRoutePath('M 0,0 L 20,0 L 40,0'), [
    [0, 0],
    [20, 0],
    [40, 0],
  ]);

  // Real perimeter output, left of the rack origin: the -6.35 stub end is a
  // collinear route point and survives, while -9.7 is only the approach to the
  // -12.7 corner and does not.
  assert.deepEqual(
    parseRoutePath(
      'M 0,62.925 L -6.35,62.925 L -9.7,62.925 Q -12.7,62.925 -12.7,65.925 L -12.7,130.35',
    ),
    [
      [0, 62.925],
      [-6.35, 62.925],
      [-12.7, 62.925],
      [-12.7, 130.35],
    ],
  );

  // Deliberately not a general SVG path parser.
  assert.throws(
    () => parseRoutePath('M 0,0 C 1,1 2,2 3,3'),
    /Unsupported command/,
  );
});

const SAMPLE_SVG = `<svg viewBox="0 0 100 200">
  <g id="n-rack-view-1" class="rackdown-rack-group rackdown-rack-front" data-rack-id="rack-1" data-face="front" data-width-inches="19">
    <rect class="rackdown-rack" x="0" y="0" width="80" height="180" />
  </g>
  <path id="n-connection-1" class="rackdown-connection" data-connection-id="connection-9" data-routing="perimeter" d="M 0,10 L 37,10 Q 40,10 40,13 L 40,50" />
  <line id="n-connection-2" class="rackdown-connection" data-connection-id="connection-10" data-routing="direct" x1="0" y1="0" x2="10" y2="10" />
  <g id="n-device-1" class="rackdown-device-group" data-device-id="device-3" data-device-type="server" data-position-u="1" data-u-height="1" data-mount-face="front">
    <clipPath id="n-device-1-clip">
      <rect x="0" y="20" width="80" height="44" />
    </clipPath>
    <title>Server</title>
    <rect class="rackdown-device" x="0" y="20" width="80" height="44" />
  </g>
</svg>`;

test('extractors read renderer output shapes', () => {
  const routes = extractRoutes(SAMPLE_SVG);
  assert.equal(routes.length, 2);

  // The rounded elbow is presentation only: the 37,10 approach and 40,13
  // departure points are dropped and the logical corner is recovered from the
  // quadratic control point, so the route reads exactly as it did before the
  // renderer started rounding it.
  const routed = routes.find((route) => route.id === 'connection-9');
  assert.deepEqual(routed.points, [
    [0, 10],
    [40, 10],
    [40, 50],
  ]);

  // `direct` routing emits <line>, which must be picked up too.
  const line = routes.find((route) => route.id === 'connection-10');
  assert.deepEqual(line.points, [
    [0, 0],
    [10, 10],
  ]);

  // The unclassed clipPath rect must not be counted as a device body.
  assert.deepEqual(extractDeviceRects(SAMPLE_SVG), [
    { x: 0, y: 20, w: 80, h: 44 },
  ]);

  assert.deepEqual(extractRackRects(SAMPLE_SVG), [
    { key: 'rack-1:front', x: 0, y: 0, w: 80, h: 180 },
  ]);

  assert.deepEqual(extractViewport(SAMPLE_SVG), {
    widthMm: 100,
    heightMm: 200,
  });
});

test('extractViewport rejects SVG without a viewBox', () => {
  assert.throws(() => extractViewport('<svg></svg>'), /viewBox/);
});

test('computeMetrics attributes foreign-rack transit correctly', () => {
  // connection-9 terminates at device-3, which sits in rack-1, so the portion of
  // its route inside rack-1 is legitimate and must not be counted as foreign.
  const layout = {
    connections: [
      {
        id: 'connection-9',
        from: { kind: 'device', deviceId: 'device-3' },
        to: { kind: 'external', externalId: 'external-1' },
      },
      {
        id: 'connection-10',
        from: { kind: 'device', deviceId: 'device-3' },
        to: { kind: 'device', deviceId: 'device-3' },
      },
    ],
  };

  const metrics = computeMetrics(layout, SAMPLE_SVG);
  assert.equal(metrics.connections, 2);
  assert.equal(metrics.foreignRackTransitMm, 0);
  assert.ok(
    metrics.occludedMm > 0,
    'connection-9 descends through the device body and should register occlusion',
  );
});

test('computeMetrics counts transit through a rack the route does not terminate in', () => {
  // Same geometry, but neither endpoint belongs to rack-1 any more.
  const layout = {
    connections: [
      {
        id: 'connection-9',
        from: { kind: 'external', externalId: 'external-1' },
        to: { kind: 'external', externalId: 'external-2' },
      },
      {
        id: 'connection-10',
        from: { kind: 'external', externalId: 'external-1' },
        to: { kind: 'external', externalId: 'external-2' },
      },
    ],
  };

  const metrics = computeMetrics(layout, SAMPLE_SVG);
  assert.ok(
    metrics.foreignRackTransitMm > 0,
    'a route crossing an unrelated rack should register foreign transit',
  );
});
