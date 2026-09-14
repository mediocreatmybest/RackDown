import type { SvgRenderOptions } from '@rackdown/core';
import { describe, expect, it } from 'vitest';
import { renderRackDown } from './render-rackdown.js';
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  ROUTING_CHOICES,
  resolveObsidianRenderOptions,
  THEME_CHOICES,
} from './settings.js';

const SOURCE = `rack "Lab" 12U
10 switch "Core" as core
8 server "Server" as server
core:1 -- server:1
core:2 -- [[Remote]]`;

describe('settings normalization', () => {
  it.each([undefined, null, false, 'direct', [], 42, {}])(
    'uses defaults for missing or malformed data: %j',
    (data) => expect(normalizeSettings(data)).toEqual(DEFAULT_SETTINGS),
  );

  it('merges partial older data without retaining unknown settings', () => {
    expect(normalizeSettings({ routing: 'lanes', oldSetting: true })).toEqual({
      ...DEFAULT_SETTINGS,
      routing: 'lanes',
    });
  });

  it.each([
    ['routing', 'banana'],
    ['routing', 'toString'],
    ['externalPlacement', 'left'],
    ['connectionColourMode', 'rainbow'],
    ['theme', 'none'],
    ['theme', 'sepia'],
    ['theme', null],
  ])('falls back independently for invalid %s=%s', (key, value) => {
    const valid = {
      ...DEFAULT_SETTINGS,
      routing: 'direct',
      externalPlacement: 'right',
      connectionColourMode: 'monochrome',
      theme: 'dark',
    };
    expect(normalizeSettings({ ...valid, [key as string]: value })).toEqual({
      ...valid,
      [key as string]: DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS],
    });
  });

  it.each([
    [undefined, 2],
    [null, 2],
    ['3', 2],
    [false, 2],
    [{}, 2],
    [[], 2],
    [Number.NaN, 2],
    [Number.POSITIVE_INFINITY, 2],
    [Number.NEGATIVE_INFINITY, 2],
    [-1, 1],
    [0, 1],
    [1, 1],
    [4, 4],
    [5, 4],
    [2.75, 2.75],
    [2.13, 2.13],
  ])('normalizes thickness %s to %s', (connectionThickness, expected) => {
    expect(normalizeSettings({ connectionThickness }).connectionThickness).toBe(
      expected,
    );
  });

  it('exposes all supported routing methods and only three host themes', () => {
    expect(ROUTING_CHOICES).toEqual({
      perimeter: 'Perimeter',
      direct: 'Direct',
      orthogonal: 'Orthogonal',
      lanes: 'Lanes',
    });
    expect(THEME_CHOICES).toEqual({
      auto: 'Auto',
      light: 'Light',
      dark: 'Dark',
    });
  });
});

describe('Obsidian render option resolution', () => {
  it('resolves all defaults explicitly', () => {
    expect(resolveObsidianRenderOptions()).toEqual({
      connectionRouting: 'perimeter',
      externalPlacement: 'bottom',
      connectionColourMode: 'auto',
      connectionStyle: { width: 2 },
      theme: 'auto',
      sizing: 'responsive',
    });
  });

  it('forwards thickness without flattening explicit connection styles', () => {
    const settings = normalizeSettings({ connectionThickness: 3 });
    const options: SvgRenderOptions = {
      namespace: 'width-check',
      connectionStyle: { color: '#123456', opacity: 0.6, pattern: 'dotted' },
    };
    const resolved = resolveObsidianRenderOptions(options, settings);
    expect(resolved.connectionStyle).toEqual({
      ...options.connectionStyle,
      width: 3,
    });
    expect(options.connectionStyle).not.toHaveProperty('width');
    const first = renderRackDown(SOURCE, options, {}, settings).svg;
    const id = first.match(/data-connection-id="([^"]+)"/)?.[1] as string;
    expect(
      first
        .match(/<(?:path|line) [^>]*data-connection-id="[^"]+"[^>]*>/g)
        ?.every((path) => path.includes('stroke-width="3"')),
    ).toBe(true);

    const explicit: SvgRenderOptions = {
      ...options,
      connectionStyle: { ...options.connectionStyle, width: 1.5 },
      connectionStyles: { [id]: { width: 3.75, pattern: 'dashed' } },
      theme: 'light',
    };
    expect(resolveObsidianRenderOptions(explicit, settings)).toMatchObject(
      explicit,
    );
    expect(
      resolveObsidianRenderOptions(explicit, settings).connectionStyles,
    ).toBe(explicit.connectionStyles);
    const svg = renderRackDown(SOURCE, explicit, {}, settings).svg;
    const paths =
      svg.match(/<(?:path|line) [^>]*data-connection-id="[^"]+"[^>]*>/g) ?? [];
    expect(
      paths.find((path) => path.includes(`data-connection-id="${id}"`)),
    ).toContain('stroke-width="3.75"');
    expect(
      paths.find((path) => !path.includes(`data-connection-id="${id}"`)),
    ).toContain('stroke-width="1.5"');
    expect(svg).toContain('stroke="#123456"');
    expect(svg).toContain('stroke-opacity="0.6"');
    expect(first).not.toContain('rackdown-connection-hit');
  });

  it.each(['direct', 'orthogonal', 'lanes', 'perimeter'] as const)(
    'passes global %s routing to the renderer',
    (routing) => {
      const { svg } = renderRackDown(
        SOURCE,
        undefined,
        {},
        normalizeSettings({ routing }),
      );
      expect(svg).toContain(`data-connection-routing="${routing}"`);
      expect(svg).toContain(`data-routing="${routing}"`);
    },
  );

  it.each(['bottom', 'right'] as const)(
    'forwards %s external placement',
    (externalPlacement) => {
      const { svg } = renderRackDown(
        SOURCE,
        undefined,
        {},
        normalizeSettings({ externalPlacement }),
      );
      expect(svg).toContain(`data-external-placement="${externalPlacement}"`);
      expect(svg).toContain(`data-placement="${externalPlacement}"`);
    },
  );

  it.each(['auto', 'monochrome'] as const)(
    'forwards %s connection colour',
    (connectionColourMode) => {
      const { svg } = renderRackDown(
        SOURCE,
        undefined,
        {},
        normalizeSettings({ connectionColourMode }),
      );
      expect(svg).toContain(
        `data-connection-colour-mode="${connectionColourMode}"`,
      );
      expect(svg).toContain(`data-colour-source="${connectionColourMode}"`);
    },
  );

  it.each(['auto', 'light', 'dark'] as const)('forwards %s theme', (theme) => {
    const { svg } = renderRackDown(
      SOURCE,
      undefined,
      {},
      normalizeSettings({ theme }),
    );
    expect(svg).toContain('<style>');
    expect(svg.includes('@media (prefers-color-scheme: dark)')).toBe(
      theme === 'auto',
    );
    expect(svg.includes('#1e293b')).toBe(theme !== 'light');
  });

  it.each(['pixels', 'physical', 'responsive', undefined] as const)(
    'always uses responsive sizing, even when caller requests %s',
    (sizing) => {
      const options = sizing ? { sizing } : undefined;
      expect(resolveObsidianRenderOptions(options).sizing).toBe('responsive');
      const root = renderRackDown(SOURCE, options).svg.match(
        /<svg\b[^>]*>/,
      )?.[0];
      expect(root).toContain('viewBox=');
      expect(root).not.toMatch(/\s(?:width|height)=/);
    },
  );

  it('does not let undefined properties erase host defaults or namespace', () => {
    const options = {
      connectionRouting: undefined,
      theme: undefined,
      namespace: 'stable-block',
    } as unknown as SvgRenderOptions;
    expect(resolveObsidianRenderOptions(options)).toMatchObject({
      connectionRouting: 'perimeter',
      theme: 'auto',
      namespace: 'stable-block',
    });
    expect(
      resolveObsidianRenderOptions(
        options,
        normalizeSettings({ routing: 'lanes' }),
      ).connectionRouting,
    ).toBe('lanes');
    expect(renderRackDown(SOURCE, options).svg).toContain(
      'data-connection-routing="perimeter"',
    );
  });

  it('retains explicit render options and rejects an omitted stylesheet', () => {
    expect(
      resolveObsidianRenderOptions(
        { connectionRouting: 'direct', theme: 'none' },
        normalizeSettings({ routing: 'lanes', theme: 'dark' }),
      ),
    ).toMatchObject({ connectionRouting: 'direct', theme: 'dark' });
  });
});
