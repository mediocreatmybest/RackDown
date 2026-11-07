import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

function deviceGroups(svg: string) {
  return [
    ...svg.matchAll(
      /<g\b[^>]*class="rackdown-device-group[^>]*>[\s\S]*?<\/g>/g,
    ),
  ].map(([group]) => {
    const body = group.match(
      /<rect class="rackdown-device[^"]*" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/,
    );
    if (!body) throw new Error('Missing equipment body');
    return {
      group,
      x: Number(body[1]),
      y: Number(body[2]),
      width: Number(body[3]),
      height: Number(body[4]),
    };
  });
}

describe('equipment faceplates', () => {
  it.each([
    'device',
    'switch',
    'server',
    'unavailable-model',
    'blank',
    'shelf',
  ])(
    'aligns %s with the rails while retaining its group and label geometry',
    (type) => {
      const layout = resolve(parse(`rack "R" 6U\n3 2U ${type} "Host" as host`));
      const before = JSON.stringify(layout);
      const svg = toSvg(layout, { namespace: 'faceplate', theme: 'light' });
      const [body] = deviceGroups(svg);
      expect(body).toMatchObject({ x: 7.3, y: 88.9, width: 468, height: 88.9 });
      expect(body?.group).toContain('id="rackdown-faceplate-device-1"');
      expect(body?.group).toContain('data-alias="host"');
      expect(body?.group).toContain('data-mount-face="front"');
      expect(body?.group).toContain(
        '<rect x="0" y="88.9" width="482.6" height="88.9"',
      );
      expect(body?.group).toContain('<title>Host</title>');
      expect(body?.group).toContain('x="241.3" y="133.35"');
      if (type === 'unavailable-model')
        expect(body?.group).toContain('rackdown-device-unknown');
      if (type === 'blank' || type === 'shelf')
        expect(body?.group).toContain(`data-item-role="${type}"`);
      expect(svg).toContain(
        '.rackdown-device { fill: var(--rackdown-device-fill, #e2e8f0); stroke: var(--rackdown-device-stroke, #334155); stroke-width: var(--rackdown-stroke-width, 0.65)',
      );
      expect(svg).toContain('stroke-width: var(--rackdown-stroke-width, 1.15)');
      expect(JSON.stringify(layout)).toBe(before);
      expect(toSvg(layout, { namespace: 'faceplate', theme: 'light' })).toBe(
        svg,
      );
    },
  );

  it.each([3, 4])(
    'retains the internal boundaries of a %i-device shelf row',
    (count) => {
      const source =
        'rack "R" 6U\n3 2U shelf "Tray"\n' +
        Array.from({ length: count }, (_, i) => `3 2U device "Node ${i}"`).join(
          '\n',
        );
      const layout = resolve(parse(source));
      const bodies = deviceGroups(toSvg(layout));
      expect(bodies).toHaveLength(count + 1);
      expect(bodies[0]).toMatchObject({ x: 7.3, width: 468 });
      const nodes = bodies.slice(1);
      const round = (n: number) => Math.round(n * 1000) / 1000;
      for (let i = 0; i < count; i++) {
        expect(nodes[i]?.x).toBe(i === 0 ? 7.3 : round((482.6 * i) / count));
        expect(nodes[i]?.width).toBe(
          round(482.6 / count - (i === 0 || i === count - 1 ? 7.3 : 0)),
        );
      }
    },
  );

  it('uses the matching projected rack, including repeated faces and non-19-inch racks', () => {
    const layout = resolve(
      parse(
        'rack "A" 6U views front rear\n3 device "Front"\nrear 2 switch "Rear"\nrack "B" 4U 10in\n2 server "Narrow"',
      ),
    );
    const first = layout.racks[0];
    if (!first) throw new Error('Missing rack');
    first.views = ['front', 'rear', 'front'];
    // Declared inches are metadata; the resolver uses a fixed diagram width.
    // Exercise a genuinely narrower caller-supplied rack as well.
    const narrow = layout.racks[1];
    const narrowDevice = layout.devices[2];
    if (!narrow || !narrowDevice) throw new Error('Missing narrow rack');
    expect(narrow.widthInches).toBe(10);
    narrow.widthMm = 254;
    narrowDevice.widthMm = 254;
    const svg = toSvg(layout);
    const bodies = deviceGroups(svg);
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toMatchObject({ x: 7.3, y: 438.15, width: 468 });
    expect(bodies[1]).toMatchObject({ x: 515.3, y: 177.8, width: 468 });
    expect(bodies[2]).toMatchObject({ x: 515.3, width: 239.4 });
  });

  it('retains fractional and vertically overflowing bodies, labels and diagnostics', () => {
    const layout = resolve(
      parse(
        'rack "R" 6U\n7 1U device "Above"\n3.5 0.5U device "Half"\n0 1U device "Below"',
      ),
    );
    const before = JSON.stringify(layout);
    expect(layout.diagnostics.length).toBeGreaterThan(0);
    const bodies = deviceGroups(toSvg(layout));
    expect(bodies.map(({ y, height }) => [y, height])).toEqual(
      layout.devices.map((d) => [
        Math.round(d.yMm * 1000) / 1000,
        Math.round(d.heightMm * 1000) / 1000,
      ]),
    );
    expect(bodies.every((b) => b.x === 7.3 && b.width === 468)).toBe(true);
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('retains ordering and full rail paths beside blanks, shelves and warned overlaps', () => {
    const layout = resolve(
      parse(
        'rack "R" 10U\n7 2U device "Host"\n6 blank "Lower blank"\n5 shelf "Exposed shelf"\n4 server "Below shelf"\n2 blank "Standalone"\n7 2U blank "Overlap"',
      ),
    );
    expect(layout.diagnostics.length).toBeGreaterThan(0);
    const svg = toSvg(layout);
    const labels = deviceGroups(svg).map(
      (b) => b.group.match(/<title>([^<]+)<\/title>/)?.[1],
    );
    expect(labels).toEqual([
      'Exposed shelf',
      'Host',
      'Lower blank',
      'Below shelf',
      'Standalone',
      'Overlap',
    ]);
    expect(svg).toContain(
      'class="rackdown-frame-inner" d="M7.3 0 V444.5 M475.3 0 V444.5"',
    );
    expect(svg).not.toContain('rackdown-equipment-outline');
  });

  it.each([-100, -2.7, 475.3, 600])(
    'retains an empty horizontal intersection at x=%s for the existing clip',
    (x) => {
      const layout = resolve(
        parse('rack "R" 6U views front rear\n3 1U device "Outside"'),
      );
      const device = layout.devices[0];
      if (!device) throw new Error('Missing device');
      device.xMm = x;
      device.widthMm = 10;
      const before = JSON.stringify(layout);
      const [body] = deviceGroups(toSvg(layout));
      expect(body).toMatchObject({ x, width: 10 });
      expect(body?.group).toContain('<title>Outside</title>');
      expect(JSON.stringify(layout)).toBe(before);
    },
  );

  it('intersects partially visible caller geometry and never emits a negative body width', () => {
    const layout = resolve(parse('rack "R" 6U\n3 device "Partial"'));
    const device = layout.devices[0];
    if (!device) throw new Error('Missing device');
    device.xMm = -10;
    device.widthMm = 30;
    expect(deviceGroups(toSvg(layout))[0]).toMatchObject({
      x: 7.3,
      width: 12.7,
    });
    device.widthMm = -1;
    expect(deviceGroups(toSvg(layout))[0]?.width).toBe(0);
  });
});

describe('open rack frame', () => {
  it.each([6, 42])(
    'frames a %iU rack without changing its usable geometry',
    (units) => {
      const layout = resolve(parse(`rack "Example" ${units}U`));
      const before = JSON.stringify(layout);
      const svg = toSvg(layout, { namespace: 'frame', theme: 'light' });
      const height = Number((units * 44.45).toFixed(3));

      expect(JSON.stringify(layout)).toBe(before);
      expect(svg).toBe(toSvg(layout, { namespace: 'frame', theme: 'light' }));
      expect(svg).toContain(
        `class="rackdown-rack" x="0" y="0" width="482.6" height="${height}"`,
      );
      expect(svg.match(/class="rackdown-u-label"/g)).toHaveLength(units);
      expect(svg.match(/class="rackdown-u-line"/g)).toHaveLength(units - 1);
      expect(svg).toContain(
        'class="rackdown-frame-cap" x="0" y="-12" width="482.6" height="12"',
      );
      expect(svg).toContain(
        `class="rackdown-frame-cap" x="0" y="${height}" width="482.6" height="12"`,
      );
      for (const x of [14, 468.6]) {
        for (const y of [-6, Number((height + 6).toFixed(3))]) {
          expect(svg).toContain(
            `class="rackdown-frame-bolt" cx="${x}" cy="${y}" r="4"`,
          );
        }
      }
      expect(svg.match(/class="rackdown-frame-outline"/g)).toHaveLength(1);
      expect(svg).toContain(
        `d="M0 -12 H482.6 V${Number((height + 12).toFixed(3))} H0 Z M0 0 H482.6 M0 ${height} H482.6"`,
      );
      expect(svg).toContain(
        `class="rackdown-frame-rail" x="475.3" y="0" width="7.3" height="${height}"`,
      );
      const [, , top, , viewHeight] =
        svg.match(/viewBox="([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/) ?? [];
      expect(Number(top)).toBeLessThan(-12 - 4);
      expect(Number(top) + Number(viewHeight)).toBeGreaterThan(height + 12 + 1);
    },
  );

  it.each(['light', 'dark', 'auto'] as const)(
    'preserves front/rear devices with the %s theme',
    (theme) => {
      const layout = resolve(
        parse(`rack "Example" 6U views front rear
5 1U device "Core Switch" as core
2 1U device "Host A" as host
rear 1 1U device "Rear"
core:1 -- host:1`),
      );
      const before = JSON.stringify(layout);
      const svg = toSvg(layout, {
        theme,
        namespace: 'frame',
        connectionRouting: 'perimeter',
      });

      expect(JSON.stringify(layout)).toBe(before);
      expect(svg.match(/class="rackdown-frame-cap"/g)).toHaveLength(4);
      expect(svg.match(/class="rackdown-frame-bolt"/g)).toHaveLength(8);
      expect(svg).toContain(
        'class="rackdown-device" x="7.3" y="44.45" width="468" height="44.45"',
      );
      expect(svg).toContain(
        'class="rackdown-device" x="7.3" y="177.8" width="468" height="44.45"',
      );
      expect(svg).toContain(
        'class="rackdown-u-line" x1="0" y1="44.45" x2="482.6" y2="44.45"',
      );
      const [, , viewportY, , viewportHeight] =
        svg.match(/viewBox="([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)"/) ?? [];
      expect(svg).toContain(
        `<rect x="7.3" y="${viewportY}" width="468" height="${viewportHeight}"`,
      );
      expect(svg).toContain(
        'class="rackdown-frame" aria-hidden="true" pointer-events="none"',
      );
      expect(svg.indexOf('id="rackdown-frame-frame-2"')).toBeLessThan(
        svg.indexOf('id="rackdown-frame-connection-1"'),
      );
      expect(svg.indexOf('id="rackdown-frame-connection-1"')).toBeLessThan(
        svg.indexOf('<g clip-path="url(#rackdown-frame-rack-interiors)"'),
      );
      expect(svg).toContain('data-mount-face="rear"');
      expect(svg).toContain(theme === 'light' ? '#dbe2e9' : '#334155');
      if (theme === 'auto')
        expect(svg).toContain('@media (prefers-color-scheme: dark)');
    },
  );

  it('bottom-aligns host-sized titles above crossbars and paints them after every frame', () => {
    const svg = toSvg(
      resolve(parse('rack "gyp" 6U views front rear\nrack "gyp" 6U')),
    );
    const titles = [
      ...svg.matchAll(/<text class="rackdown-rack-title"[^>]+>/g),
    ];
    expect(titles).toHaveLength(3);
    for (const title of titles) {
      expect(title[0]).toContain('dominant-baseline="text-after-edge"');
      expect(title.index).toBeGreaterThan(
        svg.lastIndexOf('class="rackdown-frame-outline"'),
      );
    }
    expect(svg).toContain('font-size: var(--rackdown-title-size, 14px)');
  });

  it.each(['light', 'dark', 'auto'] as const)(
    'uses the rack stroke override in %s mode',
    (theme) => {
      const svg = toSvg(resolve(parse('rack "Rack" 6U')), { theme });
      const rules = svg.match(/\.rackdown-frame-outline \{[^}]+\}/g) ?? [];
      expect(rules[0]).toContain(
        'stroke: var(--rackdown-rack-stroke, #475569)',
      );
      if (theme !== 'light')
        expect(rules[1]).toContain(
          'stroke: var(--rackdown-rack-stroke, #94a3b8)',
        );
      expect(rules.join('')).not.toContain('--rackdown-device-stroke');
    },
  );

  it.each(['bottom', 'top'])(
    'does not clip retained device overflow vertically with U1 at %s',
    (u1) => {
      const layout = resolve(
        parse(
          `rack "Overflow" 6U u1 ${u1}\n0 1U device "Below"\n6 2U device "Above"`,
        ),
      );
      expect(layout.devices).toHaveLength(2);
      const svg = toSvg(layout);
      const clip = svg.match(
        /<clipPath id="[^"]+-rack-interiors"[^>]*>\s*<rect x="[^"]+" y="([\d.-]+)" width="[^"]+" height="([\d.-]+)"/,
      );
      expect(clip).not.toBeNull();
      const top = Number(clip?.[1]);
      const bottom = top + Number(clip?.[2]);
      for (const device of layout.devices) {
        expect(top).toBeLessThan(device.yMm);
        expect(bottom).toBeGreaterThan(device.yMm + device.heightMm);
        expect(svg).toContain(`>${device.label}</text>`);
      }
    },
  );
});
