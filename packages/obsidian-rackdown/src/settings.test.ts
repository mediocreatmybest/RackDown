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
      theme: 'auto',
      sizing: 'responsive',
    });
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
