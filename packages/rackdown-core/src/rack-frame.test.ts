import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

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
        'class="rackdown-device" x="0" y="44.45" width="482.6" height="44.45"',
      );
      expect(svg).toContain(
        'class="rackdown-device" x="0" y="177.8" width="482.6" height="44.45"',
      );
      expect(svg).toContain(
        'class="rackdown-u-line" x1="0" y1="44.45" x2="482.6" y2="44.45"',
      );
      expect(svg).toContain('<rect x="7.3" y="0" width="468" height="266.7"');
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
});
