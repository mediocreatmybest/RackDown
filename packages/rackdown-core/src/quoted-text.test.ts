import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

const source = 'rack "Rack" 4U\n4 device "Core" as core\n';

describe('quoted source text', () => {
  it.each([
    ['Legacy label, 19in', 'Legacy label, 19in'],
    [String.raw`19\" shelf, \"A\"`, '19" shelf, "A"'],
    [String.raw`C:\\Rack\\Archive`, String.raw`C:\Rack\Archive`],
    [
      String.raw`C:\Rack\new\tabs\u0041\q\/\-`,
      String.raw`C:\Rack\new\tabs\u0041\q\/\-`,
    ],
    [String.raw`Panel \"A\" -- \\ uplink`, String.raw`Panel "A" -- \ uplink`],
    [String.raw`A\\\"--B`, String.raw`A\"--B`],
    [String.raw`C:\\`, 'C:\\'],
    [String.raw`A\\\\`, String.raw`A\\`],
  ])('decodes %s consistently across supported fields', (authored, value) => {
    const quoted = `"${authored}"`;
    const document = parse(
      [
        `rack ${quoted} 4U`,
        `4 device ${quoted}as shelf`,
        '3 device as spare',
        `shelf:${quoted} -- external ${quoted} fibre category network`,
        `external${quoted} -- shelf:${quoted} adhoc fibre category console`,
      ].join('\n'),
    );
    expect(document.racks[0]?.name).toBe(value);
    expect(document.devices[0]).toMatchObject({
      label: value,
      alias: 'shelf',
      explicitLabel: true,
    });
    expect(document.connections).toHaveLength(2);
    expect(document.connections[0]?.from).toMatchObject({
      kind: 'device',
      device: 'shelf',
      port: value,
    });
    expect(document.connections[0]?.to).toEqual({
      kind: 'external',
      label: value,
    });
    expect(document.connections[0]).toMatchObject({
      media: 'fibre',
      category: 'network',
    });
    expect(document.connections[1]?.from).toEqual({
      kind: 'external',
      label: value,
    });
    expect(document.connections[1]?.to).toMatchObject({
      kind: 'device',
      device: 'shelf',
      port: value,
      adHoc: true,
    });
    expect(document.connections[1]).toMatchObject({
      media: 'fibre',
      category: 'console',
    });
    expect(document.diagnostics).toEqual([]);
  });

  it('preserves optional and restricted aliases after decoding quoted text', () => {
    const document = parse(String.raw`rack "Rack" 4U
4 device "Shelf \"A\""
3 device "Shelf \"B\""as "core"
2 device "Shelf \"C\"" as "bad\"alias"
1 device "Shelf \"D\"" as "two words"`);
    expect(document.devices.map(({ alias }) => alias)).toEqual([
      undefined,
      'core',
      undefined,
      undefined,
    ]);
    expect(document.devices.map(({ label }) => label)).toEqual([
      'Shelf "A"',
      'Shelf "B"',
      'Shelf "C"',
      'Shelf "D"',
    ]);
    expect(document.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 4,
        message:
          'Alias cannot be addressed by a connection; ignoring the alias.',
      }),
      expect.objectContaining({
        severity: 'warn',
        line: 5,
        message:
          'Alias cannot be addressed by a connection; ignoring the alias.',
      }),
    ]);
  });

  it('retains duplicate alias diagnostics', () => {
    const layout = resolve(
      parse(String.raw`rack "Rack" 4U
4 device "Shelf \"A\"" as shelf
3 device "Shelf \"B\""as shelf`),
    );
    expect(layout.devices.map(({ alias }) => alias)).toEqual([
      'shelf',
      'shelf',
    ]);
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 3,
        message: 'Duplicate device alias: shelf',
      }),
    ]);
  });

  it('decodes quoted aliases while preserving literal unquoted aliases in connections', () => {
    const layout = resolve(
      parse(String.raw`rack "Rack" 4U
4 device "Core" as "core\\backup"
3 device "Spare" as spare\\backup
core\backup:1 -- spare\\backup:1`),
    );
    expect(layout.devices.map(({ alias }) => alias)).toEqual([
      String.raw`core\backup`,
      String.raw`spare\\backup`,
    ]);
    expect(layout.connections).toHaveLength(1);
    expect(layout.connections[0]?.from).toMatchObject({
      deviceId: 'device-2',
      portName: '1',
    });
    expect(layout.connections[0]?.to).toMatchObject({
      deviceId: 'device-3',
      portName: '1',
    });
    expect(layout.diagnostics).toEqual([]);
  });

  it.each([
    [
      String.raw`  rack "Rack \"A\"" 4U extra`,
      'Ignoring unsupported rack text: extra',
    ],
    [
      String.raw`  3 device "Shelf \"A\""as shelf extra`,
      'Ignoring unsupported device text: extra',
    ],
  ])('keeps raw token columns after escaped text: %s', (line, message) => {
    const document = parse(source + line);
    expect(document.diagnostics).toEqual([
      { severity: 'warn', line: 3, column: line.indexOf('extra') + 1, message },
    ]);
  });

  it('keeps connection spans and trailing diagnostic columns after decoding', () => {
    const line = String.raw`  core:"Port \"A\"" adhoc -- external "WAN \"B\"" fibre category wrong`;
    const document = parse(source + line);
    expect(document.connections[0]?.from).toMatchObject({
      port: 'Port "A"',
      adHoc: true,
    });
    expect(document.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'WAN "B"',
    });
    expect(document.connections[0]?.media).toBe('fibre');
    expect(document.connections[0]?.category).toBe('invalid');
    expect(document.connections[0]?.source).toEqual({
      start: { line: 3, column: 3 },
      end: { line: 3, column: line.length + 1 },
    });
    expect(document.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 3,
        column: line.indexOf('wrong') + 1,
        message:
          'Missing or unknown connection category; preserving connection as unclassified.',
      },
    ]);
  });

  it('still requires exactly one structural operator outside escaped quoted content', () => {
    const line = String.raw`  core:"Port \"A--B\"" -- external "WAN \"C--D\"" -- core:2`;
    const document = parse(source + line);
    expect(document.connections).toEqual([]);
    expect(document.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 3,
        column: line.indexOf(' -- ') + 2,
        message:
          'Connection contains more than one `--` operator; ignoring it.',
        hint: 'Use exactly one `--` between two endpoints.',
      },
    ]);
  });

  it('diagnoses an unterminated escaped rack name and parses following statements', () => {
    const line = String.raw`  rack "Rack \"A\"`;
    const document = parse(`${line}\nrack "Good" 4U\n4 device "Good" as good`);
    expect(document.racks).toHaveLength(1);
    expect(document.racks[0]?.name).toBe('Good');
    expect(document.devices[0]?.alias).toBe('good');
    expect(document.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 1,
        column: line.indexOf('"') + 1,
        message: 'Unterminated quoted rack name; recovered to end of line.',
      },
      {
        severity: 'error',
        line: 1,
        column: line.length + 1,
        message: 'Rack height is missing or invalid.',
        hint: 'Specify a positive rack height such as 42U.',
      },
    ]);
  });

  it('recovers an unterminated escaped device label without inventing an alias', () => {
    const line = String.raw`  3 device "Shelf \"A\" as shelf`;
    const document = parse(`${source}${line}\n2 device "Next" as next`);
    expect(document.devices[1]?.label).toBe('Shelf "A" as shelf');
    expect(document.devices[1]?.alias).toBeUndefined();
    expect(document.devices[2]?.alias).toBe('next');
    expect(document.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 3,
        column: line.indexOf('"') + 1,
        message: 'Unterminated quoted device label; recovered to end of line.',
      },
    ]);
  });

  it.each([
    [
      `${String.raw`core:"Port \"A\" -- Backup`}\\`,
      'port',
      'Port "A" -- Backup\\',
      'connection port',
    ],
    [
      `${String.raw`external "WAN \"B\" -- Provider`}\\`,
      'label',
      'WAN "B" -- Provider\\',
      'external label',
    ],
  ])(
    'recovers unterminated %s without losing a final backslash',
    (endpoint, field, value, description) => {
      const line = `  core:1 -- ${endpoint}`;
      const document = parse(`${source}${line}\ncore:1 -- core:2`);
      expect(document.connections).toHaveLength(2);
      expect(document.connections[0]?.to).toMatchObject({ [field]: value });
      expect(document.connections[0]).not.toHaveProperty('media');
      expect(document.connections[0]).not.toHaveProperty('category');
      expect(document.diagnostics).toEqual([
        {
          severity: 'warn',
          line: 3,
          column: line.indexOf('"') + 1,
          message: `Unterminated quoted ${description}; recovered to end of line.`,
        },
      ]);
    },
  );

  it('does not guess an operator in an unterminated source quote', () => {
    const document = parse(source + String.raw`core:"Port \"A\" -- core:1`);
    expect(document.connections).toEqual([]);
    expect(document.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 3,
        message: 'Connection has no structural `--` operator; ignoring it.',
      },
    ]);
  });

  it('keeps Markdown and wiki text separate from quoted-text decoding', () => {
    const target = String.raw`https://example.com/A\)--B?path=\\notes`;
    const document = parse(
      `${source}core:1 -- [Docs \\"A\\"](${target})\ncore:2 -- [[Notes\\\\Archive|Wiki \\"B\\"]]`,
    );
    expect(document.connections[0]?.to).toEqual({
      kind: 'external',
      label: String.raw`Docs \"A\"`,
      link: { style: 'markdown', target },
    });
    expect(document.connections[1]?.to).toEqual({
      kind: 'external',
      label: String.raw`Wiki \"B\"`,
      link: { style: 'wiki', target: String.raw`Notes\\Archive` },
    });
    expect(document.diagnostics).toEqual([]);
  });

  it('preserves unquoted ports alongside quoted device references', () => {
    const document = parse(
      `${source}core:port\\\\raw -- core:plain\n"Core":1 -- core:2`,
    );
    expect(document.connections[0]?.from).toMatchObject({
      kind: 'device',
      device: 'core',
      port: String.raw`port\\raw`,
    });
    expect(document.connections[1]?.from).toMatchObject({
      kind: 'device',
      device: 'Core',
      port: '1',
    });
    const layout = resolve(document);
    expect(layout.connections).toHaveLength(2);
    expect(layout.diagnostics).toEqual([]);
  });

  it('resolves decoded ports and produces deterministic layout and SVG metadata', () => {
    const input = String.raw`rack "Rack \"A\"" 4U
4 example-device "19\" shelf \\ storage"as shelf
shelf:"Port \"A\" \\ uplink" -- external "WAN \"B\" \\ handover"`;
    const devices = {
      'example-device': {
        slug: 'example-device',
        ports: [{ name: 'Port "A" \\ uplink', kind: 'interface' }],
      },
    };
    const layout = resolve(parse(input), devices);
    expect(layout.racks[0]?.name).toBe('Rack "A"');
    expect(layout.devices[0]).toMatchObject({
      label: '19" shelf \\ storage',
      alias: 'shelf',
    });
    expect(layout.connections[0]?.from).toMatchObject({
      portName: 'Port "A" \\ uplink',
      adHocPort: false,
    });
    expect(layout.connections[0]?.category).toBe('network');
    expect(layout.connections[0]).not.toHaveProperty('media');
    expect(layout.diagnostics).toEqual([]);
    expect(resolve(parse(input), devices)).toEqual(layout);
    const svg = toSvg(layout, { namespace: 'quoted-text' });
    expect(svg).toContain('<title>19&quot; shelf \\ storage</title>');
    expect(svg).toContain('data-label="WAN &quot;B&quot; \\ handover"');
    expect(
      toSvg(resolve(parse(input), devices), { namespace: 'quoted-text' }),
    ).toBe(svg);
  });
});
