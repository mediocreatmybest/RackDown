import { describe, expect, it } from 'vitest';
import type { ConnectionCategory, DeviceIndex } from './index.js';
import { parse, resolve } from './index.js';

const header = `rack "Lab" 8U
8 known "A" as a
6 known "B" as b`;
const devices: DeviceIndex = {
  known: {
    slug: 'known',
    ports: [
      { name: 'in', kind: 'power-port' },
      { name: 'out', kind: 'power-outlet' },
      { name: 'net', kind: 'interface', type: '32gfc-sfpp' },
      { name: 'management', kind: 'interface', managementOnly: true },
      {
        name: 'poe',
        kind: 'interface',
        poeMode: 'pse',
        poeType: 'type2-ieee802.3at',
      },
      { name: 'con', kind: 'console-port', type: 'rj-45' },
      { name: 'cs', kind: 'console-server-port', type: 'usb-a' },
      { name: 'front', kind: 'front-port', type: '8p8c' },
      { name: 'rear', kind: 'rear-port', type: 'lc' },
      { name: 'unknown-kind', kind: 'new-kind', type: 'rj-45' },
      { name: 'type-only', type: '1000base-t' },
      { name: 'bare' },
      { name: 'ambiguous-power', aliases: ['shared'], kind: 'power-port' },
      { name: 'ambiguous-network', aliases: ['shared'], kind: 'interface' },
    ],
  },
};

function connection(tail: string) {
  return parse(`${header}\na:net -- b:net ${tail}`);
}

describe('explicit connection category grammar', () => {
  it.each(['power', 'network', 'console', 'unclassified'] as const)(
    'accepts %s with independent media and endpoint-local adhoc',
    (category) => {
      for (const tail of [
        `category ${category}`,
        `FiBrE category ${category}`,
        `adhoc FiBrE category ${category}`,
        `FiBrE category adhoc ${category} adhoc`,
      ]) {
        const doc = connection(tail);
        expect(doc.diagnostics).toEqual([]);
        expect(doc.connections[0]?.category).toBe(category);
        expect(doc.connections[0]?.media).toBe(
          tail.includes('FiBrE') ? 'FiBrE' : undefined,
        );
        expect(doc.connections[0]?.from).not.toHaveProperty('adHoc');
        expect(doc.connections[0]?.to).toEqual({
          kind: 'device',
          device: 'b',
          port: 'net',
          ...(tail.includes('adhoc') ? { adHoc: true } : {}),
        });
      }
    },
  );

  it('normalises only the keyword and category value', () => {
    expect(connection('IEC-C13 CaTeGoRy PoWeR').connections[0]).toMatchObject({
      media: 'IEC-C13',
      category: 'power',
    });
  });

  it.each([
    'power',
    'ethernet',
    'fibre',
    'fiber',
    'copper',
    'RJ45',
    'USB',
    'category',
    'category=network',
    '::',
    'unfamiliar',
  ])(
    'preserves historical media %s without inferring from its text',
    (media) => {
      for (const tail of [media, `adhoc ${media}`, `${media} adhoc`]) {
        const doc = connection(tail);
        expect(doc.diagnostics).toEqual([]);
        expect(doc.connections[0]).not.toHaveProperty('category');
        expect(doc.connections[0]?.media).toBe(media);
        expect(resolve(doc).connections[0]?.category).toBe('unclassified');
      }
    },
  );

  it.each([
    ['category unknown', 'unknown'],
    ['category all', 'all'],
    ['fibre category', 'category'],
    ['category power category network', 'category network'],
    ['category power category power', 'category power', true],
    ['category category network', 'category network'],
    ['category power extra', 'extra'],
    ['fibre extra category network', 'extra'],
  ] as const)(
    'recovers %s without falling through to endpoint inference',
    (tail, offending, last: boolean = false) => {
      const doc = connection(tail);
      expect(doc.connections[0]?.category).toBe('invalid');
      const line = `a:net -- b:net ${tail}`;
      const column =
        (last ? line.lastIndexOf(offending) : line.indexOf(offending)) + 1;
      expect(doc.diagnostics).toContainEqual(
        expect.objectContaining({ severity: 'warn', line: 4, column }),
      );
      expect(resolve(doc, devices).connections[0]).toMatchObject({
        category: 'unclassified',
        categoryReason: 'invalid-explicit',
      });
      expect(resolve(doc, devices).devices).toHaveLength(2);
    },
  );

  it('preserves protected operators and all four external forms in either position', () => {
    for (const external of [
      'external "remote -- rack"',
      '[[remote--rack]]',
      '[[remote--rack|Other]]',
      '[Other](https://example.test/remote--rack)',
    ]) {
      for (const line of [
        `a:"odd -- port" adhoc -- ${external} fibre category network`,
        `${external} -- a:"odd -- port" category console adhoc`,
      ]) {
        const doc = parse(`${header}\n  ${line}`);
        expect(doc.diagnostics).toEqual([]);
        expect(doc.connections).toHaveLength(1);
        expect(doc.connections[0]?.source.start).toEqual({
          line: 4,
          column: 3,
        });
        expect(doc.connections[0]?.id).toBe('connection-4');
      }
    }
  });

  it('keeps source modifiers endpoint-local and diagnoses misplaced categories', () => {
    const doc = parse(
      `${header}\na:net adhoc category power -- b:net category network`,
    );
    expect(doc.connections[0]?.from).toMatchObject({ adHoc: true });
    expect(doc.connections[0]?.to).not.toHaveProperty('adHoc');
    expect(doc.connections[0]?.category).toBe('network');
    expect(doc.diagnostics[0]).toMatchObject({
      line: 4,
      column: 13,
      message: 'Unexpected text after the source endpoint: category power',
    });
  });
});

describe('classification from resolved endpoint evidence', () => {
  const cases: [string, string, ConnectionCategory][] = [
    ['a:in', 'b:out', 'power'],
    ['a:in', 'b:missing adhoc', 'power'],
    ['a:out', 'b:missing', 'power'],
    ['a:net', 'b:net', 'network'],
    ['a:net', 'b:missing adhoc', 'network'],
    ['a:con', 'b:cs', 'console'],
    ['a:cs', 'b:missing', 'console'],
    ['a:front', 'b:rear', 'unclassified'],
    ['a:front', 'b:net', 'network'],
    ['a:rear', 'b:con', 'console'],
    ['a:net', 'b:in', 'unclassified'],
    ['a:con', 'b:out', 'unclassified'],
    ['a:management', 'b:net', 'network'],
    ['a:poe', 'b:net', 'network'],
    ['a:net adhoc', 'b:missing', 'network'],
    ['a:shared', 'b:missing', 'unclassified'],
    ['a:unknown-kind', 'b:type-only', 'unclassified'],
    ['a:bare', 'b:missing', 'unclassified'],
    ['a:out', 'external "Supply"', 'power'],
    ['a:net', '[[WAN]]', 'network'],
    ['a:con', '[[Remote]]', 'console'],
    ['a', 'b', 'unclassified'],
    ['a:in', 'b', 'power'],
    ['a', '[[External]]', 'unclassified'],
  ];
  it.each(cases)(
    '%s ↔ %s is %s, independent of endpoint order',
    (left, right, category) => {
      const forward = resolve(parse(`${header}\n${left} -- ${right}`), devices);
      const reverse = resolve(parse(`${header}\n${right} -- ${left}`), devices);
      expect(forward.connections).toHaveLength(1);
      expect(forward.connections[0]?.category).toBe(category);
      expect(reverse.connections[0]?.category).toBe(category);
      expect(reverse.connections[0]?.categoryReason).toBe(
        forward.connections[0]?.categoryReason,
      );
      expect(forward.connections[0]?.from).toEqual(reverse.connections[0]?.to);
      expect(forward.connections[0]?.to).toEqual(reverse.connections[0]?.from);
    },
  );

  it('explains explicit, recovery, single, agreeing, conflicting and absent evidence', () => {
    const layout = resolve(
      parse(`${header}
a:net -- b:net category power
a:net -- b:net category unclassified
a:net -- b:net category invalid
a:out -- b:missing
a:net -- b:net
a:net -- b:out
a -- b`),
      devices,
    );
    expect(
      layout.connections.map((c) => [c.category, c.categoryReason]),
    ).toEqual([
      ['power', 'explicit'],
      ['unclassified', 'explicit'],
      ['unclassified', 'invalid-explicit'],
      ['power', 'one-endpoint'],
      ['network', 'both-endpoints'],
      ['unclassified', 'conflicting-endpoints'],
      ['unclassified', 'no-evidence'],
    ]);
    expect(layout.connections).toHaveLength(7);
    expect(layout.diagnostics).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('Unknown port'),
      }),
    );
  });

  it('keeps original endpoint metadata intact and does not guess again after ambiguity', () => {
    const layout = resolve(
      parse(
        `${header}\na:shared -- b:missing adhoc\na:poe -- b:management\na:net -- b:con`,
      ),
      devices,
    );
    expect(layout.connections[0]?.from).toMatchObject({
      adHocPort: true,
      portName: 'shared',
    });
    expect(layout.connections[0]?.categoryReason).toBe('no-evidence');
    expect(
      layout.devices[0]?.ports.find((p) => p.name === 'poe'),
    ).toMatchObject({
      kind: 'interface',
      poeMode: 'pse',
      poeType: 'type2-ieee802.3at',
    });
    expect(
      layout.devices[1]?.ports.find((p) => p.name === 'management'),
    ).toMatchObject({ managementOnly: true });
    expect(layout.diagnostics).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('Ambiguous port'),
      }),
    );
  });
});
