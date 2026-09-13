import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

interface ExternalPosition {
  x: number;
  y: number;
}

function externalPosition(svg: string, target: string): ExternalPosition {
  const match = svg.match(
    new RegExp(
      `data-target="${target}"[^>]*>\\s*<title>[^<]*</title>\\s*<rect[^>]* x="([^"]+)" y="([^"]+)"`,
    ),
  );
  if (!match?.[1] || !match[2]) {
    throw new Error(`SVG is missing external position for ${target}`);
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

const FIVE_EXTERNALS = `rack "Rack" 4U
4 switch "Core" as core
core:1 -- [[External A]]
core:2 -- [[External B]]
core:3 -- [[External C]]
core:4 -- [[External D]]
core:5 -- [[External E]]`;

describe('external annotation placement', () => {
  it('fans bottom externals centre, left, right, farther left, farther right', () => {
    const svg = toSvg(resolve(parse(FIVE_EXTERNALS)), {
      namespace: 'bottom-fan',
      externalPlacement: 'bottom',
    });
    const positions = [
      'External A',
      'External B',
      'External C',
      'External D',
      'External E',
    ].map((target) => externalPosition(svg, target));
    const [centre, left, right, fartherLeft, fartherRight] = positions;
    if (!centre || !left || !right || !fartherLeft || !fartherRight) {
      throw new Error('Fixture is missing external positions');
    }

    expect(positions.every((position) => position.y === centre.y)).toBe(true);
    expect(left.x).toBeLessThan(centre.x);
    expect(right.x).toBeGreaterThan(centre.x);
    expect(fartherLeft.x).toBeLessThan(left.x);
    expect(fartherRight.x).toBeGreaterThan(right.x);
    expect(centre.x - left.x).toBeCloseTo(right.x - centre.x, 3);
    expect(left.x - fartherLeft.x).toBeCloseTo(fartherRight.x - right.x, 3);
  });

  it('keeps the first bottom external fixed as more externals are added', () => {
    const one = toSvg(
      resolve(
        parse(
          `rack "Rack" 4U\n4 switch "Core" as core\ncore:1 -- [[External A]]`,
        ),
      ),
      { namespace: 'one-bottom', externalPlacement: 'bottom' },
    );
    const five = toSvg(resolve(parse(FIVE_EXTERNALS)), {
      namespace: 'five-bottom',
      externalPlacement: 'bottom',
    });

    expect(externalPosition(five, 'External A').x).toBeCloseTo(
      externalPosition(one, 'External A').x,
      3,
    );
  });

  it('keeps right-side externals stacked top to bottom', () => {
    const svg = toSvg(resolve(parse(FIVE_EXTERNALS)), {
      namespace: 'right-stack',
      externalPlacement: 'right',
    });
    const positions = ['External A', 'External B', 'External C'].map((target) =>
      externalPosition(svg, target),
    );
    const [first, second, third] = positions;
    if (!first || !second || !third) {
      throw new Error('Fixture is missing right-side external positions');
    }

    expect(second.x).toBe(first.x);
    expect(third.x).toBe(first.x);
    expect(second.y).toBeGreaterThan(first.y);
    expect(third.y).toBeGreaterThan(second.y);
  });
});
