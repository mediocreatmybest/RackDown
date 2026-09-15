import { describe, expect, it, vi } from 'vitest';
import type { DeviceIndex } from './devices.js';
import type { PointMm, RackLayout } from './layout.js';
import { parse } from './parser.js';
import { roundedRoutePath, toSvg } from './renderer.js';
import { resolve } from './resolver.js';
import * as routingModule from './routing.js';

interface ViewBoxMetrics {
  x: number;
  y: number;
  width: number;
  height: number;
}

function viewBoxMetrics(svg: string): ViewBoxMetrics {
  const match = svg.match(/viewBox="([^"]+)"/);
  if (!match?.[1]) {
    throw new Error('SVG is missing a viewBox');
  }
  const values = match[1].split(' ').map(Number);
  const [x, y, width, height] = values;
  if (
    x === undefined ||
    y === undefined ||
    width === undefined ||
    height === undefined ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    throw new Error('SVG viewBox is invalid');
  }
  return { x, y, width, height };
}

/** Renderer view padding and gutters, mirrored for viewport assertions. */
const PADDING_MM = 6.35;
const LEFT_GUTTER_MM = 19.05 + PADDING_MM;
const TOP_GUTTER_MM = 19.05 + PADDING_MM;

/** Every coordinate pair emitted in a connection path's `d` attribute. */
function routePoints(svg: string): PointMm[] {
  const points: PointMm[] = [];
  for (const path of svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)) {
    const data = path[1];
    if (data === undefined) {
      continue;
    }
    for (const pair of data.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) {
      points.push({ xMm: Number(pair[1]), yMm: Number(pair[2]) });
    }
  }
  return points;
}

/** External annotation rectangles emitted by the renderer. */
function externalRects(svg: string): ViewBoxMetrics[] {
  const rects: ViewBoxMetrics[] = [];
  for (const rect of svg.matchAll(
    /<rect class="rackdown-external-box" x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g,
  )) {
    rects.push({
      x: Number(rect[1]),
      y: Number(rect[2]),
      width: Number(rect[3]),
      height: Number(rect[4]),
    });
  }
  return rects;
}

function expectPointsInsideViewport(svg: string): void {
  const view = viewBoxMetrics(svg);
  const points = routePoints(svg);
  expect(points.length).toBeGreaterThan(0);
  for (const point of points) {
    expect(point.xMm).toBeGreaterThanOrEqual(view.x);
    expect(point.yMm).toBeGreaterThanOrEqual(view.y);
    expect(point.xMm).toBeLessThanOrEqual(view.x + view.width);
    expect(point.yMm).toBeLessThanOrEqual(view.y + view.height);
  }
}

/**
 * Asserts the viewport is exactly the drawn content plus the standard gutters,
 * i.e. that no routing envelope was reserved around it.
 */
function expectTightViewport(svg: string): void {
  const view = viewBoxMetrics(svg);
  const points = [
    ...routePoints(svg),
    ...externalRects(svg).flatMap((rect) => [
      { xMm: rect.x, yMm: rect.y },
      { xMm: rect.x + rect.width, yMm: rect.y + rect.height },
    ]),
  ];
  expect(points.length).toBeGreaterThan(0);

  const minX = Math.min(...points.map((point) => point.xMm));
  const minY = Math.min(...points.map((point) => point.yMm));
  const maxX = Math.max(...points.map((point) => point.xMm));
  const maxY = Math.max(...points.map((point) => point.yMm));

  expect(view.x).toBeCloseTo(minX - LEFT_GUTTER_MM, 6);
  expect(view.y).toBeCloseTo(minY - TOP_GUTTER_MM, 6);
  expect(view.x + view.width).toBeCloseTo(maxX + PADDING_MM, 6);
  expect(view.y + view.height).toBeCloseTo(maxY + PADDING_MM, 6);
}

function expectRectsInsideViewport(svg: string): void {
  const view = viewBoxMetrics(svg);
  const rects = externalRects(svg);
  expect(rects.length).toBeGreaterThan(0);
  for (const rect of rects) {
    expect(rect.x).toBeGreaterThanOrEqual(view.x);
    expect(rect.y).toBeGreaterThanOrEqual(view.y);
    expect(rect.x + rect.width).toBeLessThanOrEqual(view.x + view.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(view.y + view.height);
  }
}

function derivedRootId(svg: string): string {
  const match = svg.match(/<svg id="([^"]+)"/);
  if (!match?.[1]) {
    throw new Error('SVG is missing a root id');
  }
  return match[1];
}

const DARK_MEDIA_QUERY = '@media (prefers-color-scheme: dark)';

function svgStyleBlock(svg: string): string {
  const match = svg.match(/<style>([\s\S]*?)<\/style>/);
  if (!match?.[1]) {
    throw new Error('SVG is missing its embedded stylesheet');
  }
  return match[1];
}

/** Extracts the balanced `prefers-color-scheme: dark` block from a stylesheet. */
function darkSchemeBlock(style: string): string {
  const opening = style.indexOf(DARK_MEDIA_QUERY);
  if (opening === -1) {
    throw new Error('SVG stylesheet has no dark colour-scheme block');
  }
  let depth = 0;
  for (let index = opening; index < style.length; index += 1) {
    const character = style[index];
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return style.slice(opening, index + 1);
      }
    }
  }
  throw new Error('SVG dark colour-scheme block is unbalanced');
}

/** Everything the stylesheet declares before the dark override block. */
function lightSchemeSection(style: string): string {
  const opening = style.indexOf(DARK_MEDIA_QUERY);
  return opening === -1 ? style : style.slice(0, opening);
}

describe('toSvg', () => {
  it('renders rack units and devices deterministically', () => {
    const layout = resolve(
      parse(
        `rack "Comms Rack" 3U 19in u1 bottom\n3 switch "Core"\n2 0.5U device "Half"`,
      ),
    );

    const first = toSvg(layout, { namespace: 'test' });
    const second = toSvg(layout, { namespace: 'test' });

    expect(first).toBe(second);
    expect(first).toContain('id="rackdown-test-root"');
    expect(first.indexOf('data-u="3"')).toBeLessThan(
      first.indexOf('data-u="2"'),
    );
    expect(first).toContain('data-u-height="0.5"');
    expect(first).toContain('rackdown-device-label-compact');
    expect(first).toContain('height="22.225"');
    expect(first).toContain('>Core</text>');
  });

  it('renders requested front and rear views in source order', () => {
    const frontRear = toSvg(
      resolve(
        parse(
          `rack "Comms Rack" 3U views front rear\n3 switch "Front Device"\nrear 2 pdu "Rear Device"`,
        ),
      ),
      { namespace: 'front-rear' },
    );
    const rearFront = toSvg(
      resolve(
        parse(
          `rack "Comms Rack" 3U views rear front\n3 switch "Front Device"\nrear 2 pdu "Rear Device"`,
        ),
      ),
      { namespace: 'rear-front' },
    );

    expect(frontRear.indexOf('data-face="front"')).toBeLessThan(
      frontRear.indexOf('data-face="rear"'),
    );
    expect(rearFront.indexOf('data-face="rear"')).toBeLessThan(
      rearFront.indexOf('data-face="front"'),
    );
    expect(frontRear).toContain('>Comms Rack · Front</text>');
    expect(frontRear).toContain('>Comms Rack · Rear</text>');
    expect(frontRear).toContain('data-mount-face="front"');
    expect(frontRear).toContain('data-mount-face="rear"');
  });

  it('does not project front-mounted devices into a rear-only view', () => {
    const svg = toSvg(
      resolve(
        parse(
          `rack "Rack" 3U views rear\n3 switch "Front Device" as core\nrear 2 pdu "Rear Device" as pdu\ncore:1 -- [[Hidden Front Link]]\npdu:1 -- [[Visible Rear Link]]`,
        ),
      ),
      { namespace: 'rear-only' },
    );

    expect(svg).not.toContain('>Front Device</text>');
    expect(svg).toContain('>Rear Device</text>');
    expect(svg).not.toContain('data-target="Hidden Front Link"');
    expect(svg).toContain('data-target="Visible Rear Link"');
  });

  it('keeps cross-face connections as one semantic connection', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 3U views front rear\n3 switch "Front" as front\nrear 2 pdu "Rear" as rear\nfront:1 -- rear:1 power`,
      ),
    );
    const svg = toSvg(layout, { namespace: 'cross-face' });

    expect(layout.connections).toHaveLength(1);
    expect(svg.match(/id="rackdown-cross-face-connection-/g)).toHaveLength(1);
  });

  it('respects top-down rack numbering', () => {
    const svg = toSvg(resolve(parse(`rack "Rack" 3U 19in u1 top`)), {
      namespace: 'top',
    });

    expect(svg.indexOf('data-u="1"')).toBeLessThan(svg.indexOf('data-u="2"'));
  });

  it('renders external targets below the rack by default', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 3U\n3 switch "Core" as core\n2 router "Gateway" as gateway\ncore:24 -- gateway:lan fibre\ngateway:wan -- [[ISP Handover]]`,
      ),
    );
    const svg = toSvg(layout, { namespace: 'connections' });

    expect(svg).toContain(
      'class="rackdown-connection rackdown-connection-ad-hoc rackdown-connection-default-width"',
    );
    expect(svg).toContain('data-media="fibre"');
    expect(svg).toContain('data-external-placement="bottom"');
    expect(svg).toContain('class="rackdown-external-group"');
    expect(svg).toContain('class="rackdown-external-box"');
    expect(svg).toContain('data-placement="bottom"');
    expect(svg).toContain('data-target="ISP Handover"');
    expect(svg).toContain('<title>ISP Handover</title>');
    expect(svg).toContain('>ISP Hando…</text>');
  });

  describe('connection titles', () => {
    it('names both endpoints and media on a device-to-device connection', () => {
      const layout = resolve(
        parse(
          `rack "Rack" 3U\n3 switch "Core" as core\n2 router "Gateway" as gateway\ncore:24 -- gateway:lan fibre`,
        ),
      );
      const svg = toSvg(layout, { namespace: 'connection-titles' });

      expect(svg).toContain('<title>core:24 → gateway:lan (fibre)</title>');
    });

    it('uses the external target verbatim and omits absent media', () => {
      const layout = resolve(
        parse(
          `rack "Rack" 3U\n3 router "Gateway" as gateway\ngateway:wan -- [[ISP Handover]]`,
        ),
      );
      const svg = toSvg(layout, { namespace: 'external-title' });

      expect(svg).toContain('<title>gateway:wan → ISP Handover</title>');
    });

    it('falls back to the device label when no alias exists', () => {
      const layout = resolve(
        parse(
          `rack "Rack" 3U\n3 switch "Core"\n2 router "Gateway"\nCore:24 -- Gateway:lan`,
        ),
      );
      const svg = toSvg(layout, { namespace: 'label-title' });

      expect(svg).toContain('<title>Core:24 → Gateway:lan</title>');
    });

    it('escapes title text as XML', () => {
      const layout = resolve(
        parse(
          `rack "Rack" 3U\n3 router "Gateway" as gateway\ngateway:wan -- [[Smith & Co <ISP>]]`,
        ),
      );
      const svg = toSvg(layout, { namespace: 'escaped-title' });

      expect(svg).toContain(
        '<title>gateway:wan → Smith &amp; Co &lt;ISP&gt;</title>',
      );
    });

    it('titles routed path connections as well as direct lines', () => {
      const layout = resolve(
        parse(
          `rack "Rack" 3U\n3 switch "Core" as core\n2 router "Gateway" as gateway\ncore:24 -- gateway:lan fibre`,
        ),
      );
      const svg = toSvg(layout, {
        namespace: 'routed-title',
        connectionRouting: 'perimeter',
      });

      expect(svg).toContain('<path ');
      expect(svg).toContain('<title>core:24 → gateway:lan (fibre)</title>');
    });
  });

  it('keeps default bottom annotations from widening the rack subject', () => {
    // Both sides carry a connection so the comparison stays on one side of the
    // routing-envelope activation boundary and isolates the annotation itself.
    const source = `rack "Rack" 3U views front rear\n3 router "Gateway" as gateway\n2 switch "Core" as core\ncore:24 -- gateway:lan`;
    const withoutExternal = toSvg(resolve(parse(source)), {
      namespace: 'without-external',
    });
    const withExternal = toSvg(
      resolve(parse(`${source}\ngateway:wan -- [[ISP Handover]]`)),
      { namespace: 'with-external' },
    );

    const withoutViewport = viewBoxMetrics(withoutExternal);
    const withViewport = viewBoxMetrics(withExternal);

    // The annotation is really rendered, so this is not a comparison of two
    // identical scenes.
    expect(externalRects(withoutExternal)).toHaveLength(0);
    expect(externalRects(withExternal)).toHaveLength(1);
    expect(withExternal).toContain('data-label="ISP Handover"');

    expect(withViewport.x).toBeCloseTo(withoutViewport.x, 3);
    expect(withViewport.width).toBeCloseTo(withoutViewport.width, 3);
    expect(withViewport.height).toBeGreaterThanOrEqual(withoutViewport.height);

    // …and it stays fully visible rather than being clipped by the unchanged
    // horizontal extent.
    expectRectsInsideViewport(withExternal);
  });

  it('supports explicit right-side external placement as a renderer option', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 3U\n3 router "Gateway" as gateway\ngateway:wan -- [[ISP Handover]]`,
      ),
    );
    const bottom = toSvg(layout, {
      namespace: 'bottom-external',
      externalPlacement: 'bottom',
    });
    const right = toSvg(layout, {
      namespace: 'right-external',
      externalPlacement: 'right',
    });

    expect(right).toContain('data-external-placement="right"');
    expect(right).toContain('data-placement="right"');
    expect(bottom).toContain('data-external-placement="bottom"');
    expect(bottom).toContain('data-placement="bottom"');

    // Right placement pushes the external clear of the rack's right edge, well
    // past the reserved routing band, so it still dominates the width.
    expect(viewBoxMetrics(right).width).toBeGreaterThan(
      viewBoxMetrics(bottom).width,
    );

    // Both placements must keep their annotation geometry visible. A single row
    // of bottom externals now fits inside the reserved routing band, so the
    // heights are legitimately equal here; visibility is the real contract.
    expectRectsInsideViewport(right);
    expectRectsInsideViewport(bottom);
  });

  it('includes renderer options in the derived namespace fingerprint', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 3U\n3 router "Gateway" as gateway\ngateway:wan -- [[ISP Handover]]`,
      ),
    );
    const bottom = toSvg(layout);
    const right = toSvg(layout, { externalPlacement: 'right' });

    expect(derivedRootId(bottom)).not.toBe(derivedRootId(right));
    expect(bottom).toBe(toSvg(layout));
    expect(right).toBe(toSvg(layout, { externalPlacement: 'right' }));
  });

  it('keeps multiple external annotations deterministic and in source order', () => {
    const svg = toSvg(
      resolve(
        parse(
          `rack "Rack" 3U\n3 switch "Core" as core\ncore:1 -- [[Building A]]\ncore:2 -- [[Building B]]`,
        ),
      ),
      { namespace: 'external-order' },
    );

    expect(svg.indexOf('data-target="Building A"')).toBeLessThan(
      svg.indexOf('data-target="Building B"'),
    );
  });

  it('abbreviates long visible external labels while preserving the full target', () => {
    const target = 'Very Long External Destination';
    const svg = toSvg(
      resolve(
        parse(
          `rack "Rack" 3U\n3 router "Gateway" as gateway\ngateway:wan -- [[${target}]]`,
        ),
      ),
      { namespace: 'long-external' },
    );

    expect(svg).toContain(`data-target="${target}"`);
    expect(svg).toContain(`<title>${target}</title>`);
    expect(svg).toContain('…</text>');
    expect(svg).not.toContain(`>${target}</text>`);
  });

  it('escapes author-controlled labels, external targets and namespaces', () => {
    const layout = resolve(
      parse(
        `rack "Core & Edge" 2U\n2 switch "<Main & Backup>" as core\ncore:1 -- [[ISP & Edge]]`,
      ),
    );
    const svg = toSvg(layout, { namespace: 'Note A/1' });

    expect(svg).toContain('id="rackdown-Note-A-1-root"');
    expect(svg).toContain('Core &amp; Edge');
    expect(svg).toContain('&lt;Main &amp; Backup&gt;');
    expect(svg).toContain('data-target="ISP &amp; Edge"');
    expect(svg).toContain('<title>ISP &amp; Edge</title>');
    expect(svg).not.toContain('<Main & Backup>');
  });

  it.each([
    ['hello world', 'hello-world'],
    [' \tHello_123\r\n ', 'Hello_123'],
    ['---hello---', 'hello'],
    ['---hello', 'hello'],
    ['hello---', 'hello'],
    ['hello---world', 'hello---world'],
    ['___hello___', '___hello___'],
    ['---', 'diagram'],
    ['   ', 'diagram'],
    ['', 'diagram'],
    ['hello/foo', 'hello-foo'],
    ['hello/!?world', 'hello-world'],
    ['/hello/', 'hello'],
    ['/!?', 'diagram'],
  ])('sanitizes namespace %j to %j', (namespace, expected) => {
    const layout = resolve(parse(`rack "Rack" 1U\n1 switch "Core"`));
    const svg = toSvg(layout, { namespace });

    expect(derivedRootId(svg)).toBe(`rackdown-${expected}-root`);
    expect(svg).toBe(toSvg(layout, { namespace: expected }));
    expect(svg).toBe(toSvg(layout, { namespace }));
  });

  it('preserves a large internal hyphen run deterministically', () => {
    const layout = resolve(parse(`rack "Rack" 1U\n1 switch "Core"`));
    const namespace = `a${'-'.repeat(50_000)}b`;
    const svg = toSvg(layout, { namespace });

    expect(derivedRootId(svg)).toBe(`rackdown-${namespace}-root`);
    expect(svg).toBe(toSvg(layout, { namespace }));
  });

  it('derives a stable namespace when the host does not provide one', () => {
    const layout = resolve(parse(`rack "Rack" 1U\n1 switch "Core"`));

    expect(toSvg(layout)).toBe(toSvg(layout));
    expect(toSvg(layout)).toMatch(/id="rackdown-[a-z0-9]+-root"/);
  });

  it('derives a namespace without relying on locale collation', () => {
    const layout = resolve(parse(`rack "Rack" 1U\n1 switch "Core"`));
    const spy = vi
      .spyOn(String.prototype, 'localeCompare')
      .mockImplementation(() => {
        throw new Error(
          'localeCompare must not be used for derived namespaces',
        );
      });

    try {
      const svg = toSvg(layout, {
        connectionStyles: {
          z: { width: 1 },
          A: { width: 2 },
        },
      });

      expect(svg).toMatch(/id="rackdown-[a-z0-9]+-root"/);
    } finally {
      spy.mockRestore();
    }
  });

  it('renders a useful empty document', () => {
    const svg = toSvg(resolve(parse('')), { namespace: 'empty' });

    expect(svg).toContain('viewBox="0 0 120 40"');
    expect(svg).toContain('>No racks</text>');
  });

  it('never renders a zero-height SVG rectangle for 0U catalogue devices', () => {
    const devices: DeviceIndex = {
      'dell-optiplex-3070-micro': {
        slug: 'dell-optiplex-3070-micro',
        model: 'OptiPlex 3070 Micro',
        uHeight: 0,
      },
    };

    const fallbackSvg = toSvg(
      resolve(
        parse(`rack "Rack" 3U 19in\n2 dell-optiplex-3070-micro "Micro"`),
        devices,
      ),
      { namespace: 'zero-fallback' },
    );
    expect(fallbackSvg).not.toContain('height="0"');
    expect(fallbackSvg).not.toContain('height="0.0"');
    expect(fallbackSvg).toContain('height="44.45"');

    const explicitSvg = toSvg(
      resolve(
        parse(`rack "Rack" 3U 19in\n2 0.5U dell-optiplex-3070-micro "Micro"`),
        devices,
      ),
      { namespace: 'zero-explicit' },
    );
    expect(explicitSvg).not.toContain('height="0"');
    expect(explicitSvg).toContain('height="22.225"');
  });

  describe('special rack item rendering: blank and shelf', () => {
    it('renders unlabeled blank without visible text while preserving accessibility metadata', () => {
      const svg = toSvg(resolve(parse('rack "Rack" 3U 19in\n1 blank')), {
        namespace: 'unlabeled-blank',
      });

      expect(svg).toContain('class="rackdown-device rackdown-blank"');
      expect(svg).toContain('rackdown-blank-group');
      expect(svg).toContain('data-item-role="blank"');
      expect(svg).toContain('<title>blank</title>');
      expect(svg).not.toContain('>blank</text>');
    });

    it('renders quoted blank label with dedicated class and explicit height', () => {
      const svg = toSvg(
        resolve(parse('rack "Rack" 3U 19in\n1 2U blank "Reserved"')),
        { namespace: 'labeled-blank' },
      );

      expect(svg).toContain('class="rackdown-device rackdown-blank"');
      expect(svg).toContain('rackdown-blank-label');
      expect(svg).toContain('>Reserved</text>');
      expect(svg).toContain('<title>Reserved</title>');
      expect(svg).toContain('height="88.9"');
    });

    it('renders unlabeled shelf without visible text while preserving accessibility metadata', () => {
      const svg = toSvg(resolve(parse('rack "Rack" 3U 19in\n2 shelf')), {
        namespace: 'unlabeled-shelf',
      });

      expect(svg).toContain('class="rackdown-device rackdown-shelf"');
      expect(svg).toContain('rackdown-shelf-group');
      expect(svg).toContain('data-item-role="shelf"');
      expect(svg).toContain('<title>shelf</title>');
      expect(svg).not.toContain('>shelf</text>');
    });

    it('renders quoted shelf label with dedicated class', () => {
      const svg = toSvg(
        resolve(parse('rack "Rack" 3U 19in\n2 1U shelf "Micro PCs"')),
        { namespace: 'labeled-shelf' },
      );

      expect(svg).toContain('class="rackdown-device rackdown-shelf"');
      expect(svg).toContain('rackdown-shelf-label');
      expect(svg).toContain('>Micro PCs</text>');
      expect(svg).toContain('<title>Micro PCs</title>');
    });

    it('renders shelf background geometry behind supported devices regardless of source order', () => {
      const shelfFirstSvg = toSvg(
        resolve(
          parse(
            'rack "Rack" 3U 19in\n2 1U shelf\n2 1U device "Micro 01"\n2 1U device "Micro 02"',
          ),
        ),
        { namespace: 'shelf-first' },
      );

      const shelfLastSvg = toSvg(
        resolve(
          parse(
            'rack "Rack" 3U 19in\n2 1U device "Micro 01"\n2 1U device "Micro 02"\n2 1U shelf',
          ),
        ),
        { namespace: 'shelf-last' },
      );

      // In both cases, the shelf rect appears before the device rects in the SVG output
      const shelfFirstShelfIdx = shelfFirstSvg.indexOf('rackdown-shelf');
      const shelfFirstDevIdx = shelfFirstSvg.indexOf('>Micro 01</text>');
      expect(shelfFirstShelfIdx).toBeLessThan(shelfFirstDevIdx);

      const shelfLastShelfIdx = shelfLastSvg.indexOf('rackdown-shelf');
      const shelfLastDevIdx = shelfLastSvg.indexOf('>Micro 01</text>');
      expect(shelfLastShelfIdx).toBeLessThan(shelfLastDevIdx);
    });

    it('produces deterministic SVG for blank and shelf items', () => {
      const layout = resolve(
        parse(
          'rack "Rack" 6U 19in views front rear\n5 2U shelf "Shelved"\n5 2U device "Dev 1"\n5 2U device "Dev 2"\n1 1U blank\nrear 1 1U pdu "Rear PDU"',
        ),
      );

      const first = toSvg(layout, { namespace: 'determ' });
      const second = toSvg(layout, { namespace: 'determ' });

      expect(first).toBe(second);
    });
  });

  describe('standalone SVG sizing and root metrics', () => {
    it('advertises intrinsic width and height attributes matching viewBox dimensions', () => {
      const layout = resolve(parse('rack "Rack" 12U 19in\n10 server "S1"'));
      const svg = toSvg(layout, { namespace: 'sizing' });
      const metrics = viewBoxMetrics(svg);

      const widthMatch = svg.match(/<svg[^>]*\swidth="([^"]+)"/);
      const heightMatch = svg.match(/<svg[^>]*\sheight="([^"]+)"/);

      expect(widthMatch).not.toBeNull();
      expect(heightMatch).not.toBeNull();
      expect(Number(widthMatch?.[1])).toBeCloseTo(metrics.width, 2);
      expect(Number(heightMatch?.[1])).toBeCloseTo(metrics.height, 2);
    });

    it('emits intrinsic width and height on empty diagrams', () => {
      const svg = toSvg(resolve(parse('')), { namespace: 'empty-sizing' });
      expect(svg).toContain('width="120"');
      expect(svg).toContain('height="40"');
      expect(svg).toContain('viewBox="0 0 120 40"');
    });
  });

  describe('rack width rendering contract', () => {
    it('renders 10in and 19in racks with identical diagram geometry while preserving metadata', () => {
      const svg19 = toSvg(
        resolve(parse('rack "Rack 19" 12U 19in\n10 server "S1"')),
        { namespace: 'r19' },
      );
      const svg10 = toSvg(
        resolve(parse('rack "Rack 10" 12U 10in\n10 server "S1"')),
        { namespace: 'r10' },
      );

      expect(svg19).toContain('data-width-inches="19"');
      expect(svg10).toContain('data-width-inches="10"');

      const rackRect19 = svg19.match(
        /<rect class="rackdown-rack"[^>]+width="([^"]+)"[^>]+height="([^"]+)"/,
      );
      const rackRect10 = svg10.match(
        /<rect class="rackdown-rack"[^>]+width="([^"]+)"[^>]+height="([^"]+)"/,
      );

      expect(rackRect19).not.toBeNull();
      expect(rackRect10).not.toBeNull();
      expect(rackRect19?.[1]).toBe(rackRect10?.[1]);
      expect(rackRect19?.[2]).toBe(rackRect10?.[2]);

      const metrics19 = viewBoxMetrics(svg19);
      const metrics10 = viewBoxMetrics(svg10);
      expect(metrics19.width).toBeCloseTo(metrics10.width, 2);
      expect(metrics19.height).toBeCloseTo(metrics10.height, 2);
    });
  });

  describe('multi-projection layout and wrapping', () => {
    it('arranges front and rear projections side-by-side in one row', () => {
      const layout = resolve(
        parse('rack "Rack" 12U views front rear\n10 server "S1"'),
      );
      const svg = toSvg(layout, { namespace: 'single-rack-views' });

      const frontGroup = svg.match(
        /<g id="[^"]+" class="[^"]*rackdown-rack-front[^"]*"[^>]*>/,
      );
      const rearGroup = svg.match(
        /<g id="[^"]+" class="[^"]*rackdown-rack-rear[^"]*"[^>]*>/,
      );
      expect(frontGroup).not.toBeNull();
      expect(rearGroup).not.toBeNull();

      const frontRect = svg.match(
        /<g[^>]+class="[^"]*rackdown-rack-front[^"]*"[^>]*>[\s\S]*?<rect class="rackdown-rack"[^>]+x="([^"]+)"[^>]+y="([^"]+)"/,
      );
      const rearRect = svg.match(
        /<g[^>]+class="[^"]*rackdown-rack-rear[^"]*"[^>]*>[\s\S]*?<rect class="rackdown-rack"[^>]+x="([^"]+)"[^>]+y="([^"]+)"/,
      );

      expect(frontRect).not.toBeNull();
      expect(rearRect).not.toBeNull();
      expect(Number(frontRect?.[2])).toBe(0);
      expect(Number(rearRect?.[2])).toBe(0);
      expect(Number(rearRect?.[1])).toBeGreaterThan(Number(frontRect?.[1]));
    });

    it('wraps multiple racks to bounded rows of at most 2 projections', () => {
      const source = `rack "Primary" 12U views front rear\n10 server "S1"\nrack "Garage" 6U\n5 switch "G1"`;
      const layout = resolve(parse(source));
      const svg = toSvg(layout, { namespace: 'multi-rack-wrap' });

      const primaryFront = svg.match(
        /<g id="rackdown-multi-rack-wrap-rack-view-1"[^>]*>[\s\S]*?<rect class="rackdown-rack" x="([^"]+)" y="([^"]+)"/,
      );
      const primaryRear = svg.match(
        /<g id="rackdown-multi-rack-wrap-rack-view-2"[^>]*>[\s\S]*?<rect class="rackdown-rack" x="([^"]+)" y="([^"]+)"/,
      );
      const garageFront = svg.match(
        /<g id="rackdown-multi-rack-wrap-rack-view-3"[^>]*>[\s\S]*?<rect class="rackdown-rack" x="([^"]+)" y="([^"]+)"/,
      );

      expect(primaryFront).not.toBeNull();
      expect(primaryRear).not.toBeNull();
      expect(garageFront).not.toBeNull();

      expect(Number(primaryFront?.[2])).toBe(0);
      expect(Number(primaryRear?.[2])).toBe(0);
      expect(Number(garageFront?.[2])).toBeGreaterThan(0);
      expect(Number(garageFront?.[1])).toBe(0);
    });

    it('wraps a two-view rack at the row boundary without splitting its views', () => {
      // A single-view rack fills one of the two row slots, so the following
      // two-view rack cannot fit and wraps as a whole. Both of its views must
      // still land side-by-side on the same new row.
      const source = `rack "Solo" 6U\n5 switch "G1"\nrack "Pair" 12U views front rear\n10 server "S1"`;
      const layout = resolve(parse(source));
      const svg = toSvg(layout, { namespace: 'row-boundary' });

      const rectFor = (index: number) =>
        svg.match(
          new RegExp(
            `<g id="rackdown-row-boundary-rack-view-${index}"[^>]*>[\\s\\S]*?<rect class="rackdown-rack" x="([^"]+)" y="([^"]+)"`,
          ),
        );

      const solo = rectFor(1);
      const pairFront = rectFor(2);
      const pairRear = rectFor(3);

      expect(solo).not.toBeNull();
      expect(pairFront).not.toBeNull();
      expect(pairRear).not.toBeNull();

      // Row 1 holds the solo rack at the origin.
      expect(Number(solo?.[1])).toBe(0);
      expect(Number(solo?.[2])).toBe(0);

      // Row 2 holds both projections of the two-view rack, at one shared y.
      const rowTwoY = Number(pairFront?.[2]);
      expect(rowTwoY).toBeGreaterThan(0);
      expect(Number(pairRear?.[2])).toBe(rowTwoY);

      // The wrapped rack restarts the row, so its front view is at x = 0 and
      // its rear view follows it in the same row.
      expect(Number(pairFront?.[1])).toBe(0);
      expect(Number(pairRear?.[1])).toBeGreaterThan(Number(pairFront?.[1]));
    });

    it('wraps a caller-constructed rack carrying more than two views', () => {
      // `LayoutRack.views` is a plain `RackFace[]` with no maximum length, and
      // `toSvg` accepts any caller-constructed `RackLayout`, so a rack may
      // carry more projections than one row holds. Repeated faces are what the
      // public type permits; the per-face wrap guard must still bound the row.
      const layout = resolve(parse('rack "Wide" 6U\n3 server "S1"'));
      const rack = layout.racks[0];
      expect(rack).toBeDefined();
      if (!rack) {
        throw new Error('expected a resolved rack');
      }
      rack.views = ['front', 'rear', 'front'];

      const svg = toSvg(layout, { namespace: 'over-capacity' });

      const rectFor = (index: number) =>
        svg.match(
          new RegExp(
            `<g id="rackdown-over-capacity-rack-view-${index}"[^>]*>[\\s\\S]*?<rect class="rackdown-rack" x="([^"]+)" y="([^"]+)"`,
          ),
        );

      const first = rectFor(1);
      const second = rectFor(2);
      const third = rectFor(3);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(third).not.toBeNull();

      // The first two projections fill the row's two slots.
      expect(Number(first?.[1])).toBe(0);
      expect(Number(first?.[2])).toBe(0);
      expect(Number(second?.[2])).toBe(0);
      expect(Number(second?.[1])).toBeGreaterThan(Number(first?.[1]));

      // The third exceeds row capacity and must wrap to a fresh row.
      expect(Number(third?.[2])).toBeGreaterThan(0);
      expect(Number(third?.[1])).toBe(0);
    });

    it('preserves deterministic output across multi-row multi-rack diagrams', () => {
      const source = `rack "A" 12U views front rear\n10 server "S1"\nrack "B" 6U\n5 switch "SW1"\nrack "C" 8U\n4 patch "P1"`;
      const layout = resolve(parse(source));
      const first = toSvg(layout, { namespace: 'multi-determ' });
      const second = toSvg(layout, { namespace: 'multi-determ' });
      expect(first).toBe(second);
    });
  });

  describe('device label containment and truncation', () => {
    it('attaches clipPath to every device group and references it in device label text', () => {
      const layout = resolve(parse('rack "Rack" 12U\n10 server "Short Label"'));
      const svg = toSvg(layout, { namespace: 'containment' });

      expect(svg).toContain(
        '<clipPath id="rackdown-containment-device-1-clip">',
      );
      expect(svg).toContain(
        'clip-path="url(#rackdown-containment-device-1-clip)"',
      );
      expect(svg).toContain('>Short Label</text>');
      expect(svg).toContain('<title>Short Label</title>');
    });

    it('truncates excessively long device labels with an ellipsis while preserving model and title', () => {
      const longLabel =
        'Extremely Long Device Name That Would Otherwise Spill Over Neighbouring Geometry Without Containment';
      const layout = resolve(
        parse(`rack "Rack" 12U\n10 server "${longLabel}"`),
      );
      const svg = toSvg(layout, { namespace: 'long-label' });

      expect(layout.devices[0]?.label).toBe(longLabel);
      expect(svg).toContain(`<title>${longLabel}</title>`);
      expect(svg).toContain(
        'clip-path="url(#rackdown-long-label-device-1-clip)"',
      );
      expect(svg).toContain('…</text>');
      expect(svg).not.toContain(`>${longLabel}</text>`);
    });

    it('contains long labels in narrow shared-row devices proportionally', () => {
      const labelA = 'Alpha Management Gateway Server';
      const labelB = 'Beta Secondary Distribution Switch';
      const layout = resolve(
        parse(`rack "Rack" 12U\n10 server "${labelA}"\n10 switch "${labelB}"`),
      );
      const svg = toSvg(layout, { namespace: 'shared-containment' });

      expect(svg).toContain(
        'clip-path="url(#rackdown-shared-containment-device-1-clip)"',
      );
      expect(svg).toContain(
        'clip-path="url(#rackdown-shared-containment-device-2-clip)"',
      );
      expect(svg).toContain(`<title>${labelA}</title>`);
      expect(svg).toContain(`<title>${labelB}</title>`);
      expect(layout.devices[0]?.label).toBe(labelA);
      expect(layout.devices[1]?.label).toBe(labelB);
    });

    it('dogfoods a 10in rack with long labels and front/rear projections', () => {
      const source =
        'rack "Compact Lab" 10U 10in views front rear\n10 router "Main Edge Gateway Security Appliance" as gw\n8 switch "Primary Enterprise Distribution Core Switch" as sw\nrear 4 pdu "Rear Vertical Power Distribution Unit" as pdu\ngw:lan -- sw:uplink\nsw:p1 -- pdu:1';
      const layout = resolve(parse(source));
      const firstSvg = toSvg(layout, { namespace: 'dogfood-10in' });
      const secondSvg = toSvg(layout, { namespace: 'dogfood-10in' });

      expect(firstSvg).toBe(secondSvg);
      expect(layout.racks[0]?.widthInches).toBe(10);
      expect(firstSvg).toContain('data-width-inches="10"');

      const metrics = viewBoxMetrics(firstSvg);
      expect(firstSvg).toContain(`width="${metrics.width}"`);
      expect(firstSvg).toContain(`height="${metrics.height}"`);

      expect(firstSvg).toContain('rackdown-rack-front');
      expect(firstSvg).toContain('rackdown-rack-rear');

      expect(firstSvg).toContain(
        'clip-path="url(#rackdown-dogfood-10in-device-1-clip)"',
      );
      expect(firstSvg).toContain(
        'clip-path="url(#rackdown-dogfood-10in-device-2-clip)"',
      );
      expect(firstSvg).toContain(
        'clip-path="url(#rackdown-dogfood-10in-device-3-clip)"',
      );

      expect(firstSvg).toContain(
        '<title>Main Edge Gateway Security Appliance</title>',
      );
      expect(firstSvg).toContain(
        '<title>Primary Enterprise Distribution Core Switch</title>',
      );
      expect(firstSvg).toContain('rackdown-connection');
    });
  });
  describe('standalone colour-scheme fallbacks', () => {
    const styleOnly = () =>
      svgStyleBlock(
        toSvg(
          resolve(
            parse(
              'rack "Comms Rack" 3U\n3 switch "Core" as core\n2 blank "Spare"\n1 shelf "Tray"\ncore:1 -- [[Uplink]]',
            ),
          ),
          { namespace: 'scheme' },
        ),
      );

    it('emits a dark colour-scheme block in the standalone stylesheet', () => {
      expect(styleOnly()).toContain(DARK_MEDIA_QUERY);
    });

    it('declares no RackDown custom properties and no :root rule', () => {
      const style = styleOnly();
      const withoutVarReferences = style.replaceAll(
        /var\(\s*--rackdown-[a-z-]+/g,
        'var(',
      );

      expect(withoutVarReferences).not.toContain('--rackdown-');
      expect(style).not.toContain(':root');
      expect(style).not.toContain('!important');
    });

    it('gives every colour-bearing selector a dark literal fallback', () => {
      const dark = darkSchemeBlock(styleOnly());

      expect(dark).toContain('fill: var(--rackdown-rack-fill, #1e293b)');
      expect(dark).toContain('stroke: var(--rackdown-rack-stroke, #94a3b8)');
      expect(dark).toContain('stroke: var(--rackdown-u-line, #64748b)');
      expect(dark).toContain('fill: var(--rackdown-text, #e2e8f0)');
      expect(dark).toContain('fill: var(--rackdown-muted-text, #cbd5e1)');
      expect(dark).toContain('fill: var(--rackdown-device-fill, #334155)');
      expect(dark).toContain('stroke: var(--rackdown-device-stroke, #cbd5e1)');
      expect(dark).toContain('fill: var(--rackdown-blank-fill, #475569)');
      expect(dark).toContain('stroke: var(--rackdown-blank-stroke, #94a3b8)');
      expect(dark).toContain('fill: var(--rackdown-shelf-fill, #293548)');
      expect(dark).toContain('stroke: var(--rackdown-shelf-stroke, #94a3b8)');
      expect(dark).toContain('fill: var(--rackdown-external-fill, #0f172a)');
      expect(dark).toContain(
        'stroke: var(--rackdown-external-stroke, #94a3b8)',
      );
    });

    it('keeps the monochrome connection override at zero specificity in dark', () => {
      const dark = darkSchemeBlock(styleOnly());

      expect(dark).toContain(
        ':where(.rackdown-connection[data-colour-source="monochrome"]) { stroke: var(--rackdown-connection-stroke, #94a3b8); }',
      );
    });

    it('leaves the light fallback palette untouched', () => {
      const light = lightSchemeSection(styleOnly());

      expect(light).toContain('fill: var(--rackdown-rack-fill, #f8fafc)');
      expect(light).toContain('stroke: var(--rackdown-rack-stroke, #475569)');
      expect(light).toContain('stroke: var(--rackdown-u-line, #cbd5e1)');
      expect(light).toContain('fill: var(--rackdown-text, #0f172a)');
      expect(light).toContain('fill: var(--rackdown-muted-text, #64748b)');
      expect(light).toContain('fill: var(--rackdown-device-fill, #e2e8f0)');
      expect(light).toContain('stroke: var(--rackdown-device-stroke, #334155)');
      expect(light).toContain('fill: var(--rackdown-blank-fill, #cbd5e1)');
      expect(light).toContain('fill: var(--rackdown-shelf-fill, #f1f5f9)');
      expect(light).toContain('fill: var(--rackdown-external-fill, #ffffff)');
      expect(light).toContain(
        'stroke: var(--rackdown-connection-stroke, #64748b)',
      );
    });

    it('leaves automatic connection colours as resolved presentation attributes', () => {
      const svg = toSvg(
        resolve(
          parse(
            'rack "Comms Rack" 3U\n3 switch "Core" as core\ncore:1 -- [[Uplink]]',
          ),
        ),
        { namespace: 'scheme-auto' },
      );

      const connection = svg.match(
        /<(?:line|path)[^>]*class="rackdown-connection[^"]*"[^>]*>/,
      )?.[0];

      expect(connection).toBeDefined();
      expect(connection).toContain('data-colour-source="auto"');
      expect(connection).toMatch(/ stroke="#[0-9a-f]{6}"/i);
      expect(darkSchemeBlock(svgStyleBlock(svg))).not.toMatch(
        /--rackdown-connection-stroke, #(?!94a3b8)/,
      );
    });
  });
  describe('host theme custom properties', () => {
    const styleOnly = () =>
      svgStyleBlock(
        toSvg(
          resolve(
            parse(
              'rack "Comms Rack" 3U\n3 switch "Core" as core\n2 blank "Spare"\n1 shelf "Tray"\ncore:1 -- [[Uplink]]',
            ),
          ),
          { namespace: 'theme' },
        ),
      );

    it('routes the shared font stack through --rackdown-font', () => {
      expect(lightSchemeSection(styleOnly())).toContain(
        'font-family: var(--rackdown-font, ui-sans-serif, system-ui, sans-serif)',
      );
    });

    it('themes titles and U labels independently of ordinary labels', () => {
      const light = lightSchemeSection(styleOnly());

      expect(light).toContain(
        '.rackdown-rack-title { font-size: var(--rackdown-title-size, 14px);',
      );
      expect(light).toContain(
        '.rackdown-u-label { font-size: var(--rackdown-u-label-size, 8.5px); }',
      );
    });

    it('shares --rackdown-label-size across device labels and empty text', () => {
      const light = lightSchemeSection(styleOnly());

      expect(light).toContain(
        '.rackdown-device-label { font-size: var(--rackdown-label-size, 12px);',
      );
      expect(light).toContain(
        '.rackdown-device-label-compact { font-size: var(--rackdown-label-size, 9px); }',
      );
      expect(light).not.toContain('.rackdown-external-label { font-size:');
      expect(light).toContain(
        '.rackdown-empty { font-size: var(--rackdown-label-size, 10px); }',
      );
    });

    it('themes structural strokes through --rackdown-stroke-width with per-selector defaults', () => {
      const light = lightSchemeSection(styleOnly());
      const structural = light.match(
        /stroke-width: var\(--rackdown-stroke-width, [^)]+\)/g,
      );

      expect(light).toContain(
        'stroke-width: var(--rackdown-stroke-width, 0.5)',
      );
      expect(structural).toHaveLength(4);
      expect(
        structural?.filter(
          (rule) => rule === 'stroke-width: var(--rackdown-stroke-width, 1)',
        ),
      ).toHaveLength(3);
    });

    it('leaves no hardcoded typography or structural stroke literals behind', () => {
      const light = lightSchemeSection(styleOnly());

      expect(light).not.toMatch(/font-size: \d/);
      expect(light).not.toMatch(/font-family: ui-sans-serif/);
      expect(light).not.toMatch(/stroke-width: \d/);
    });

    it('introduces no connection colour custom property', () => {
      expect(styleOnly()).not.toContain('--rackdown-connection-color');
      expect(styleOnly()).not.toContain('--rackdown-connection-colour');
    });
  });

  describe('embedded stylesheet theme option', () => {
    const SOURCE =
      'rack "Comms Rack" 3U\n3 switch "Core" as core\n2 blank "Spare"\n1 shelf "Tray"\ncore:1 -- [[Uplink]]';
    const themedLayout = () => resolve(parse(SOURCE));

    it('treats an omitted theme as auto', () => {
      const layout = themedLayout();

      expect(toSvg(layout, { namespace: 'theme-mode' })).toBe(
        toSvg(layout, { namespace: 'theme-mode', theme: 'auto' }),
      );
      expect(toSvg(layout)).toBe(toSvg(layout, { theme: 'auto' }));
    });

    it('keeps auto on the current light plus dark-media stylesheet', () => {
      const style = svgStyleBlock(
        toSvg(themedLayout(), { namespace: 'theme-auto', theme: 'auto' }),
      );

      expect(style).toContain(DARK_MEDIA_QUERY);
      expect(lightSchemeSection(style)).toContain(
        'fill: var(--rackdown-rack-fill, #f8fafc)',
      );
      expect(darkSchemeBlock(style)).toContain(
        'fill: var(--rackdown-rack-fill, #1e293b)',
      );
    });

    it('forces the light fallback scheme without a colour-scheme media query', () => {
      const svg = toSvg(themedLayout(), {
        namespace: 'theme-light',
        theme: 'light',
      });
      const style = svgStyleBlock(svg);

      expect(svg.match(/<style>/g)).toHaveLength(1);
      expect(style).not.toContain('prefers-color-scheme');
      expect(style).toContain('fill: var(--rackdown-rack-fill, #f8fafc)');
      expect(style).toContain('fill: var(--rackdown-device-fill, #e2e8f0)');
      expect(style).toContain('fill: var(--rackdown-external-fill, #ffffff)');
      expect(style).toContain(
        'stroke: var(--rackdown-connection-stroke, #64748b)',
      );
      expect(style).toContain(
        'font-family: var(--rackdown-font, ui-sans-serif, system-ui, sans-serif)',
      );
      expect(style).toContain('font-size: var(--rackdown-title-size, 14px)');
      expect(style).toContain('stroke-width: var(--rackdown-stroke-width, 1)');
      expect(style).toContain(
        'stroke-width: var(--rackdown-connection-width, 2)',
      );
      // Dark-only literals; values shared with the light palette are excluded.
      expect(style).not.toContain('#1e293b');
      expect(style).not.toContain('#293548');
    });

    it('forces the dark fallback scheme without a colour-scheme media query', () => {
      const svg = toSvg(themedLayout(), {
        namespace: 'theme-dark',
        theme: 'dark',
      });
      const style = svgStyleBlock(svg);

      expect(svg.match(/<style>/g)).toHaveLength(1);
      expect(style).not.toContain('prefers-color-scheme');
      expect(style).toContain('fill: var(--rackdown-rack-fill, #1e293b)');
      expect(style).toContain('fill: var(--rackdown-device-fill, #334155)');
      expect(style).toContain('fill: var(--rackdown-external-fill, #0f172a)');
      expect(style).toContain('fill: var(--rackdown-text, #e2e8f0)');
      expect(style).toContain(
        'font-family: var(--rackdown-font, ui-sans-serif, system-ui, sans-serif)',
      );
      expect(style).toContain('font-size: var(--rackdown-title-size, 14px)');
      expect(style).toContain('stroke-width: var(--rackdown-stroke-width, 1)');
      expect(style).toContain(
        'stroke-width: var(--rackdown-connection-width, 2)',
      );
    });

    it('lets the appended dark rules win the cascade over the light fallbacks', () => {
      const style = svgStyleBlock(
        toSvg(themedLayout(), { namespace: 'theme-dark-order', theme: 'dark' }),
      );

      expect(
        style.indexOf('fill: var(--rackdown-rack-fill, #1e293b)'),
      ).toBeGreaterThan(
        style.indexOf('fill: var(--rackdown-rack-fill, #f8fafc)'),
      );
      expect(
        style.lastIndexOf('--rackdown-connection-stroke, #94a3b8'),
      ).toBeGreaterThan(
        style.lastIndexOf('--rackdown-connection-stroke, #64748b'),
      );
    });

    it('emits no embedded stylesheet at all for theme none', () => {
      const svg = toSvg(themedLayout(), {
        namespace: 'theme-none',
        theme: 'none',
      });

      expect(svg).not.toContain('<style');
      expect(svg).not.toContain('</style>');
      expect(svg).not.toContain('--rackdown-');
      expect(svg).not.toContain('prefers-color-scheme');
      expect(svg).not.toContain(' style="');
    });

    it('keeps semantic and geometric output intact for theme none', () => {
      const svg = toSvg(themedLayout(), {
        namespace: 'theme-none-semantics',
        theme: 'none',
      });

      expect(svg).toContain('<svg id="rackdown-theme-none-semantics-root"');
      expect(svg).toContain('role="img"');
      expect(svg).toContain(
        'aria-labelledby="rackdown-theme-none-semantics-title"',
      );
      expect(svg).toContain(
        'aria-describedby="rackdown-theme-none-semantics-desc"',
      );
      expect(svg).toContain('<title id="rackdown-theme-none-semantics-title">');
      expect(svg).toContain('class="rackdown-rack"');
      expect(svg).toContain('class="rackdown-connection');
      expect(svg).toContain('data-u="3"');
      expect(svg).toContain('viewBox="');
      expect(svg).toMatch(/ stroke="#[0-9a-f]{6}"/i);
      expect(viewBoxMetrics(svg)).toEqual(
        viewBoxMetrics(
          toSvg(themedLayout(), { namespace: 'theme-none-semantics' }),
        ),
      );
    });

    it('differs from auto output only by the embedded stylesheet', () => {
      const layout = themedLayout();
      const auto = toSvg(layout, { namespace: 'theme-diff' });
      const none = toSvg(layout, { namespace: 'theme-diff', theme: 'none' });
      const autoWithoutStyle = auto.replace(
        /\n {2}<style>[\s\S]*?<\/style>/,
        '',
      );

      expect(none).toBe(autoWithoutStyle);
    });

    it('preserves portable connection visual intent under theme none', () => {
      const connection = toSvg(
        resolve(
          parse(
            'rack "Comms Rack" 3U\n3 switch "Core" as core\ncore:1 -- [[Uplink]]',
          ),
        ),
        {
          namespace: 'theme-none-style',
          theme: 'none',
          connectionStyle: {
            color: '#ff00aa',
            width: 3.5,
            pattern: 'dotted',
            opacity: 0.4,
          },
        },
      ).match(/<(?:line|path)[^>]*class="rackdown-connection[^"]*"[^>]*>/)?.[0];

      expect(connection).toBeDefined();
      expect(connection).toContain('stroke="#ff00aa"');
      expect(connection).toContain('stroke-width="3.5"');
      expect(connection).toContain('stroke-opacity="0.4"');
      expect(connection).toContain('stroke-dasharray="1 4"');
      expect(connection).toContain('data-pattern="dotted"');
      expect(connection).toContain('data-colour-source="explicit"');
    });

    it('resolves monochrome connections through the forced dark fallback rule', () => {
      const svg = toSvg(themedLayout(), {
        namespace: 'theme-dark-mono',
        theme: 'dark',
        connectionColourMode: 'monochrome',
      });
      const style = svgStyleBlock(svg);
      const connection = svg.match(
        /<(?:line|path)[^>]*class="rackdown-connection[^"]*"[^>]*>/,
      )?.[0];

      expect(style).toContain(
        ':where(.rackdown-connection[data-colour-source="monochrome"]) { stroke: var(--rackdown-connection-stroke, #94a3b8); }',
      );
      expect(style).not.toContain('prefers-color-scheme');
      expect(connection).toContain('data-colour-source="monochrome"');
      expect(connection).not.toContain(' stroke="');
    });

    it('adds no replacement monochrome rule or stroke when the stylesheet is omitted', () => {
      const svg = toSvg(themedLayout(), {
        namespace: 'theme-none-mono',
        theme: 'none',
        connectionColourMode: 'monochrome',
      });
      const connection = svg.match(
        /<(?:line|path)[^>]*class="rackdown-connection[^"]*"[^>]*>/,
      )?.[0];

      expect(svg).not.toContain('<style');
      expect(svg).not.toContain('--rackdown-connection-stroke');
      expect(connection).toContain('data-colour-source="monochrome"');
      expect(connection).not.toContain(' stroke="');
    });

    it('derives a distinct namespace for each non-default theme', () => {
      const layout = themedLayout();
      const ids = {
        omitted: derivedRootId(toSvg(layout)),
        auto: derivedRootId(toSvg(layout, { theme: 'auto' })),
        light: derivedRootId(toSvg(layout, { theme: 'light' })),
        dark: derivedRootId(toSvg(layout, { theme: 'dark' })),
        none: derivedRootId(toSvg(layout, { theme: 'none' })),
      };

      expect(ids.omitted).toBe(ids.auto);
      expect(new Set([ids.auto, ids.light, ids.dark, ids.none]).size).toBe(4);
    });

    it('keeps an explicit host namespace independent of the theme', () => {
      const layout = themedLayout();

      for (const theme of ['auto', 'light', 'dark', 'none'] as const) {
        expect(
          derivedRootId(toSvg(layout, { namespace: 'fixed', theme })),
        ).toBe('rackdown-fixed-root');
      }
    });
  });

  describe('SVG sizing and accessibility', () => {
    function sampleLayout() {
      return resolve(
        parse(
          'rack "Comms Rack" 3U 19in u1 bottom\n3 switch "Core" as core\n2 patch "Patch" as patch\ncore:1 -- patch:1 "Cat6"',
        ),
      );
    }

    function rootSvgTag(svg: string): string {
      const match = svg.match(/<svg\b[^>]*>/);
      if (!match?.[0]) {
        throw new Error('SVG is missing a root <svg> tag');
      }
      return match[0];
    }

    describe('sizing: default and pixels', () => {
      it('produces byte-identical SVG for omitted sizing and explicit pixels', () => {
        const layout = sampleLayout();
        const omitted = toSvg(layout);
        const explicitPixels = toSvg(layout, { sizing: 'pixels' });
        expect(omitted).toBe(explicitPixels);
      });

      it('emits unitless numeric root width and height for pixels mode', () => {
        const layout = sampleLayout();
        const root = rootSvgTag(toSvg(layout, { sizing: 'pixels' }));
        expect(root).toMatch(/\bwidth="\d+(\.\d+)?"/);
        expect(root).toMatch(/\bheight="\d+(\.\d+)?"/);
        expect(root).not.toMatch(/\bwidth="\d+(\.\d+)?mm"/);
        expect(root).not.toMatch(/\bheight="\d+(\.\d+)?mm"/);
        expect(root).not.toContain('data-sizing');
      });

      it('preserves existing viewBox in pixels mode', () => {
        const layout = sampleLayout();
        const metricsDefault = viewBoxMetrics(toSvg(layout));
        const metricsPixels = viewBoxMetrics(
          toSvg(layout, { sizing: 'pixels' }),
        );
        expect(metricsDefault).toEqual(metricsPixels);
        expect(metricsPixels.width).toBeGreaterThan(0);
        expect(metricsPixels.height).toBeGreaterThan(0);
      });
    });

    describe('sizing: physical', () => {
      it('appends mm suffix to root width and height matching pixels values', () => {
        const layout = sampleLayout();
        const pixelsSvg = toSvg(layout, {
          namespace: 'fixed',
          sizing: 'pixels',
        });
        const physicalSvg = toSvg(layout, {
          namespace: 'fixed',
          sizing: 'physical',
        });
        const pixelsRoot = rootSvgTag(pixelsSvg);
        const physicalRoot = rootSvgTag(physicalSvg);

        const pixelsWidth = pixelsRoot.match(/\bwidth="([^"]+)"/)?.[1];
        const pixelsHeight = pixelsRoot.match(/\bheight="([^"]+)"/)?.[1];
        expect(pixelsWidth).toBeDefined();
        expect(pixelsHeight).toBeDefined();

        expect(physicalRoot).toContain(`width="${pixelsWidth}mm"`);
        expect(physicalRoot).toContain(`height="${pixelsHeight}mm"`);
      });

      it('preserves viewBox and does not rescale internal geometry', () => {
        const layout = sampleLayout();
        const pixelsSvg = toSvg(layout, {
          namespace: 'fixed',
          sizing: 'pixels',
        });
        const physicalSvg = toSvg(layout, {
          namespace: 'fixed',
          sizing: 'physical',
        });

        expect(viewBoxMetrics(physicalSvg)).toEqual(viewBoxMetrics(pixelsSvg));

        const stripRoot = (svg: string) => svg.slice(svg.indexOf('>') + 1);
        expect(stripRoot(physicalSvg)).toBe(stripRoot(pixelsSvg));
      });
    });

    describe('sizing: responsive', () => {
      it('omits width and height attributes from the root opening tag', () => {
        const layout = sampleLayout();
        const responsiveSvg = toSvg(layout, { sizing: 'responsive' });
        const root = rootSvgTag(responsiveSvg);

        expect(root).not.toMatch(/\bwidth=/);
        expect(root).not.toMatch(/\bheight=/);
      });

      it('preserves viewBox while inner elements retain their own dimensions', () => {
        const layout = sampleLayout();
        const defaultSvg = toSvg(layout, { namespace: 'fixed' });
        const responsiveSvg = toSvg(layout, {
          namespace: 'fixed',
          sizing: 'responsive',
        });

        expect(viewBoxMetrics(responsiveSvg)).toEqual(
          viewBoxMetrics(defaultSvg),
        );
        expect(responsiveSvg).toContain('<rect');
        expect(responsiveSvg).toMatch(/<rect[^>]*\bwidth=/);
        expect(responsiveSvg).toMatch(/<rect[^>]*\bheight=/);
      });
    });

    describe('sizing and namespace', () => {
      it('derives the same namespace for omitted sizing and explicit pixels', () => {
        const layout = sampleLayout();
        const omittedId = derivedRootId(toSvg(layout));
        const pixelsId = derivedRootId(toSvg(layout, { sizing: 'pixels' }));
        expect(omittedId).toBe(pixelsId);
      });

      it('derives distinct namespaces for physical and responsive modes', () => {
        const layout = sampleLayout();
        const defaultId = derivedRootId(toSvg(layout));
        const physicalId = derivedRootId(toSvg(layout, { sizing: 'physical' }));
        const responsiveId = derivedRootId(
          toSvg(layout, { sizing: 'responsive' }),
        );

        expect(physicalId).not.toBe(defaultId);
        expect(responsiveId).not.toBe(defaultId);
        expect(physicalId).not.toBe(responsiveId);
        expect(new Set([defaultId, physicalId, responsiveId]).size).toBe(3);
      });

      it('keeps an explicit namespace unchanged across all sizing modes', () => {
        const layout = sampleLayout();
        for (const sizing of ['pixels', 'physical', 'responsive'] as const) {
          expect(
            derivedRootId(toSvg(layout, { namespace: 'explicit-ns', sizing })),
          ).toBe('rackdown-explicit-ns-root');
        }
      });
    });

    describe('root accessibility description', () => {
      it('places title as first child and desc as second child with matching aria attributes', () => {
        const layout = sampleLayout();
        const svg = toSvg(layout, { namespace: 'a11y' });
        const root = rootSvgTag(svg);

        expect(root).toContain('role="img"');
        expect(root).toContain('aria-labelledby="rackdown-a11y-title"');
        expect(root).toContain('aria-describedby="rackdown-a11y-desc"');
        expect(root).not.toContain(
          'aria-labelledby="rackdown-a11y-title rackdown-a11y-desc"',
        );

        const lines = svg.split('\n');
        expect(lines[0]).toContain('<svg id="rackdown-a11y-root"');
        expect(lines[1]).toBe(
          '  <title id="rackdown-a11y-title">Comms Rack rack diagram</title>',
        );
        expect(lines[2]).toBe(
          '  <desc id="rackdown-a11y-desc">1 rack, 2 devices, 1 connection.</desc>',
        );
      });

      it('formats summary counts with correct singular and plural forms', () => {
        const single = resolve(
          parse('rack "Single" 1U\n1 switch "Sw" as sw\nsw:1 -- [[Ext]]'),
        );
        const singleSvg = toSvg(single, { namespace: 'single' });
        expect(singleSvg).toContain(
          '<desc id="rackdown-single-desc">1 rack, 1 device, 1 connection.</desc>',
        );

        const multiple = resolve(
          parse(
            'rack "Rack A" 2U\n2 switch "Sw1" as s1\n1 switch "Sw2" as s2\n' +
              'rack "Rack B" 2U\n2 switch "Sw3" as s3\n' +
              's1:1 -- s2:1\ns1:2 -- s3:1',
          ),
        );
        const multipleSvg = toSvg(multiple, { namespace: 'multi' });
        expect(multipleSvg).toContain(
          '<desc id="rackdown-multi-desc">2 racks, 3 devices, 2 connections.</desc>',
        );
      });

      it('counts a front and rear projection as one physical rack', () => {
        const layout = resolve(
          parse(
            'rack "Comms Rack" 3U views front rear\n3 switch "Front Dev"\nrear 2 pdu "Rear Dev"',
          ),
        );
        const svg = toSvg(layout, { namespace: 'two-views' });
        expect(svg).toContain(
          '<desc id="rackdown-two-views-desc">1 rack, 2 devices, 0 connections.</desc>',
        );
      });

      it('counts only devices and connections rendered in the projected scene', () => {
        const layout = resolve(
          parse(
            'rack "Rack" 3U views rear\n3 switch "Front Device" as core\nrear 2 pdu "Rear Device" as pdu\ncore:1 -- [[Hidden Front Link]]\npdu:1 -- [[Visible Rear Link]]',
          ),
        );
        const svg = toSvg(layout, { namespace: 'rear-only-scene' });
        expect(svg).toContain(
          '<desc id="rackdown-rear-only-scene-desc">1 rack, 1 device, 1 connection.</desc>',
        );
      });

      it('provides a stable zero-count description for empty output', () => {
        const layout = resolve(parse(''));
        const svg = toSvg(layout, { namespace: 'empty' });
        expect(svg).toContain(
          '<desc id="rackdown-empty-desc">0 racks, 0 devices, 0 connections.</desc>',
        );
      });

      it('preserves existing connection-level title elements unchanged', () => {
        const layout = sampleLayout();
        const svg = toSvg(layout, { namespace: 'conn-title' });
        expect(svg).toContain(
          '<title>core:1 → patch:1 (&quot;Cat6&quot;)</title>',
        );
      });
    });

    describe('sizing and theme composition', () => {
      it('preserves both contracts under responsive sizing and theme none', () => {
        const layout = sampleLayout();
        const svg = toSvg(layout, {
          namespace: 'resp-none',
          sizing: 'responsive',
          theme: 'none',
        });
        const root = rootSvgTag(svg);

        expect(root).not.toMatch(/\bwidth=/);
        expect(root).not.toMatch(/\bheight=/);
        expect(root).toContain('viewBox="');
        expect(root).toContain('aria-labelledby="rackdown-resp-none-title"');
        expect(root).toContain('aria-describedby="rackdown-resp-none-desc"');
        expect(svg).not.toContain('<style');
        expect(svg).toContain('<title id="rackdown-resp-none-title">');
        expect(svg).toContain('<desc id="rackdown-resp-none-desc">');
      });

      it('preserves both contracts under physical sizing and theme dark', () => {
        const layout = sampleLayout();
        const svg = toSvg(layout, {
          namespace: 'phys-dark',
          sizing: 'physical',
          theme: 'dark',
        });
        const root = rootSvgTag(svg);

        expect(root).toMatch(/\bwidth="[^"]+mm"/);
        expect(root).toMatch(/\bheight="[^"]+mm"/);
        expect(root).toContain('viewBox="');
        expect(root).toContain('aria-labelledby="rackdown-phys-dark-title"');
        expect(root).toContain('aria-describedby="rackdown-phys-dark-desc"');

        const style = svgStyleBlock(svg);
        expect(style).toContain(
          '.rackdown-rack { fill: var(--rackdown-rack-fill, #1e293b);',
        );
        expect(style).not.toContain('prefers-color-scheme');
        expect(svg).toContain('<title id="rackdown-phys-dark-title">');
        expect(svg).toContain('<desc id="rackdown-phys-dark-desc">');
      });
    });
  });

  describe('external endpoint rendering and metadata', () => {
    it('renders visible text from label, keeping short label when target is long', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- [[Very/Long/Path/To/Target/Vault/File|Short]]',
        ),
      );
      const svg = toSvg(layout, { namespace: 'ext-label' });
      expect(svg).toContain('>Short</text>');
      expect(svg).not.toContain('>Very/Long/Path</text>');
      expect(svg).toContain('<title>Short</title>');
    });

    it('title contains full uncompacted label', () => {
      const longLabel =
        'Super Long External Endpoint Label That Exceeds Normal Length';
      const layout = resolve(
        parse(
          `rack "R" 12U\n10 switch "S" as s\ns:1 -- external "${longLabel}"`,
        ),
      );
      const svg = toSvg(layout, { namespace: 'ext-title' });
      expect(svg).toContain(`<title>${longLabel}</title>`);
      expect(svg).toContain('class="rackdown-external-label"');
    });

    it('plain external has data-link-style="none" and no data-target', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- external "ISP Handover"',
        ),
      );
      const svg = toSvg(layout, { namespace: 'ext-plain' });
      expect(svg).toContain('data-link-style="none"');
      expect(svg).toContain('data-label="ISP Handover"');
      expect(svg).not.toContain('data-target=');
    });

    it('wiki external has data-link-style="wiki" and real target', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- [[Infrastructure/Garage|Garage Rack]]',
        ),
      );
      const svg = toSvg(layout, { namespace: 'ext-wiki' });
      expect(svg).toContain('data-link-style="wiki"');
      expect(svg).toContain('data-label="Garage Rack"');
      expect(svg).toContain('data-target="Infrastructure/Garage"');
    });

    it('Markdown external has data-link-style="markdown" and real target', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- [Garage Rack](Infrastructure/Garage.md)',
        ),
      );
      const svg = toSvg(layout, { namespace: 'ext-md' });
      expect(svg).toContain('data-link-style="markdown"');
      expect(svg).toContain('data-label="Garage Rack"');
      expect(svg).toContain('data-target="Infrastructure/Garage.md"');
    });

    it('escapes XML special characters in label and target', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- [Special <&"\' >](https://example.com?a=1&b=2)',
        ),
      );
      const svg = toSvg(layout, { namespace: 'ext-xml' });
      expect(svg).toContain('data-label="Special &lt;&amp;&quot;&apos; &gt;"');
      expect(svg).toContain('data-target="https://example.com?a=1&amp;b=2"');
    });

    it('fingerprint changes when link semantics change', () => {
      const plainLayout = resolve(
        parse('rack "R" 12U\n10 switch "S" as s\ns:1 -- external "Target"'),
      );
      const wikiLayout = resolve(
        parse('rack "R" 12U\n10 switch "S" as s\ns:1 -- [[Target]]'),
      );
      const mdLayout = resolve(
        parse('rack "R" 12U\n10 switch "S" as s\ns:1 -- [Target](Target)'),
      );

      const svgPlain = toSvg(plainLayout);
      const svgWiki = toSvg(wikiLayout);
      const svgMd = toSvg(mdLayout);

      const idPlain = derivedRootId(svgPlain);
      const idWiki = derivedRootId(svgWiki);
      const idMd = derivedRootId(svgMd);

      expect(idPlain).not.toBe(idWiki);
      expect(idPlain).not.toBe(idMd);
      expect(idWiki).not.toBe(idMd);
    });

    it('same input remains deterministic', () => {
      const layout1 = resolve(
        parse('rack "R" 12U\n10 switch "S" as s\ns:1 -- [[Target|Alias]]'),
      );
      const layout2 = resolve(
        parse('rack "R" 12U\n10 switch "S" as s\ns:1 -- [[Target|Alias]]'),
      );
      expect(toSvg(layout1)).toBe(toSvg(layout2));
    });
  });
});

describe('roundedRoutePath', () => {
  const point = (xMm: number, yMm: number): PointMm => ({ xMm, yMm });

  /** Coordinate pairs in `d`, in order, whatever command carried them. */
  function coordinates(d: string): string[] {
    return d.split(' ').filter((token) => token.includes(','));
  }

  it('rounds a single right-angle bend with the 3mm nominal radius', () => {
    // 40mm and 40mm adjacent segments: nothing to clamp against, so the
    // nominal radius applies in full.
    const d = roundedRoutePath([point(0, 10), point(40, 10), point(40, 50)]);

    expect(d).toBe('M 0,10 L 37,10 Q 40,10 40,13 L 40,50');
  });

  it('rounds every turn orientation the same way', () => {
    // right-then-down, right-then-up, left-then-down, left-then-up.
    expect(roundedRoutePath([point(0, 0), point(40, 0), point(40, 40)])).toBe(
      'M 0,0 L 37,0 Q 40,0 40,3 L 40,40',
    );
    expect(roundedRoutePath([point(0, 40), point(40, 40), point(40, 0)])).toBe(
      'M 0,40 L 37,40 Q 40,40 40,37 L 40,0',
    );
    expect(roundedRoutePath([point(40, 0), point(0, 0), point(0, 40)])).toBe(
      'M 40,0 L 3,0 Q 0,0 0,3 L 0,40',
    );
    expect(roundedRoutePath([point(40, 40), point(0, 40), point(0, 0)])).toBe(
      'M 40,40 L 3,40 Q 0,40 0,37 L 0,0',
    );
  });

  it('rounds each bend of a multi-bend route', () => {
    const d = roundedRoutePath([
      point(0, 0),
      point(40, 0),
      point(40, 40),
      point(80, 40),
    ]);

    expect(d).toBe('M 0,0 L 37,0 Q 40,0 40,3 L 40,37 Q 40,40 43,40 L 80,40');
  });

  it('clamps the radius to half of a short incoming segment', () => {
    // 4mm in: half of it is 2mm, below the 3mm nominal.
    const d = roundedRoutePath([point(0, 0), point(4, 0), point(4, 40)]);

    expect(d).toBe('M 0,0 L 2,0 Q 4,0 4,2 L 4,40');
  });

  it('clamps the radius to half of a short outgoing segment', () => {
    const d = roundedRoutePath([point(0, 0), point(40, 0), point(40, 4)]);

    expect(d).toBe('M 0,0 L 38,0 Q 40,0 40,2 L 40,4');
  });

  it('clamps to the shorter half when both adjacent segments are short', () => {
    // 5mm in (half 2.5mm), 3mm out (half 1.5mm): the smaller half wins, so
    // neither segment is over-consumed.
    const d = roundedRoutePath([point(0, 0), point(5, 0), point(5, 3)]);

    expect(d).toBe('M 0,0 L 3.5,0 Q 5,0 5,1.5 L 5,3');
  });

  it('leaves a collinear interior point as a straight join', () => {
    const d = roundedRoutePath([point(0, 0), point(20, 0), point(40, 0)]);

    expect(d).toBe('M 0,0 L 20,0 L 40,0');
    expect(d).not.toContain('Q');
  });

  it('drops a duplicate consecutive point rather than curving through it', () => {
    const d = roundedRoutePath([
      point(0, 10),
      point(40, 10),
      point(40, 10),
      point(40, 50),
    ]);

    expect(d).toBe('M 0,10 L 37,10 Q 40,10 40,13 L 40,50');
  });

  it('emits a plain line for a two-point route', () => {
    const d = roundedRoutePath([point(0, 0), point(40, 40)]);

    expect(d).toBe('M 0,0 L 40,40');
    expect(d).not.toContain('Q');
  });

  it('preserves the exact first and last route coordinates', () => {
    const route = [point(12.7, 60.425), point(495.3, 60.425), point(495.3, 24)];
    const d = roundedRoutePath(route);
    const points = coordinates(d);

    expect(points.at(0)).toBe('12.7,60.425');
    expect(points.at(-1)).toBe('495.3,24');
  });

  it('is deterministic for the same route', () => {
    const route = [
      point(0, 0),
      point(40, 0),
      point(40, 40),
      point(80, 40),
      point(80, 80),
    ];

    expect(roundedRoutePath(route)).toBe(roundedRoutePath(route));
  });

  it('does not mutate the route it was given', () => {
    const route = [point(0, 10), point(40, 10), point(40, 10), point(40, 50)];
    const before = route.map((entry) => ({ ...entry }));

    roundedRoutePath(route);

    expect(route).toEqual(before);
    expect(route).toHaveLength(4);
  });
});

describe('routed connection element shape', () => {
  const layout = () =>
    resolve(
      parse(
        'rack "Rack" 6U\n5 switch "Core" as core\n2 router "Gateway" as gateway\ncore:1 -- gateway:lan',
      ),
    );

  it('keeps direct routing as a <line>', () => {
    const svg = toSvg(layout(), {
      namespace: 'shape-direct',
      connectionRouting: 'direct',
    });

    expect(svg).toContain('<line ');
    expect(svg).not.toContain('<path ');
  });

  it.each(['orthogonal', 'lanes', 'perimeter'] as const)(
    'renders %s routing as a <path> rather than a <polyline>',
    (connectionRouting) => {
      const svg = toSvg(layout(), {
        namespace: `shape-${connectionRouting}`,
        connectionRouting,
      });

      expect(svg).toContain('<path ');
      expect(svg).toContain(`data-routing="${connectionRouting}"`);
      expect(svg).not.toContain('<polyline ');
    },
  );
});

describe('routing envelope viewport stability (#257)', () => {
  const ROUTING_MODES = ['direct', 'orthogonal', 'lanes', 'perimeter'] as const;

  const RACK_WIDTH_MM = 482.6;
  const SIDE_ENVELOPE_MM = 32.7;
  const TOP_ENVELOPE_MM = 40.2;

  /** `count` connections between two devices at opposite ends of one rack. */
  function sameRackSource(count: number): string {
    const lines = [
      `rack "Rack" 12U`,
      `11 switch "A" as a`,
      `1 switch "B" as b`,
    ];
    for (let index = 0; index < count; index += 1) {
      lines.push(`a:${index + 1} -- b:${index + 1}`);
    }
    return lines.join('\n');
  }

  /** `count` connections between devices in two separate racks. */
  function rackPairSource(count: number): string {
    const lines = [
      `rack "R1" 6U`,
      `5 switch "A" as a`,
      ``,
      `rack "R2" 6U`,
      `5 switch "B" as b`,
    ];
    for (let index = 0; index < count; index += 1) {
      lines.push(`a:${index + 1} -- b:${index + 1}`);
    }
    return lines.join('\n');
  }

  function renderModes(layout: RackLayout): Record<string, ViewBoxMetrics> {
    const rendered: Record<string, ViewBoxMetrics> = {};
    for (const connectionRouting of ROUTING_MODES) {
      rendered[connectionRouting] = viewBoxMetrics(
        toSvg(layout, { namespace: 'envelope', connectionRouting }),
      );
    }
    return rendered;
  }

  it('renders one connected layout identically in all four routing modes', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 6U\n5 switch "Core" as core\n2 router "Gateway" as gateway\ncore:24 -- gateway:lan`,
      ),
    );

    const rendered = renderModes(layout);
    const baseline = rendered.direct;

    for (const connectionRouting of ROUTING_MODES) {
      expect(rendered[connectionRouting]).toEqual(baseline);
    }
  });

  it('keeps the first perimeter lane from changing rack scale', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 3U\n3 switch "Core" as core\n2 router "Gateway" as gateway\ncore:24 -- gateway:lan`,
      ),
    );

    const direct = viewBoxMetrics(
      toSvg(layout, { namespace: 'first-lane', connectionRouting: 'direct' }),
    );
    const perimeter = viewBoxMetrics(
      toSvg(layout, {
        namespace: 'first-lane',
        connectionRouting: 'perimeter',
      }),
    );

    expect(perimeter).toEqual(direct);
  });

  it('keeps the viewport stable while capped perimeter corridors fill and wrap', () => {
    const baseline = viewBoxMetrics(
      toSvg(resolve(parse(sameRackSource(1))), {
        namespace: 'capped',
        connectionRouting: 'perimeter',
      }),
    );

    let deepest = 0;
    for (const count of [1, 2, 3, 4, 5, 6, 7, 12, 20, 30]) {
      const svg = toSvg(resolve(parse(sameRackSource(count))), {
        namespace: 'capped',
        connectionRouting: 'perimeter',
      });

      expect(viewBoxMetrics(svg)).toEqual(baseline);
      expectPointsInsideViewport(svg);

      for (const point of routePoints(svg)) {
        deepest = Math.max(
          deepest,
          point.xMm < 0 ? -point.xMm : 0,
          point.xMm > RACK_WIDTH_MM ? point.xMm - RACK_WIDTH_MM : 0,
        );
      }
    }

    // Proves the fixture really drove the capped perimeter corridor out to its
    // furthest lane rather than taking short local routes the whole way.
    expect(deepest).toBeCloseTo(SIDE_ENVELOPE_MM, 6);
  });

  it('lets uncapped lane routing expand the viewport beyond the envelope', () => {
    const inside = viewBoxMetrics(
      toSvg(resolve(parse(sameRackSource(1))), {
        namespace: 'uncapped',
        connectionRouting: 'lanes',
      }),
    );
    const svg = toSvg(resolve(parse(sameRackSource(12))), {
      namespace: 'uncapped',
      connectionRouting: 'lanes',
    });
    const expanded = viewBoxMetrics(svg);

    expect(expanded.width).toBeGreaterThan(inside.width);
    expectPointsInsideViewport(svg);
  });

  it('lets an uncapped pair-gap route expand the viewport rather than clip', () => {
    const inside = viewBoxMetrics(
      toSvg(resolve(parse(rackPairSource(1))), {
        namespace: 'pair-gap',
        connectionRouting: 'perimeter',
      }),
    );
    const svg = toSvg(resolve(parse(rackPairSource(76))), {
      namespace: 'pair-gap',
      connectionRouting: 'perimeter',
    });
    const expanded = viewBoxMetrics(svg);

    expect(expanded.height).toBeGreaterThan(inside.height);
    expectPointsInsideViewport(svg);
  });

  it.each(['pixels', 'physical', 'responsive'] as const)(
    'measures uncapped nonexternal routes before placing callouts (%s)',
    (sizing) => {
      const source = `${rackPairSource(160)}\na -- external "Power"`;
      const routeSpy = vi.spyOn(routingModule, 'routeConnections');
      const svg = toSvg(resolve(parse(source)), {
        connectionRouting: 'perimeter',
        namespace: 'measured',
        sizing,
      });
      const calls = routeSpy.mock.results.map(
        (result) => result.value as Map<string, PointMm[]>,
      );
      routeSpy.mockRestore();
      expect(calls).toHaveLength(2);
      const initial = calls[0];
      const final = calls[1];
      if (!initial || !final)
        throw new Error('Expected exactly two route passes');
      const nonExternal = [...initial.entries()].slice(0, 160);
      const maxY = Math.max(
        ...nonExternal.flatMap(([, points]) =>
          points.map((point) => point.yMm),
        ),
      );
      expect(maxY).toBeGreaterThan(6 * 44.45 + SIDE_ENVELOPE_MM);
      expect(externalRects(svg)[0]?.y).toBeCloseTo(maxY + 10, 3);
      // A reused allocator would advance the uncapped pair ordinal a second time.
      for (const [id, route] of nonExternal)
        expect(final.get(id)).toEqual(route);
      expectPointsInsideViewport(svg);
      expectRectsInsideViewport(svg);
      const viewport = viewBoxMetrics(svg);
      expect(viewport.y + viewport.height).toBeCloseTo(
        maxY + 10 + 16 + PADDING_MM,
        3,
      );
    },
  );

  it('uses the normal routing envelope plus 10mm as the ordinary callout floor', () => {
    const svg = toSvg(
      resolve(parse('rack "R" 4U\n4 switch "S" as s\ns -- external "Power"')),
      { connectionRouting: 'perimeter' },
    );
    expect(externalRects(svg)[0]?.y).toBeCloseTo(
      4 * 44.45 + SIDE_ENVELOPE_MM + 10,
      3,
    );
  });

  it('reserves no envelope for a rack diagram with no connections', () => {
    const svg = toSvg(
      resolve(parse(`rack "Rack" 3U\n3 router "Gateway" as gateway`)),
      { namespace: 'cable-free' },
    );

    expect(viewBoxMetrics(svg)).toEqual({
      x: -25.4,
      y: -25.4,
      width: 514.35,
      height: 165.1,
    });
  });

  it('does not activate the envelope for a connection dropped before projection', () => {
    const source = `rack "Rack" 3U\n3 router "Gateway" as gateway`;
    const cableFree = resolve(parse(source));
    const dropped = resolve(parse(`${source}\ngateway:wan -- missing:lan`));

    expect(dropped.connections).toHaveLength(0);
    expect(
      dropped.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Unresolved device reference'),
      ),
    ).toBe(true);

    expect(viewBoxMetrics(toSvg(dropped, { namespace: 'dropped' }))).toEqual(
      viewBoxMetrics(toSvg(cableFree, { namespace: 'dropped' })),
    );
  });

  it('keeps externals and routes visible under both placements', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 3U\n3 router "Gateway" as gateway\n2 switch "Core" as core\ncore:24 -- gateway:lan\ngateway:wan -- [[ISP Handover]]`,
      ),
    );

    const bottom = toSvg(layout, {
      namespace: 'placement',
      externalPlacement: 'bottom',
      connectionRouting: 'perimeter',
    });
    const right = toSvg(layout, {
      namespace: 'placement',
      externalPlacement: 'right',
      connectionRouting: 'perimeter',
    });

    for (const svg of [bottom, right]) {
      expectRectsInsideViewport(svg);
      expectPointsInsideViewport(svg);
    }

    const rightRects = externalRects(right);
    const rightView = viewBoxMetrics(right);
    const furthestExternal = Math.max(
      ...rightRects.map((rect) => rect.x + rect.width),
    );

    // Right-placed externals sit beyond the reserved band and govern the right
    // extent themselves; the envelope is not re-expanded around them.
    expect(furthestExternal).toBeGreaterThan(RACK_WIDTH_MM + SIDE_ENVELOPE_MM);
    expect(rightView.width).toBeGreaterThan(viewBoxMetrics(bottom).width);
  });

  it('shares one viewport across every sizing mode', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 3U\n3 switch "Core" as core\n2 router "Gateway" as gateway\ncore:24 -- gateway:lan`,
      ),
    );

    const responsive = toSvg(layout, {
      namespace: 'sizing',
      sizing: 'responsive',
      connectionRouting: 'perimeter',
    });
    const pixels = toSvg(layout, {
      namespace: 'sizing',
      sizing: 'pixels',
      connectionRouting: 'perimeter',
    });
    const physical = toSvg(layout, {
      namespace: 'sizing',
      sizing: 'physical',
      connectionRouting: 'perimeter',
    });

    const view = viewBoxMetrics(responsive);
    expect(viewBoxMetrics(pixels)).toEqual(view);
    expect(viewBoxMetrics(physical)).toEqual(view);

    const root = (svg: string): string => svg.match(/<svg[^>]*>/)?.[0] ?? '';

    expect(root(responsive)).not.toMatch(/\swidth="/);
    expect(root(responsive)).not.toMatch(/\sheight="/);
    expect(root(pixels)).toContain(`width="${view.width}"`);
    expect(root(pixels)).toContain(`height="${view.height}"`);
    expect(root(physical)).toContain(`width="${view.width}mm"`);
    expect(root(physical)).toContain(`height="${view.height}mm"`);
  });

  describe('caller-constructed layouts', () => {
    function callerLayout(options: { racks: boolean; connections: boolean }) {
      const racks = options.racks
        ? [
            {
              id: 'rack-1',
              name: 'Rack',
              units: 3,
              widthInches: 19,
              u1: 'top',
              views: ['front'],
              xMm: 0,
              yMm: 0,
              widthMm: RACK_WIDTH_MM,
              heightMm: 133.35,
            },
          ]
        : [];
      const devices = options.racks
        ? [
            {
              id: 'device-1',
              rackId: 'rack-1',
              label: 'A',
              deviceType: 'switch',
              positionU: 1,
              uHeight: 1,
              mountFace: 'front',
              unknown: false,
              ports: [
                { name: 'p1', anchor: { xMm: 60, yMm: 22.225 }, adHoc: false },
              ],
              xMm: 0,
              yMm: 0,
              widthMm: RACK_WIDTH_MM,
              heightMm: 44.45,
            },
            {
              id: 'device-2',
              rackId: 'rack-1',
              label: 'B',
              deviceType: 'switch',
              positionU: 3,
              uHeight: 1,
              mountFace: 'front',
              unknown: false,
              ports: [
                { name: 'p1', anchor: { xMm: 60, yMm: 111.125 }, adHoc: false },
              ],
              xMm: 0,
              yMm: 88.9,
              widthMm: RACK_WIDTH_MM,
              heightMm: 44.45,
            },
          ]
        : [];

      const deviceConnection = {
        id: 'connection-1',
        from: {
          kind: 'device',
          deviceId: 'device-1',
          portName: 'p1',
          anchor: { xMm: 60, yMm: 22.225 },
          adHocPort: false,
        },
        to: {
          kind: 'device',
          deviceId: 'device-2',
          portName: 'p1',
          anchor: { xMm: 60, yMm: 111.125 },
          adHocPort: false,
        },
      };
      const externalConnection = {
        id: 'connection-1',
        from: { kind: 'external', externalId: 'external-1', label: 'Left' },
        to: { kind: 'external', externalId: 'external-2', label: 'Right' },
      };

      return {
        schemaVersion: 1,
        racks,
        devices,
        connections: options.connections
          ? [options.racks ? deviceConnection : externalConnection]
          : [],
        externals: options.racks
          ? []
          : [
              { id: 'external-1', label: 'Left' },
              { id: 'external-2', label: 'Right' },
            ],
        diagnostics: [],
        bounds: options.racks
          ? { widthMm: RACK_WIDTH_MM, heightMm: 133.35 }
          : { widthMm: 0, heightMm: 0 },
      } as unknown as RackLayout;
    }

    it('leaves an external-only caller layout governed by its own geometry', () => {
      const svg = toSvg(callerLayout({ racks: false, connections: true }), {
        namespace: 'caller-external',
        connectionRouting: 'perimeter',
      });

      // No projected rack, so no envelope: the viewport is exactly the drawn
      // annotation and route geometry plus the ordinary gutters.
      expectTightViewport(svg);
      expectPointsInsideViewport(svg);
    });

    it('applies the envelope to a caller layout with racks and connections', () => {
      const connected = viewBoxMetrics(
        toSvg(callerLayout({ racks: true, connections: true }), {
          namespace: 'caller-rack',
          connectionRouting: 'perimeter',
        }),
      );
      const cableFree = viewBoxMetrics(
        toSvg(callerLayout({ racks: true, connections: false }), {
          namespace: 'caller-rack',
        }),
      );

      expect(cableFree.x - connected.x).toBeCloseTo(SIDE_ENVELOPE_MM, 6);
      expect(cableFree.y - connected.y).toBeCloseTo(TOP_ENVELOPE_MM, 6);
      expect(connected.width - cableFree.width).toBeCloseTo(
        SIDE_ENVELOPE_MM * 2,
        6,
      );
      expect(connected.height - cableFree.height).toBeCloseTo(
        TOP_ENVELOPE_MM + SIDE_ENVELOPE_MM,
        6,
      );
    });
  });

  describe('renderer cleanup and explanatory invariants (#200 / #201)', () => {
    it('places bottom externals in alternating slot sequence 0, -1, +1, -2, +2 outward from centre', () => {
      const source = `rack "Rack" 5U 19in
1 switch "SW" as sw
sw:1 -- [[Ext0]]
sw:2 -- [[Ext1]]
sw:3 -- [[Ext2]]
sw:4 -- [[Ext3]]
sw:5 -- [[Ext4]]`;
      const layout = resolve(parse(source));
      const svg = toSvg(layout, {
        namespace: 'ext-slots',
        externalPlacement: 'bottom',
      });

      const matches = [
        ...svg.matchAll(
          /<g id="[^"]+" class="rackdown-external-group" data-external-id="([^"]+)"[\s\S]*?<rect class="rackdown-external-box" x="(-?[\d.]+)"/g,
        ),
      ];
      expect(matches.length).toBe(5);

      const xCoords = matches.map((m) => Number(m[2]));
      const [x0, x1, x2, x3, x4] = xCoords;
      if (
        x0 === undefined ||
        x1 === undefined ||
        x2 === undefined ||
        x3 === undefined ||
        x4 === undefined
      ) {
        throw new Error('expected 5 coordinates');
      }

      // Slot sequence:
      // index 0 -> 0 (centre)
      // index 1 -> -1 (left)
      // index 2 -> +1 (right)
      // index 3 -> -2 (farther left)
      // index 4 -> +2 (farther right)
      expect(x1).toBeLessThan(x0);
      expect(x2).toBeGreaterThan(x0);
      expect(x3).toBeLessThan(x1);
      expect(x4).toBeGreaterThan(x2);

      const slotStep = 76.2 + 4; // EXTERNAL_WIDTH_MM + EXTERNAL_HORIZONTAL_GAP_MM
      expect(x0 - x1).toBeCloseTo(slotStep, 3);
      expect(x2 - x0).toBeCloseTo(slotStep, 3);
      expect(x1 - x3).toBeCloseTo(slotStep, 3);
      expect(x4 - x2).toBeCloseTo(slotStep, 3);
    });

    it('distinguishes ordinary device, blank, and shelf role presentation exactly', () => {
      const source = `rack "Rack" 5U 19in
1 switch "Normal"
2 1U blank "Blank"
3 1U shelf "Shelf"`;
      const svg = toSvg(resolve(parse(source)), { namespace: 'roles' });

      const normalMatch = svg.match(
        /<g id="[^"]+" class="([^"]+)" data-device-id="[^"]+" data-device-type="switch"([^>]*)>([\s\S]*?)<\/g>/,
      );
      expect(normalMatch).toBeDefined();
      if (!normalMatch) {
        throw new Error('expected normalMatch');
      }
      const [, normalClass, normalAttrs, normalBody] = normalMatch;
      expect(normalAttrs).not.toContain('data-item-role');
      expect(normalClass).toBe('rackdown-device-group rackdown-device-front');
      expect(normalClass).not.toContain('rackdown-blank');
      expect(normalClass).not.toContain('rackdown-shelf');
      expect(normalBody).toContain('class="rackdown-device"');
      expect(normalBody).toContain('class="rackdown-device-label"');

      const blankMatch = svg.match(
        /<g id="[^"]+" class="([^"]+)" data-device-id="[^"]+" data-device-type="blank"([^>]*)>([\s\S]*?)<\/g>/,
      );
      expect(blankMatch).toBeDefined();
      if (!blankMatch) {
        throw new Error('expected blankMatch');
      }
      const [, blankClass, blankAttrs, blankBody] = blankMatch;
      expect(blankAttrs).toContain('data-item-role="blank"');
      expect(blankClass).toBe(
        'rackdown-device-group rackdown-blank-group rackdown-device-front',
      );
      expect(blankBody).toContain('class="rackdown-device rackdown-blank"');
      expect(blankBody).toContain(
        'class="rackdown-device-label rackdown-blank-label"',
      );

      const shelfMatch = svg.match(
        /<g id="[^"]+" class="([^"]+)" data-device-id="[^"]+" data-device-type="shelf"([^>]*)>([\s\S]*?)<\/g>/,
      );
      expect(shelfMatch).toBeDefined();
      if (!shelfMatch) {
        throw new Error('expected shelfMatch');
      }
      const [, shelfClass, shelfAttrs, shelfBody] = shelfMatch;
      expect(shelfAttrs).toContain('data-item-role="shelf"');
      expect(shelfClass).toBe(
        'rackdown-device-group rackdown-shelf-group rackdown-device-front',
      );
      expect(shelfBody).toContain('class="rackdown-device rackdown-shelf"');
      expect(shelfBody).toContain(
        'class="rackdown-device-label rackdown-shelf-label"',
      );
    });

    it('pins device label visibility policy across ordinary, blank, and shelf devices', () => {
      const source = `rack "Rack" 6U 19in
1 switch "Normal"
2 1U blank
3 1U shelf
4 1U blank "Custom Blank"
5 1U shelf "Custom Shelf"`;
      const svg = toSvg(resolve(parse(source)), { namespace: 'labels' });

      expect(svg).toContain('>Normal</text>');
      expect(svg).not.toContain('>blank</text>');
      expect(svg).not.toContain('>shelf</text>');
      expect(svg).toContain('>Custom Blank</text>');
      expect(svg).toContain('>Custom Shelf</text>');

      // Explicit suppression and explicit inclusion via caller-constructed layout metadata
      const layout = resolve(
        parse(
          'rack "Rack" 3U 19in\n1 switch "A"\n2 1U blank "B"\n3 1U shelf "C"',
        ),
      );
      const devB = layout.devices.find((d) => d.label === 'B');
      const devC = layout.devices.find((d) => d.label === 'C');
      expect(devB).toBeDefined();
      expect(devC).toBeDefined();
      if (devB) devB.explicitLabel = false;
      if (devC) devC.explicitLabel = true;

      const callerSvg = toSvg(layout, { namespace: 'explicit-labels' });
      expect(callerSvg).toContain('>A</text>');
      expect(callerSvg).not.toContain('>B</text>');
      expect(callerSvg).toContain('>C</text>');
    });

    it('sorts shelves before non-shelves while stably preserving relative source order', () => {
      const source = `rack "Rack" 6U 19in
1 switch "normal-A"
2 1U shelf "shelf-A"
3 switch "normal-B"
4 1U shelf "shelf-B"`;
      const svg = toSvg(resolve(parse(source)), { namespace: 'shelf-order' });
      const titles = [
        ...svg.matchAll(
          /<g id="[^"]*-device-\d+"[^>]*>[\s\S]*?<title>([^<]+)<\/title>/g,
        ),
      ].map((m) => m[1]);
      expect(titles).toEqual(['shelf-A', 'shelf-B', 'normal-A', 'normal-B']);
    });

    it('preserves frozen emission z-order: racks, connections, devices, externals', () => {
      const source = `rack "Rack" 5U 19in
1 switch "Core" as core
core:1 -- [[Gateway]]`;
      const svg = toSvg(resolve(parse(source)), { namespace: 'z-order' });

      const rackIndex = svg.indexOf('class="rackdown-rack-group');
      const connIndex = svg.indexOf('class="rackdown-connection');
      const devIndex = svg.indexOf('class="rackdown-device-group');
      const extIndex = svg.indexOf('class="rackdown-external-group');

      expect(rackIndex).toBeGreaterThan(-1);
      expect(connIndex).toBeGreaterThan(-1);
      expect(devIndex).toBeGreaterThan(-1);
      expect(extIndex).toBeGreaterThan(-1);

      expect(rackIndex).toBeLessThan(connIndex);
      expect(connIndex).toBeLessThan(devIndex);
      expect(devIndex).toBeLessThan(extIndex);
    });

    describe('routingEndpoint renderer projection equivalence', () => {
      it('routes ordinary device-to-device connection', () => {
        const source = `rack "Rack" 5U 19in
1 switch "SW1" as sw1
3 switch "SW2" as sw2
sw1:1 -- sw2:1`;
        const svg = toSvg(resolve(parse(source)), {
          namespace: 'd2d',
          connectionRouting: 'orthogonal',
        });
        expect(svg).toContain('id="rackdown-d2d-connection-1"');
        expect(svg).toContain('<title>sw1:1 → sw2:1</title>');
      });

      it('routes same-row connection with slot bounds', () => {
        const source = `rack "Rack" 5U 24in
1 1U device "Left" as left
1 1U device "Right" as right
left:1 -- right:1`;
        const svg = toSvg(resolve(parse(source)), {
          namespace: 'same-row',
          connectionRouting: 'perimeter',
        });
        expect(svg).toContain('id="rackdown-same-row-connection-1"');
        expect(svg).toContain('<title>left:1 → right:1</title>');
        expect(svg).toContain(
          'd="M 120.65,177.8 L 120.65,174.8 Q 120.65,171.8 123.65,171.8 L 358.95,171.8 Q 361.95,171.8 361.95,174.8 L 361.95,177.8"',
        );
      });

      it('routes external-to-device connection', () => {
        const source = `rack "Rack" 5U 19in
1 switch "SW" as sw
sw:1 -- [[External]]`;
        const svg = toSvg(resolve(parse(source)), {
          namespace: 'ext-dev',
          connectionRouting: 'perimeter',
        });
        expect(svg).toContain('id="rackdown-ext-dev-connection-1"');
        expect(svg).toContain('class="rackdown-external-group"');
      });

      it('drops connection when device endpoint is missing from projected scene before routing', () => {
        const layout = resolve(parse('rack "Rack" 3U 19in\n1 switch "SW"'));
        layout.connections.push({
          id: 'ghost-conn',
          category: 'unclassified',
          categoryReason: 'no-evidence',
          from: {
            kind: 'device',
            deviceId: 'non-existent',
            anchor: { xMm: 0, yMm: 0 },
            adHocPort: false,
          },
          to: {
            kind: 'device',
            deviceId: 'SW',
            anchor: { xMm: 10, yMm: 10 },
            adHocPort: false,
          },
        });
        const svg = toSvg(layout, { namespace: 'dropped-conn' });
        expect(svg).not.toContain('ghost-conn');
        expect(svg).not.toContain('id="rackdown-dropped-conn-connection');
        expect(svg).toContain('0 connections');
      });

      it('routes connections across front and rear projections', () => {
        const source = `rack "Rack" 5U views front rear
1 switch "FrontSW" as front
rear 1 pdu "RearPDU" as rear
front:1 -- rear:1`;
        const svg = toSvg(resolve(parse(source)), {
          namespace: 'front-rear-routing',
          connectionRouting: 'orthogonal',
        });
        expect(svg).toContain('id="rackdown-front-rear-routing-connection-1"');
        expect(svg).toContain('<title>front:1 → rear:1</title>');
      });
    });
  });
});
