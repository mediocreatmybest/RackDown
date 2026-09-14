import { describe, expect, it } from 'vitest';
import {
  type ExternalPreference,
  packBottomExternals,
  preferredExternalX,
} from './bottom-externals.js';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

function preferences(count: number, centres = [100]): ExternalPreference[] {
  return Array.from({ length: count }, (_, index) => ({
    external: {
      id: `e${index}`,
      label: `External ${String(index).padStart(2, '0')}`,
    },
    centres,
  }));
}

describe('bottom perimeter packing', () => {
  it('sorts centres before summing and counts every occurrence', () => {
    expect(preferredExternalX([10, 10, 100], 0)).toBe(40);
    expect(preferredExternalX([], 123)).toBe(123);
    expect(preferredExternalX([1e16, 1, -1e16], 0)).toBe(
      preferredExternalX([-1e16, 1e16, 1], 0),
    );
  });

  it.each([2, 3, 6, 18])(
    'packs %s equal preferences with bounded displacement and 30mm row pitch',
    (count) => {
      const packed = [
        ...packBottomExternals(preferences(count), 0, 300).values(),
      ];
      expect(new Set(packed.map((box) => box.yMm)).size).toBe(
        Math.ceil(count / 3),
      );
      for (const [i, box] of packed.entries()) {
        expect(box.widthMm).toBe(76.2);
        expect(box.heightMm).toBe(16);
        expect(box.yMm).toBe(300 + Math.floor(i / 3) * 30);
        expect(box.xMm + 38.1).toBeCloseTo(
          100 + ([0, -80.2, 80.2][i % 3] as number),
          8,
        );
        expect(Math.abs(box.xMm + 38.1 - 100)).toBeLessThanOrEqual(80.200001);
      }
    },
  );

  it('preserves accepted boxes and positions under source and external permutations', () => {
    const input = preferences(18).map((p, i) => ({
      ...p,
      centres: [i * 20, i * 20 + 5, i * 20],
    }));
    const first = packBottomExternals(input, 0, 300);
    const reversed = packBottomExternals(
      [...input]
        .reverse()
        .map((p) => ({ ...p, centres: [...p.centres].reverse() })),
      0,
      300,
    );
    expect([...first.entries()]).toEqual([...reversed.entries()]);
    const initial = packBottomExternals(input.slice(0, 8), 0, 300);
    for (const [id, rect] of initial) expect(first.get(id)).toEqual(rect);
    for (const [id, box] of first) {
      const preference = input.find((p) => p.external.id === id);
      if (!preference) throw new Error('Missing preference');
      expect(
        Math.abs(box.xMm + 38.1 - preferredExternalX(preference.centres, 0)),
      ).toBeLessThanOrEqual(80.200001);
    }
  });

  it('leaves widely separated devices at their preference and uses fallback for unreferenced externals', () => {
    const input = preferences(3).map((p, i) => ({
      ...p,
      centres: i === 2 ? [] : [i * 500],
    }));
    const boxes = [...packBottomExternals(input, 1000, 300).values()];
    expect(boxes.map((b) => b.xMm + 38.1)).toEqual([0, 500, 1000]);
    expect(boxes.every((b) => b.yMm === 300)).toBe(true);
  });

  it('ties by semantic UTF-16 key, including link target, rather than generated ID', () => {
    const input = ['z', 'A', '_'].map((target, i) => ({
      external: {
        id: `external-${i}`,
        label: 'Same',
        link: { style: 'wiki' as const, target },
      },
      centres: [100],
    }));
    const packed = packBottomExternals(input, 0, 300);
    expect([...packed.keys()]).toEqual([
      'external-1',
      'external-2',
      'external-0',
    ]);
  });

  it('prefers projected device centres and counts reversed repeated source occurrences', () => {
    const layout = resolve(
      parse(
        'rack "R" 6U\n4 device "Left" as a\n4 device "Right" as b\na -- [[Shared]]\n[[Shared]] -- a\nb -- [[Shared]]',
      ),
    );
    expect(layout.diagnostics).toEqual([]);
    const svg = toSvg(layout, { connectionRouting: 'perimeter' });
    const box = svg.match(/class="rackdown-external-box" x="([^"]+)"/);
    expect(Number(box?.[1]) + 38.1).toBeCloseTo((120.65 * 2 + 361.95) / 3, 3);
  });

  it.each(['direct', 'orthogonal', 'lanes'] as const)(
    'keeps %s source-order bottom positions and floor',
    (connectionRouting) => {
      const layout = resolve(
        parse(
          'rack "R" 4U\n4 switch "S" as s\ns -- [[Z]]\ns -- [[A]]\ns -- [[B]]\ns -- [[C]]',
        ),
      );
      const svg = toSvg(layout, { connectionRouting });
      const boxes = [
        ...svg.matchAll(
          /class="rackdown-external-box" x="([^"]+)" y="([^"]+)"/g,
        ),
      ].map((m) => [Number(m[1]), Number(m[2])]);
      expect(boxes).toEqual([
        [203.2, 190.5],
        [123, 190.5],
        [283.4, 190.5],
        [42.8, 190.5],
      ]);
    },
  );

  it('keeps right placement geometry identical across routing modes', () => {
    const layout = resolve(
      parse('rack "R" 4U\n4 switch "S" as s\ns -- [[Z]]\ns -- [[A]]'),
    );
    const boxes = (mode: 'direct' | 'perimeter') =>
      toSvg(layout, {
        connectionRouting: mode,
        externalPlacement: 'right',
      }).match(/class="rackdown-external-box"[^>]+/g);
    expect(boxes('perimeter')).toEqual(boxes('direct'));
  });

  it('keeps positions stable when source order regenerates external IDs', () => {
    const header =
      'rack "R" 6U views front rear\n4 device "Left" as a\n4 device "Right" as b\nrear 4 pdu "Rear" as rear';
    const lines = [
      'a -- [[Z]]',
      'a -- [[A]]',
      'b -- [[B]]',
      'rear -- [[Rear]]',
      'a -- [[Shared]]',
      'b -- [[Shared]]',
    ];
    const positions = (source: string) => {
      const svg = toSvg(resolve(parse(source)), {
        connectionRouting: 'perimeter',
      });
      return [
        ...svg.matchAll(
          /class="rackdown-external-group"[^>]*data-label="([^"]+)"[^>]*>\s*<title>[^<]*<\/title>\s*<rect[^>]* x="([^"]+)" y="([^"]+)"/g,
        ),
      ]
        .map((match) => [match[1], Number(match[2]), Number(match[3])])
        .sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
    };
    const first = positions(`${header}\n${lines.join('\n')}`);
    expect(first).toHaveLength(5);
    expect(positions(`${header}\n${[...lines].reverse().join('\n')}`)).toEqual(
      first,
    );
    expect(first.find(([label]) => label === 'Rear')?.[1]).toBeCloseTo(
      711.2,
      3,
    );
  });
});
