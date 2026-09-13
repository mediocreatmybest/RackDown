import { describe, expect, it } from 'vitest';
import type { DevicePortDefinition } from './devices.js';
import { parse } from './parser.js';
import { resolve } from './resolver.js';

const source =
  'rack "Rack" 4U\n4 switch "Core" as core\n3 server "Host" as host\n';

describe('connection structure', () => {
  it.each([
    ['core:"uplink--backup" -- host:nic1', 'uplink--backup'],
    ['host:nic1 -- core:"uplink--backup"', 'nic1'],
    ['core:"[[text--inside]]" -- host:"backup--port"', '[[text--inside]]'],
  ])('preserves quoted text: %s', (line, port) => {
    const result = parse(source + line);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.from).toMatchObject({ port });
    expect(result.diagnostics).toEqual([]);
  });

  it.each(['[[Building--B]]', '[[Building "B--C]]'])(
    'preserves external text: %s',
    (raw) => {
      const target = raw.slice(2, -2);
      const result = parse(`${source}core:1 -- ${raw}\n${raw} -- core:2`);
      expect(result.connections).toHaveLength(2);
      expect(result.connections[0]?.to).toEqual({
        kind: 'external',
        label: target,
        link: { style: 'wiki', target },
      });
      expect(result.connections[1]?.from).toEqual(result.connections[0]?.to);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it('rejects multiple structural operators and recovers the next line', () => {
    const result = parse(
      `${source}core:"a--b" -- host:nic1 -- [[Building--B]]\ncore:1 -- host:nic1`,
    );
    expect(result.connections).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        message:
          'Connection contains more than one `--` operator; ignoring it.',
      }),
    ]);
  });

  it.each([
    'core:1 -- host:"unfinished--port',
    'core:1 -- [[unfinished--target',
  ])('keeps destination recovery: %s', (line) => {
    const result = parse(source + line);
    expect(result.connections).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining('Unterminated'),
      }),
    ]);
  });

  it.each([
    ['core:port[[backup -- host:nic1', 'port[[backup', 'nic1'],
    ['host:nic1 -- core:port[[backup', 'nic1', 'port[[backup'],
    ['core:port[[backup]] -- host:nic1', 'port[[backup]]', 'nic1'],
    ['core:port[[backup]]extra -- host:nic1', 'port[[backup]]extra', 'nic1'],
    ['core:port[[ -- host:nic1', 'port[[', 'nic1'],
  ])(
    'does not let embedded bracket text swallow the structural operator: %s',
    (line, fromPort, toPort) => {
      const result = parse(source + line);
      expect(result.connections).toHaveLength(1);
      expect(result.connections[0]?.from).toMatchObject({ port: fromPort });
      expect(result.connections[0]?.to).toMatchObject({ port: toPort });
      expect(result.diagnostics).toEqual([]);
    },
  );

  it('supports adhoc modifier alongside embedded bracket text', () => {
    const result = parse(`${source}core:1 adhoc -- host:port[[backup`);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.from).toEqual({
      kind: 'device',
      device: 'core',
      port: '1',
      adHoc: true,
    });
    expect(result.connections[0]?.to).toEqual({
      kind: 'device',
      device: 'host',
      port: 'port[[backup',
    });
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'core:port[[backup -- host:nic1 -- [[Building--B]]',
    'core:1 -- host:port[[backup -- switch:2',
    '[[target1]] -- [[target2]] -- [[target3]]',
  ])(
    'rejects multiple structural operators with embedded bracket text: %s',
    (line) => {
      const result = parse(source + line);
      expect(result.connections).toHaveLength(0);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          message:
            'Connection contains more than one `--` operator; ignoring it.',
        }),
      ]);
    },
  );

  it('preserves semantic external reference for core:1 -- [[Remote Rack]]', () => {
    const result = parse(`${source}core:1 -- [[Remote Rack]]`);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.from).toEqual({
      kind: 'device',
      device: 'core',
      port: '1',
    });
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Remote Rack',
      link: { style: 'wiki', target: 'Remote Rack' },
    });
    expect(result.diagnostics).toEqual([]);
  });
});

describe('external endpoint syntax and link intent', () => {
  it('1. parses external "ISP Handover" with label and no link', () => {
    const result = parse(`${source}core:1 -- external "ISP Handover"`);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'ISP Handover',
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('2. plain external works on the left side', () => {
    const result = parse(`${source}external "ISP Handover" -- core:1`);
    expect(result.connections[0]?.from).toEqual({
      kind: 'external',
      label: 'ISP Handover',
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('3. plain external works on the right side', () => {
    const result = parse(`${source}core:1 -- external "ISP Handover"`);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'ISP Handover',
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('4. [[Target]] parses as wiki target with default label', () => {
    const result = parse(`${source}core:1 -- [[Infrastructure/Racks/Garage]]`);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Infrastructure/Racks/Garage',
      link: { style: 'wiki', target: 'Infrastructure/Racks/Garage' },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('5. [[Target|Label]] separates target and label', () => {
    const result = parse(
      `${source}core:1 -- [[Infrastructure/Racks/Garage|Garage Rack]]`,
    );
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Garage Rack',
      link: { style: 'wiki', target: 'Infrastructure/Racks/Garage' },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('6. relative wiki target [[../Garage|Garage Rack]] is preserved', () => {
    const result = parse(`${source}core:1 -- [[../Garage|Garage Rack]]`);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Garage Rack',
      link: { style: 'wiki', target: '../Garage' },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('7. [Label](Target) parses as Markdown style', () => {
    const result = parse(
      `${source}core:1 -- [Garage Rack](Infrastructure/Racks/Garage.md)`,
    );
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Garage Rack',
      link: { style: 'markdown', target: 'Infrastructure/Racks/Garage.md' },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('8. relative Markdown target is preserved', () => {
    const result = parse(`${source}core:1 -- [Garage Rack](../Garage.md)`);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Garage Rack',
      link: { style: 'markdown', target: '../Garage.md' },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('9. heading target is preserved', () => {
    const result = parse(
      `${source}core:1 -- [Switch Notes](Devices/Switch.md#Ports)`,
    );
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Switch Notes',
      link: { style: 'markdown', target: 'Devices/Switch.md#Ports' },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('10. HTTP URL is preserved', () => {
    const result = parse(
      `${source}core:1 -- [Vendor](http://example.com/device)`,
    );
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Vendor',
      link: { style: 'markdown', target: 'http://example.com/device' },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('11. HTTPS URL with query string is preserved', () => {
    const result = parse(
      `${source}core:1 -- [Vendor](https://example.com/device?id=42&view=ports)`,
    );
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Vendor',
      link: {
        style: 'markdown',
        target: 'https://example.com/device?id=42&view=ports',
      },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('12. empty plain external warns and rejects endpoint', () => {
    const result = parse(`${source}core:1 -- external ""`);
    expect(result.connections).toHaveLength(0);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: expect.stringContaining('External connection label is empty'),
      }),
    );
  });

  it('13. unterminated plain external quote recovers with warning', () => {
    const result = parse(`${source}core:1 -- external "ISP Handover`);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'ISP Handover',
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: expect.stringContaining('Unterminated quoted external label'),
      }),
    );
  });

  it('14. empty wiki target warns and rejects endpoint', () => {
    const result = parse(`${source}core:1 -- [[|Garage]]`);
    expect(result.connections).toHaveLength(0);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: expect.stringContaining('External connection target is empty'),
      }),
    );
  });

  it('15. empty wiki alias recovers to target label with warning', () => {
    const result = parse(`${source}core:1 -- [[Garage|]]`);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Garage',
      link: { style: 'wiki', target: 'Garage' },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: expect.stringContaining('External connection alias is empty'),
      }),
    );
  });

  it.each(['[Label]', '[Label]('])(
    '16. malformed Markdown link %s warns and rejects endpoint',
    (malformed) => {
      const result = parse(`${source}core:1 -- ${malformed}`);
      expect(result.connections).toHaveLength(0);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'warn',
          message: expect.stringContaining('Malformed Markdown link syntax'),
        }),
      );
    },
  );

  it('17. empty Markdown label warns and rejects endpoint', () => {
    const result = parse(`${source}core:1 -- [](Target)`);
    expect(result.connections).toHaveLength(0);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: expect.stringContaining('Markdown link label is empty'),
      }),
    );
  });

  it('18. empty Markdown target warns and rejects endpoint', () => {
    const result = parse(`${source}core:1 -- [Label]()`);
    expect(result.connections).toHaveLength(0);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: expect.stringContaining('Markdown link target is empty'),
      }),
    );
  });

  it('19. -- inside plain external label is not structural', () => {
    const result = parse(`${source}core:1 -- external "WAN -- provider"`);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'WAN -- provider',
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('20. -- inside wiki target/label is not structural', () => {
    const result = parse(
      `${source}core:1 -- [[Docs/ISP--Primary|ISP -- Primary]]`,
    );
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'ISP -- Primary',
      link: { style: 'wiki', target: 'Docs/ISP--Primary' },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('21. -- inside Markdown label is not structural', () => {
    const result = parse(
      `${source}[Source -- Docs](source--docs.md) -- core:1`,
    );
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.from).toEqual({
      kind: 'external',
      label: 'Source -- Docs',
      link: { style: 'markdown', target: 'source--docs.md' },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('22. -- inside Markdown target is not structural', () => {
    const result = parse(
      `${source}core:1 -- [ISP -- Primary](docs/isp--primary.md)`,
    );
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'ISP -- Primary',
      link: { style: 'markdown', target: 'docs/isp--primary.md' },
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('23. media after plain external remains media', () => {
    const result = parse(`${source}core:1 -- external "ISP Handover" fibre`);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'ISP Handover',
    });
    expect(result.connections[0]?.media).toBe('fibre');
    expect(result.diagnostics).toEqual([]);
  });

  it('24. media after wiki external remains media', () => {
    const result = parse(`${source}core:2 -- [[Garage|Garage Rack]] fibre`);
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Garage Rack',
      link: { style: 'wiki', target: 'Garage' },
    });
    expect(result.connections[0]?.media).toBe('fibre');
    expect(result.diagnostics).toEqual([]);
  });

  it('25. media after Markdown external remains media', () => {
    const result = parse(
      `${source}core:3 -- [Garage Rack](Infrastructure/Racks/Garage.md) fibre`,
    );
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Garage Rack',
      link: { style: 'markdown', target: 'Infrastructure/Racks/Garage.md' },
    });
    expect(result.connections[0]?.media).toBe('fibre');
    expect(result.diagnostics).toEqual([]);
  });

  it('26. existing quoted device ports remain unchanged', () => {
    const result = parse(`${source}core:"Gig-E 1" -- host:"Port 1"`);
    expect(result.connections[0]?.from).toMatchObject({
      kind: 'device',
      device: 'core',
      port: 'Gig-E 1',
    });
    expect(result.connections[0]?.to).toMatchObject({
      kind: 'device',
      device: 'host',
      port: 'Port 1',
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('27. existing [[Remote Rack]] behaviour remains backward-compatible', () => {
    const result = parse(`${source}core:1 -- [[Remote Rack]]`);
    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Remote Rack',
      link: { style: 'wiki', target: 'Remote Rack' },
    });
    expect(result.diagnostics).toEqual([]);
  });
});

describe('ambiguous endpoint metadata', () => {
  const cases: [string, DevicePortDefinition[], string][] = [
    [
      'labels',
      [
        { name: 'eth0', label: 'LAN' },
        { name: 'eth1', label: 'LAN' },
      ],
      'LAN',
    ],
    [
      'aliases',
      [
        { name: 'eth0', aliases: ['LAN'] },
        { name: 'eth1', aliases: ['LAN'] },
      ],
      'LAN',
    ],
    [
      'label/alias collision',
      [
        { name: 'eth0', label: 'LAN' },
        { name: 'eth1', aliases: ['LAN'] },
      ],
      'LAN',
    ],
    ['folded names', [{ name: 'ETH0' }, { name: 'eth0' }], 'Eth0'],
    [
      'folded labels/aliases',
      [
        { name: 'eth0', label: 'LAN' },
        { name: 'eth1', aliases: ['lan'] },
      ],
      'Lan',
    ],
    [
      'duplicate canonical names',
      [
        { name: 'eth0', type: '1000base-t' },
        { name: 'eth0', type: '10gbase-t' },
      ],
      'eth0',
    ],
  ];
  it.each(cases)(
    'preserves intent for %s regardless of catalogue order',
    (_name, ports, reference) => {
      for (const ordered of [ports, [...ports].reverse()]) {
        for (const modifier of ['', ' adhoc']) {
          const layout = resolve(
            parse(
              `rack "Rack" 4U\n4 vendor-device as gateway\ngateway:${reference}${modifier} -- [[External]]`,
            ),
            {
              'vendor-device': { slug: 'vendor-device', ports: ordered },
            },
          );
          expect(layout.connections).toHaveLength(1);
          expect(layout.connections[0]?.from).toMatchObject({
            portName: reference,
            adHocPort: true,
          });
          expect(layout.devices[0]?.ports).toContainEqual(
            expect.objectContaining({ name: reference, adHoc: true }),
          );
          expect(layout.diagnostics).toEqual([
            expect.objectContaining({
              severity: 'warn',
              message: expect.stringContaining('Ambiguous port'),
            }),
          ]);
        }
      }
    },
  );

  it('prefers a unique canonical name and counts each port only once', () => {
    const layout = resolve(
      parse(
        'rack "Rack" 4U\n4 vendor-device as gateway\ngateway:eth0 -- gateway:LAN',
      ),
      {
        'vendor-device': {
          slug: 'vendor-device',
          ports: [
            { name: 'eth0', label: 'LAN', aliases: ['LAN', 'LAN'] },
            { name: 'eth1', label: 'eth0', aliases: ['eth0'] },
          ],
        },
      },
    );
    expect(layout.connections[0]?.from).toMatchObject({
      portName: 'eth0',
      adHocPort: false,
    });
    expect(layout.connections[0]?.to).toMatchObject({
      portName: 'eth0',
      adHocPort: false,
    });
    expect(layout.diagnostics).toEqual([]);
  });

  it('bounds catalogue hints for ambiguous references', () => {
    const layout = resolve(
      parse(
        'rack "Rack" 4U\n4 vendor-device as gateway\ngateway:LAN -- [[External]]',
      ),
      {
        'vendor-device': {
          slug: 'vendor-device',
          ports: Array.from({ length: 20 }, (_, i) => ({
            name: `eth${i}`,
            label: 'LAN',
          })),
        },
      },
    );
    expect(layout.diagnostics).toHaveLength(1);
    expect(layout.diagnostics[0]?.hint).toContain('and 8 more');
    expect(layout.diagnostics[0]?.hint).not.toContain('eth12');
  });
});

describe('addressable device aliases', () => {
  it.each([
    '"two words"',
    '""',
    'core:1',
    'core--backup',
    '[[core]]',
    '//core',
    '"unfinished',
  ])('warns and preserves the placement for %s', (alias) => {
    const result = parse(
      `rack "Rack" 4U\n4 switch "Core" as ${alias}\nCore:1 -- [[External]]`,
    );
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]?.alias).toBeUndefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        message:
          'Alias cannot be addressed by a connection; ignoring the alias.',
      }),
    ]);
    expect(resolve(result).connections).toHaveLength(1);
  });

  it.each(['core-1', 'core_1', 'core.1', '123', 'rack', '"core-1"'])(
    'can reference accepted alias %s',
    (token) => {
      const alias = token.replaceAll('"', '');
      const layout = resolve(
        parse(
          `rack "Rack" 4U\n4 switch as ${token}\n${alias}:1 -- [[External]]`,
        ),
      );
      expect(layout.connections).toHaveLength(1);
      expect(layout.diagnostics).toEqual([]);
    },
  );
});
