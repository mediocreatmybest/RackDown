import { describe, expect, it } from 'vitest';
import { renderRackDown } from './render-rackdown.js';

describe('renderRackDown', () => {
  it('renders valid source through the core pipeline', () => {
    const result = renderRackDown('rack "Lab" 12U\n10 switch "Core"');

    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('Lab');
    expect(result.svg).toContain('Core');
    expect(result.diagnostics).toEqual([]);
  });

  it('returns resolved device identity for host enrichment', () => {
    const result = renderRackDown(
      'rack "Lab" 12U\n10 switch "[[sw2222]]" as switch2222',
    );

    expect(result.devices).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        label: '[[sw2222]]',
      }),
    ]);
    expect(result.svg).toContain('[[sw2222]]');
  });

  it('uses host-provided device definitions during resolution', () => {
    const result = renderRackDown(
      'rack "Lab" 12U\n10 example-switch "Known"',
      undefined,
      {
        'example-switch': {
          slug: 'example-switch',
          manufacturer: 'Example',
          model: 'Switch 24',
          uHeight: 2,
        },
      },
    );

    expect(result.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Unknown device definition: example-switch',
        }),
      ]),
    );
    expect(result.svg).toContain('Known');
  });

  it('returns diagnostics and SVG for recoverable malformed source', () => {
    const result = renderRackDown('rack "Lab" 12U\nbanana');

    expect(result.svg).toContain('<svg');
    expect(result.svg).toContain('Lab');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warn',
          message: expect.stringContaining('Unrecognised RackDown statement'),
        }),
      ]),
    );
  });

  it('is deterministic for identical source and SVG options', () => {
    const source = 'rack "Lab" 12U\n10 switch "Core"';
    const options = { namespace: 'note-block-1' } as const;
    const first = renderRackDown(source, options);
    const second = renderRackDown(source, options);

    expect(first.svg).toContain('note-block-1');
    expect(first).toEqual(second);
  });

  it('preserves core forgiveness for unknown devices and endpoints', () => {
    const result = renderRackDown(
      'rack "Lab" 12U\n10 strange-box "Mystery" as mystery\n' +
        '9 switch "Core" as core\nmystery:banana -- core:toaster',
    );

    expect(result.svg).toContain('Mystery');
    expect(result.svg).toContain('Core');
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warn',
          message: 'Unknown device definition: strange-box',
        }),
      ]),
    );
  });

  it('preserves external targets in rendered SVG for host link decoration', () => {
    const result = renderRackDown(
      'rack "Lab" 12U\n10 switch "Core" as core\ncore:1 -- [[Remote Rack]]',
    );

    expect(result.svg).toContain('class="rackdown-external-group"');
    expect(result.svg).toContain('data-link-style="wiki"');
    expect(result.svg).toContain('data-label="Remote Rack"');
    expect(result.svg).toContain('data-target="Remote Rack"');
    expect(result.diagnostics).toEqual([]);
  });

  it('renders plain external metadata as non-link with no data-target', () => {
    const result = renderRackDown(
      'rack "Lab" 12U\n10 switch "Core" as core\ncore:1 -- external "ISP Handover"',
    );

    expect(result.svg).toContain('class="rackdown-external-group"');
    expect(result.svg).toContain('data-link-style="none"');
    expect(result.svg).toContain('data-label="ISP Handover"');
    expect(result.svg).not.toContain('data-target=');
    expect(result.diagnostics).toEqual([]);
  });

  it('renders wiki metadata separating label from target', () => {
    const result = renderRackDown(
      'rack "Lab" 12U\n10 switch "Core" as core\ncore:1 -- [[Infrastructure/Racks/Garage|Garage Rack]]',
    );

    expect(result.svg).toContain('data-link-style="wiki"');
    expect(result.svg).toContain('data-label="Garage Rack"');
    expect(result.svg).toContain('data-target="Infrastructure/Racks/Garage"');
    expect(result.diagnostics).toEqual([]);
  });

  it('renders Markdown metadata separating label from target', () => {
    const result = renderRackDown(
      'rack "Lab" 12U\n10 switch "Core" as core\ncore:1 -- [Garage Rack](Infrastructure/Racks/Garage.md)',
    );

    expect(result.svg).toContain('data-link-style="markdown"');
    expect(result.svg).toContain('data-label="Garage Rack"');
    expect(result.svg).toContain(
      'data-target="Infrastructure/Racks/Garage.md"',
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('preserves wikilink whole-device labels such as [[PVE01]] and [[target|display]]', () => {
    const result = renderRackDown(
      'rack "Lab" 12U\n' +
        '10 server "[[PVE01]]" as pve1\n' +
        '8 switch "[[Switches/sw2222|Access Switch 22]]" as sw1',
    );

    expect(result.devices).toEqual([
      expect.objectContaining({
        id: expect.any(String),
        label: '[[PVE01]]',
      }),
      expect.objectContaining({
        id: expect.any(String),
        label: '[[Switches/sw2222|Access Switch 22]]',
      }),
    ]);
    expect(result.svg).toContain('[[PVE01]]');
    expect(result.svg).toContain('[[Switches/sw2222|Access Switch 22]]');
    expect(result.diagnostics).toEqual([]);
  });
});
