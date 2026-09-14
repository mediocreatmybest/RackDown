import { describe, expect, it } from 'vitest';
import {
  ASCII_WIDTH_TENTHS,
  externalDisplayLabel,
  externalLabelWidthTenths,
} from './external-labels.js';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

describe('external display labels', () => {
  it('pins every printable ASCII scalar cost', () => {
    const expected = [
      32, 41, 47, 84, 64, 96, 79, 28, 40, 40, 50, 84, 32, 37, 32, 34, 64, 64,
      64, 64, 64, 64, 64, 64, 64, 64, 34, 34, 84, 84, 84, 56, 102, 69, 69, 73,
      78, 67, 62, 78, 76, 30, 53, 68, 57, 87, 75, 79, 67, 79, 73, 67, 64, 74,
      69, 99, 69, 68, 69, 40, 34, 40, 84, 56, 50, 62, 64, 55, 64, 62, 36, 64,
      64, 28, 28, 58, 28, 98, 64, 62, 64, 64, 42, 53, 40, 64, 60, 82, 60, 60,
      53, 64, 34, 64, 84,
    ];
    expect(ASCII_WIDTH_TENTHS).toEqual(expected);
    expect(expected).toHaveLength(95);
    expected.forEach((cost, index) => {
      expect(externalLabelWidthTenths(String.fromCodePoint(index + 32))).toBe(
        cost,
      );
    });
    expect(externalLabelWidthTenths('…')).toBe(100);
    expect(externalLabelWidthTenths('\u200c\u200d\ufe0e\ufe0f')).toBe(0);
    expect(externalLabelWidthTenths('é车🔌')).toBe(420);
  });

  it.each([
    ['Garage GPO', 'Garage GPO'],
    ['IEC power reference', 'IEC power…'],
    ['i'.repeat(23), 'i'.repeat(23)],
    ['i'.repeat(24), 'i'.repeat(24)],
    ['i'.repeat(25), `${'i'.repeat(20)}…`],
    ['W'.repeat(24), 'WWWWW…'],
    ['012345678901234567890123', '01234567…'],
    ['车库电源插座不间断电源设备连接', '车库电源…'],
    ['🔌 Garage ⚡ UPS', '🔌 Garage…'],
    ['👨‍👩‍👧‍👦 Garage', '👨‍👩‍👧‍👦…'],
    ['👨‍👩‍👧‍👦👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦…'],
    ['🇦🇺🇺🇸🇬🇧', '🇦🇺🇺🇸…'],
    ['אבגדהוז', 'אבגד…'],
    ['العربية', 'العر…'],
    ['Cafe\u0301', 'Café'],
    ['a\u0301\u0327'.repeat(4), 'á\u0327á\u0327…'],
    [`x${'\u0301'.repeat(5)}`, '…'],
    ['&<>"\'', '&<>"\''],
    ['!?:;.,()', '!?:;.,()'],
    ['', ''],
    [' \t\n\r ', ''],
    [
      ' A\t\n B\u0000\u0001\u007f\u061c\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069 ',
      'A B',
    ],
  ])('%j displays as %j', (original, expected) => {
    expect(externalDisplayLabel(original)).toBe(expected);
    expect(externalDisplayLabel(original)).toBe(externalDisplayLabel(original));
  });

  it('uses an inclusive integer width boundary', () => {
    expect(externalLabelWidthTenths('i'.repeat(24))).toBe(672);
    expect(externalDisplayLabel(`${'i'.repeat(23)}I`)).toBe(
      `${'i'.repeat(20)}…`,
    );
  });

  it('preserves semantic text, geometry and namespace while guarding ordinary text', () => {
    const layout = resolve(
      parse('rack "Rack" 4U\n4 switch "Core" as core\ncore -- [[Target]]'),
    );
    const external = layout.externals[0];
    if (!external) throw new Error('Missing external');
    external.label = '  Cafe\u0301 & <GPO>\tlong label  ';
    const svg = toSvg(layout, {
      namespace: 'labels-a',
      connectionRouting: 'perimeter',
    });
    expect(svg).toContain(
      'data-label="  Café &amp; &lt;GPO&gt;\tlong label  "',
    );
    expect(svg).toContain(
      '<title>  Café &amp; &lt;GPO&gt;\tlong label  </title>',
    );
    expect(svg).toContain('data-target="Target"');
    expect(svg).toMatch(
      /class="rackdown-external-box"[^>]*width="76.2" height="16"/,
    );
    expect(svg).toMatch(
      /clipPath id="([^"]+)-label-clip" clipPathUnits="userSpaceOnUse"/,
    );
    expect(svg).toContain('width="68.2" height="14"');
    expect(svg).not.toMatch(/textLength|lengthAdjust/);
    expect(svg).toContain('dominant-baseline: alphabetic');
    const other = toSvg(layout, { namespace: 'labels-b' });
    const clip = svg.match(/clipPath id="([^"]+)"/)?.[1];
    expect(clip).toBeDefined();
    expect(other).not.toContain(`id="${clip}"`);
    const viewBox = svg.match(/viewBox="[^"]+"/)?.[0];
    const routes = svg.match(/<path[^>]+ d="[^"]+"/g);
    expect(routes).toHaveLength(1);
    external.label = 'Short';
    const short = toSvg(layout, {
      namespace: 'labels-a',
      connectionRouting: 'perimeter',
    });
    expect(short.match(/viewBox="[^"]+"/)?.[0]).toBe(viewBox);
    expect(short.match(/<path[^>]+ d="[^"]+"/g)).toEqual(routes);
  });
});
