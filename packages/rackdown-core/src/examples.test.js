import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SOURCE } from '../../../apps/playground/src/default-source.js';
import { deviceIndex } from '../../rackdown-devices/index.mjs';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

const here = dirname(fileURLToPath(import.meta.url));
const examplesRoot = join(here, '..', '..', '..', 'examples');

const CANONICAL_EXAMPLES = {
  'home-lab.rackdown': {
    useCatalogue: true,
    expectedRacks: 1,
    expectedDevices: 7,
    expectedConnections: 7,
    expectedExternals: 2,
    clean: true,
  },
  'routing.rackdown': {
    useCatalogue: false,
    expectedRacks: 2,
    expectedDevices: 8,
    expectedConnections: 8,
    expectedExternals: 1,
    clean: true,
  },
  'shared-rows.rackdown': {
    useCatalogue: false,
    expectedRacks: 1,
    expectedDevices: 6,
    expectedConnections: 6,
    expectedExternals: 1,
    clean: true,
  },
};

function examplePaths() {
  return readdirSync(examplesRoot)
    .filter((name) => name.endsWith('.rackdown'))
    .sort()
    .map((name) => ({ name, path: join(examplesRoot, name) }));
}

function assertSvgStructure(
  svg,
  { hasConnections = false, hasExternals = false } = {},
) {
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg).toContain('</svg>');
  expect(svg).toContain('viewBox=');
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('rackdown-rack');
  expect(svg).toContain('rackdown-device');
  if (hasConnections) {
    expect(svg).toContain('rackdown-connection');
  }
  if (hasExternals) {
    expect(svg).toContain('rackdown-external');
  }
}

describe('public examples CI canary suite', () => {
  const examples = examplePaths();

  it('enumerates all canonical example files', () => {
    const names = examples.map((e) => e.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'home-lab.rackdown',
        'routing.rackdown',
        'shared-rows.rackdown',
      ]),
    );
  });

  it('declares explicit canonical configuration for every discovered example file', () => {
    for (const example of examples) {
      expect(
        CANONICAL_EXAMPLES[example.name],
        `Missing CANONICAL_EXAMPLES entry for "${example.name}". Every public example must explicitly declare its contract.`,
      ).toBeDefined();
    }
  });

  for (const example of examples) {
    it(`${example.name} survives the full pipeline deterministically`, () => {
      const config = CANONICAL_EXAMPLES[example.name];
      expect(
        config,
        `Unconfigured example: ${example.name}. Every public example must explicitly declare its contract in CANONICAL_EXAMPLES.`,
      ).toBeDefined();

      const source = readFileSync(example.path, 'utf8');
      const catalogue = config.useCatalogue ? deviceIndex : {};

      const firstParsed = parse(source);
      const secondParsed = parse(source);

      const firstLayout = resolve(firstParsed, catalogue);
      const secondLayout = resolve(secondParsed, catalogue);

      expect(firstLayout.schemaVersion).toBe(2);
      expect(firstLayout.diagnostics).toEqual(secondLayout.diagnostics);

      const errors = firstLayout.diagnostics.filter(
        (diagnostic) => diagnostic.severity === 'error',
      );
      expect(errors).toEqual([]);

      if (config.clean) {
        expect(firstLayout.diagnostics).toEqual([]);
      }

      expect(firstLayout.racks.length).toBe(config.expectedRacks);
      expect(firstLayout.devices.length).toBe(config.expectedDevices);
      expect(firstLayout.connections.length).toBe(config.expectedConnections);
      expect(firstLayout.externals.length).toBe(config.expectedExternals);

      const firstSvg = toSvg(firstLayout, { namespace: example.name });
      const secondSvg = toSvg(secondLayout, { namespace: example.name });

      expect(firstSvg).toBe(secondSvg);
      assertSvgStructure(firstSvg, {
        hasConnections: config.expectedConnections > 0,
        hasExternals: config.expectedExternals > 0,
      });
    });
  }

  it('home-lab.rackdown renders without catalogue enrichment', () => {
    const example = examples.find((e) => e.name === 'home-lab.rackdown');
    expect(example).toBeDefined();

    const source = readFileSync(example.path, 'utf8');
    const layout = resolve(parse(source));

    const errors = layout.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toEqual([]);

    const warnings = layout.diagnostics.filter((d) => d.severity === 'warn');
    expect(warnings.length).toBeGreaterThan(0);
    expect(
      warnings.every((w) => w.message.includes('Unknown device definition')),
    ).toBe(true);

    expect(layout.racks.length).toBe(1);
    expect(layout.devices.length).toBe(7);
    expect(layout.connections.length).toBe(7);
    expect(layout.externals.length).toBe(2);

    const firstSvg = toSvg(layout, { namespace: 'home-lab-unenriched' });
    const secondSvg = toSvg(layout, { namespace: 'home-lab-unenriched' });
    expect(firstSvg).toBe(secondSvg);
    assertSvgStructure(firstSvg, {
      hasConnections: true,
      hasExternals: true,
    });
  });

  it('playground DEFAULT_SOURCE survives the full pipeline cleanly and deterministically', () => {
    const firstLayout = resolve(parse(DEFAULT_SOURCE), deviceIndex);
    const secondLayout = resolve(parse(DEFAULT_SOURCE), deviceIndex);

    expect(firstLayout.schemaVersion).toBe(2);
    expect(firstLayout.diagnostics).toEqual([]);
    expect(secondLayout.diagnostics).toEqual([]);

    expect(firstLayout.racks.length).toBe(1);
    expect(firstLayout.devices.length).toBe(5);
    expect(firstLayout.connections.length).toBe(3);
    expect(firstLayout.externals.length).toBe(1);

    const firstSvg = toSvg(firstLayout, { namespace: 'playground-default' });
    const secondSvg = toSvg(secondLayout, { namespace: 'playground-default' });

    expect(firstSvg).toBe(secondSvg);
    assertSvgStructure(firstSvg, {
      hasConnections: true,
      hasExternals: true,
    });
  });

  it('detects syntax or semantic diagnostics when an example is corrupted', () => {
    const validSource = readFileSync(examples[0].path, 'utf8');

    // Appending an unrecognised line introduces a diagnostic warning
    const withWarning = resolve(
      parse(`${validSource}\nunrecognised_syntax_here\n`),
      deviceIndex,
    );
    expect(withWarning.diagnostics.length).toBeGreaterThan(0);

    // Appending an invalid rack declaration introduces a hard error diagnostic
    const withError = resolve(
      parse(`${validSource}\nrack "Corrupt" 12.5U 19in\n`),
      deviceIndex,
    );
    const errors = withError.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });
});
