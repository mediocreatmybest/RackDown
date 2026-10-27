import { describe, expect, it } from 'vitest';
import type { DeviceIndex, RackDocument, RackLayout } from './index.js';
import {
  buildCableSchedule,
  parse,
  resolve,
  selectConnections,
  toSvg,
} from './index.js';

const header =
  'rack "Lab" 8U views front rear\n8 switch "Core" as core\n5 server "Host" as host';
const catalogue: DeviceIndex = {
  switch: { slug: 'switch', ports: [{ name: '1', kind: 'interface' }] },
  server: { slug: 'server', ports: [{ name: '1', kind: 'interface' }] },
};

function texts(source: string) {
  return resolve(parse(source)).notes?.map((note) => note.text);
}

describe('optional notes', () => {
  it('preserves four forms, exact inline owners, duplicates and authored order', () => {
    const source = `notes for host "forward"
rack "Lab" 8U views front rear
8 switch "Same" as core notes "first" notes "first"
5 server "Same" as host notes "host"
core:1 -- host:1 fibre category network notes "link one"
core:1 -- host:1 notes "link two"
notes at 3 "empty"
notes at rear 3.5 "rear"
notes for core "last"`;
    const doc = parse(source);
    const layout = resolve(doc);
    expect(doc.diagnostics).toEqual([]);
    expect(layout.diagnostics).toEqual([]);
    expect(layout.notes?.map((n) => n.text)).toEqual([
      'forward',
      'first',
      'first',
      'host',
      'link one',
      'link two',
      'empty',
      'rear',
      'last',
    ]);
    expect(layout.notes?.map((n) => n.target)).toEqual([
      { kind: 'device', deviceId: 'device-4' },
      { kind: 'device', deviceId: 'device-3' },
      { kind: 'device', deviceId: 'device-3' },
      { kind: 'device', deviceId: 'device-4' },
      { kind: 'connection', connectionId: 'connection-5' },
      { kind: 'connection', connectionId: 'connection-6' },
      {
        kind: 'rack-position',
        rackId: 'rack-2',
        positionU: 3,
        mountFace: 'front',
      },
      {
        kind: 'rack-position',
        rackId: 'rack-2',
        positionU: 3.5,
        mountFace: 'rear',
      },
      { kind: 'device', deviceId: 'device-3' },
    ]);
    expect(doc.notes?.[0]?.target).toMatchObject({
      kind: 'device-reference',
      reference: 'host',
      referenceSource: { line: 1, column: 11 },
    });
    expect(new Set(doc.notes?.map((n) => n.id)).size).toBe(9);
    expect(parse(source)).toEqual(doc);
    expect(resolve(doc)).toEqual(layout);
  });

  it.each([
    '8 switch',
    '8 "Generic"',
    'rear 8 "Generic"',
    '8 switch "Core" as core',
  ])('accepts a suffix after %s', (placement) => {
    const doc = parse(
      `rack "Lab" 8U views front rear\n${placement} NoTeS "annotation"`,
    );
    expect(doc.diagnostics).toEqual([]);
    expect(doc.notes?.[0]?.target).toEqual({
      kind: 'device',
      deviceId: 'device-2',
    });
    expect(
      texts(`rack "Lab" 8U views front rear\n${placement} NoTeS "annotation"`),
    ).toEqual(['annotation']);
  });

  it('decodes only existing escapes and preserves raw columns, comments and long text', () => {
    const line = String.raw`  8 switch "C\"ore" as core notes "A\"B\\C\n -- // notes as adhoc category [[x]] [x](y) Ω" notes "second" // comment`;
    const doc = parse(`rack "Lab" 8U\n${line}`);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.notes?.[0]?.text).toBe(
      String.raw`A"B\C\n -- // notes as adhoc category [[x]] [x](y) Ω`,
    );
    const first = line.indexOf('notes "');
    const second = line.lastIndexOf('notes "');
    expect(doc.notes?.[0]?.source).toEqual({
      start: { line: 2, column: first + 1 },
      end: { line: 2, column: second },
    });
    expect(doc.notes?.[1]?.source.start).toEqual({
      line: 2,
      column: second + 1,
    });
    const longText = 'Ω'.repeat(20_000);
    expect(texts(`${header}\nnotes for host "${longText}"`)).toEqual([
      longText,
    ]);
  });

  it('reuses exact alias, exact/folded label and exact/folded type precedence', () => {
    const source = `rack "Lab" 12U
12 switch "alias target" as chosen
10 server "chosen"
8 router "EXACT"
6 shelf "exact"
4 firewall "Other"
2 DEVICE "Generic"
notes for chosen "alias"
notes for EXACT "exact label"
notes for ExAcT "ambiguous folded label"
notes for firewall "exact type"
notes for device "folded type"`;
    const layout = resolve(parse(source));
    expect(layout.notes?.map((n) => n.target)).toEqual([
      { kind: 'device', deviceId: 'device-2' },
      { kind: 'device', deviceId: 'device-4' },
      { kind: 'device', deviceId: 'device-6' },
      { kind: 'device', deviceId: 'device-7' },
    ]);
    expect(layout.diagnostics).toContainEqual(
      expect.objectContaining({
        line: 10,
        column: 11,
        message: 'Ambiguous device reference: ExAcT',
        hint: expect.stringContaining('Use a unique alias or reference.'),
      }),
    );
  });

  it('matches connection ambiguity hints across racks and keeps unresolved intent', () => {
    const source = `rack "A" 8U\n8 switch "Same" as a\nrack "B" 8U\n8 switch "Same" as b\n  notes for "Same" "ambiguous"\nnotes for missing "unresolved"\n"Same" -- a`;
    const doc = parse(source);
    const layout = resolve(doc);
    expect(doc.notes).toHaveLength(2);
    expect(layout.notes).toBeUndefined();
    const ambiguous = layout.diagnostics.filter(
      (d) => d.message === 'Ambiguous device reference: Same',
    );
    expect(ambiguous).toHaveLength(2);
    expect(ambiguous[0]?.hint).toBe(ambiguous[1]?.hint);
    expect(ambiguous.find((d) => d.line === 5)?.column).toBe(13);
    expect(layout.diagnostics).toContainEqual(
      expect.objectContaining({
        line: 6,
        column: 11,
        message: 'Unresolved device reference: missing',
      }),
    );
  });

  it('does not reserve device types, aliases, references, labels or media named notes', () => {
    const doc = parse(`rack "Lab" 8U
8 notes "Archive" as archive
6 switch "notes" as notes
4 server "Host" as host
notes:1 -- host:1 notes
notes -- host notes category network
notes -- host notes notes "annotation"
notes for notes "device annotation"`);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.devices[0]?.deviceType).toBe('notes');
    expect(doc.connections.map((c) => c.media)).toEqual([
      'notes',
      'notes',
      'notes',
    ]);
    expect(doc.connections[1]?.category).toBe('network');
    expect(texts(`rack "Lab" 8U\n8 "notes" notes "yes"`)).toEqual(['yes']);
    expect(resolve(doc).notes?.map((n) => n.target)).toEqual([
      { kind: 'connection', connectionId: 'connection-7' },
      { kind: 'device', deviceId: 'device-3' },
    ]);
  });

  it.each([
    '[[notes -- // rack|notes "annotation"]]',
    '[notes "annotation"](https://example.test/a--b//notes)',
    'external "notes -- // rack"',
    '"Host"',
  ])(
    'protects endpoint %s before extracting the connection suffix',
    (endpoint) => {
      const doc = parse(
        `${header}\ncore:1 -- ${endpoint} fibre category network notes "literal -- // adhoc category power"`,
      );
      expect(doc.diagnostics).toEqual([]);
      expect(doc.connections[0]).toMatchObject({
        media: 'fibre',
        category: 'network',
      });
      expect(doc.connections[0]?.to).not.toHaveProperty('adHoc');
      expect(doc.notes?.map((n) => n.text)).toEqual([
        'literal -- // adhoc category power',
      ]);
    },
  );

  it('isolates note prose from adhoc and category processing', () => {
    const layout = resolve(
      parse(
        `${header}\ncore:1 -- host:missing fibre category network notes "adhoc category power"\ncore:1 -- host:missing adhoc notes "category console"`,
      ),
      catalogue,
    );
    expect(layout.connections.map((c) => c.category)).toEqual([
      'network',
      'network',
    ]);
    expect(
      layout.diagnostics.filter((d) => d.message.startsWith('Unknown port')),
    ).toHaveLength(1);
    expect(layout.notes).toHaveLength(2);
  });

  it('captures the current rack and keeps hidden faces, shared rows, shelves and fractional positions', () => {
    const doc = parse(`rack "A" 8U u1 top views rear
8 2U server "Host" notes "host"
4 shelf "Shelf"
4 "A"
4 "B"
notes at 1 "empty"
notes at 4 "shared"
notes at 7.5 "multi-U"
notes at rear 8 "rear"
rack "B" 4U
notes at 1 "second rack"`);
    const layout = resolve(doc);
    expect(layout.notes?.slice(1).map((n) => n.target)).toEqual([
      {
        kind: 'rack-position',
        rackId: 'rack-1',
        positionU: 1,
        mountFace: 'front',
      },
      {
        kind: 'rack-position',
        rackId: 'rack-1',
        positionU: 4,
        mountFace: 'front',
      },
      {
        kind: 'rack-position',
        rackId: 'rack-1',
        positionU: 7.5,
        mountFace: 'front',
      },
      {
        kind: 'rack-position',
        rackId: 'rack-1',
        positionU: 8,
        mountFace: 'rear',
      },
      {
        kind: 'rack-position',
        rackId: 'rack-10',
        positionU: 1,
        mountFace: 'front',
      },
    ]);
    expect(layout.diagnostics.filter((d) => /note/i.test(d.message))).toEqual(
      [],
    );
    expect(layout.devices).toHaveLength(4);
  });

  it.each(['0', '-1', '9', '1e2', 'NaN', 'Infinity', '9'.repeat(400)])(
    'omits invalid position %s without changing later statements',
    (position) => {
      const doc = parse(
        `rack "Lab" 8U\nnotes at ${position} "invalid"\n8 "OK" notes "valid"`,
      );
      const layout = resolve(doc);
      expect(layout.notes?.map((n) => n.text)).toEqual(['valid']);
      expect(layout.diagnostics).toHaveLength(1);
      expect(layout.diagnostics[0]).toMatchObject({
        severity: 'warn',
        line: 2,
        column: 10,
      });
      expect(layout.devices).toHaveLength(1);
    },
  );

  it('rejects absent or cleared rack context with a single warning per position note', () => {
    const layout = resolve(
      parse(`notes at 1 "before"
rack "A" 8U
rack "Broken" nope
notes at rear 2 "after broken"
rack "B" 4U
notes at 2 "valid"`),
    );
    expect(layout.notes?.map((n) => n.text)).toEqual(['valid']);
    expect(
      layout.diagnostics.filter((d) => d.line === 1 || d.line === 4),
    ).toHaveLength(2);
    expect(layout.devices).toHaveLength(0);
  });

  it.each(['""', '"   "', '"unterminated adhoc category power'])(
    'omits defective inline note %s while retaining earlier notes and parents',
    (badText) => {
      const source = `${header}\ncore:1 -- host:1 fibre category network notes "first" notes ${badText}\n4 "Other" notes "device first" notes ${badText}\nnotes for host "after"`;
      const doc = parse(source);
      const layout = resolve(doc);
      expect(layout.notes?.map((n) => n.text)).toEqual([
        'first',
        'device first',
        'after',
      ]);
      expect(layout.connections[0]).toMatchObject({
        media: 'fibre',
        category: 'network',
      });
      expect(doc.devices).toHaveLength(3);
      expect(doc.diagnostics).toHaveLength(2);
      expect(doc.diagnostics[0]).toMatchObject({
        severity: 'warn',
        line: 4,
        column: (source.split('\n')[3]?.lastIndexOf(badText) ?? -1) + 1,
      });
    },
  );

  it('omits invalid standalone notes and preserves subsequent valid lines', () => {
    const doc = parse(
      `${header}\nnotes for host ""\nnotes at 3 "unterminated\nnotes for "blank"\nnotes for host:1 "port unsupported"\nnotes at front nope "bad"\nnotes for host "valid"`,
    );
    expect(
      texts(
        `${header}\nnotes for host ""\nnotes at 3 "unterminated\nnotes for "blank"\nnotes for host:1 "port unsupported"\nnotes at front nope "bad"\nnotes for host "valid"`,
      ),
    ).toEqual(['valid']);
    expect(doc.diagnostics).toHaveLength(5);
    expect(doc.devices).toHaveLength(2);
  });

  it('does not multiply diagnostics when the inline owner is rejected or unresolved', () => {
    const doc = parse(
      `8 "No rack" notes "orphan"\nrack "Lab" 8U\n8 "A" as a\nmissing -- a notes "unresolved"\na -- [[]] notes "missing endpoint"\na -- a -- a notes "rejected"`,
    );
    const layout = resolve(doc);
    expect(layout.notes).toBeUndefined();
    expect(layout.diagnostics).toHaveLength(4);
    expect(layout.diagnostics.filter((d) => /note/i.test(d.message))).toEqual(
      [],
    );
  });

  it('keeps optional API fields, schema versions and serialized round trips without mutation', () => {
    const legacy: RackDocument = {
      schemaVersion: 1,
      racks: [],
      devices: [],
      connections: [],
      diagnostics: [],
    };
    const legacyLayout: RackLayout = {
      schemaVersion: 2,
      racks: [],
      devices: [],
      connections: [],
      externals: [],
      diagnostics: [],
      bounds: { widthMm: 0, heightMm: 0 },
    };
    expect(resolve(legacy)).toEqual(legacyLayout);
    expect(parse(header)).not.toHaveProperty('notes');
    expect(resolve(parse(header))).not.toHaveProperty('notes');
    const doc = parse(`${header}\nnotes for host "round trip"`);
    const snapshot = JSON.stringify(doc);
    expect(resolve(JSON.parse(snapshot))).toEqual(resolve(doc));
    expect(JSON.stringify(doc)).toBe(snapshot);
    const layout = resolve(doc);
    expect(layout.schemaVersion).toBe(2);
    expect(JSON.parse(JSON.stringify(layout))).toEqual(layout);
    expect(layout.notes).toHaveLength(1);
  });

  it('validates caller-constructed note targets without mutating the AST', () => {
    const doc: RackDocument = parse(header);
    doc.notes = [
      {
        id: 'position',
        text: 'valid',
        target: {
          kind: 'rack-position',
          rackId: 'rack-1',
          positionU: 2.5,
          mountFace: 'rear',
        },
        source: { start: { line: 10, column: 3 } },
      },
      {
        id: 'bad position',
        text: 'bad',
        target: {
          kind: 'rack-position',
          rackId: 'rack-1',
          positionU: Number.POSITIVE_INFINITY,
          mountFace: 'front',
        },
        source: { start: { line: 11, column: 3 } },
      },
      {
        id: 'missing rack',
        text: 'bad',
        target: {
          kind: 'rack-position',
          rackId: 'missing',
          positionU: 1,
          mountFace: 'front',
        },
        source: { start: { line: 12, column: 3 } },
      },
      {
        id: 'missing device',
        text: 'bad',
        target: { kind: 'device', deviceId: 'missing' },
        source: { start: { line: 13, column: 3 } },
      },
      {
        id: 'missing connection',
        text: 'bad',
        target: { kind: 'connection', connectionId: 'missing' },
        source: { start: { line: 14, column: 3 } },
      },
    ];
    const before = JSON.stringify(doc);
    const layout = resolve(doc);
    expect(layout.notes?.map((n) => n.id)).toEqual(['position']);
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        line: 11,
        column: 3,
        message: 'Invalid note rack position; ignoring it.',
      }),
      expect.objectContaining({
        line: 12,
        column: 3,
        message: 'Invalid note rack position; ignoring it.',
      }),
    ]);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('retains later complete clauses after an empty note on the same line', () => {
    const doc = parse(
      `${header}\ncore -- host notes "first" notes "" notes "last"`,
    );
    expect(doc.notes?.map((n) => n.text)).toEqual(['first', 'last']);
    expect(doc.diagnostics).toHaveLength(1);
  });

  it('excludes note data from SVG and leaves selection and schedules unchanged', () => {
    const layout = resolve(
      parse(
        `${header}\ncore:1 -- host:1 category network notes "private <script> details"\nnotes for core "device details"\nnotes at 1 "position details"`,
      ),
    );
    const { notes, ...withoutNotes } = layout;
    expect(notes).toHaveLength(3);
    const snapshot = JSON.stringify(layout);
    expect(toSvg(layout)).toBe(toSvg(withoutNotes));
    expect(toSvg(layout)).not.toContain('private');
    expect(
      toSvg({
        ...layout,
        notes: (notes ?? []).map((n) => ({ ...n, text: 'changed' })),
      }),
    ).toBe(toSvg(layout));
    expect(buildCableSchedule(layout)).toEqual(
      buildCableSchedule(withoutNotes),
    );
    expect(selectConnections(layout, { categories: ['network'] })).toEqual(
      selectConnections(withoutNotes, { categories: ['network'] }),
    );
    expect(JSON.stringify(layout)).toBe(snapshot);
  });

  it.each([
    'as notes',
    'as "notes"',
    'as core--backup',
    '-1U switch "Core" as notes',
  ])('keeps alias boundaries aligned with notes after %s', (suffix) => {
    const placement = suffix.startsWith('-')
      ? `8 ${suffix}`
      : `8 switch "Core" ${suffix}`;
    const doc = parse(
      `rack "Lab" 8U\n${placement} notes "annotation -- // as"`,
    );
    expect(doc.connections).toEqual([]);
    expect(doc.devices).toHaveLength(1);
    expect(doc.notes?.map((n) => n.text)).toEqual(['annotation -- // as']);
    expect(doc.devices[0]?.alias).toBe(
      suffix.includes('core--backup') ? undefined : 'notes',
    );
  });

  it('keeps both rejected endpoint diagnostics without adding annotation diagnostics', () => {
    const doc = parse(`${header}\n[[]] -- [[]] notes ""`);
    expect(doc.connections).toEqual([]);
    expect(doc.notes).toBeUndefined();
    expect(doc.diagnostics).toHaveLength(2);
    expect(
      doc.diagnostics.every(
        (d) =>
          d.message === 'External connection target is empty; ignoring it.',
      ),
    ).toBe(true);
  });

  it.each([
    'category notes "invalid"',
    'fibre category notes "invalid"',
    'fibre category adhoc notes "invalid"',
  ])(
    'keeps notes used as a category argument in legacy recovery: %s',
    (suffix) => {
      const doc = parse(`${header}\ncore:1 -- host:1 ${suffix}`);
      expect(doc.notes).toBeUndefined();
      expect(doc.connections[0]?.category).toBe('invalid');
      expect(resolve(doc).connections[0]?.category).toBe('unclassified');
    },
  );

  it('does not extract source-side annotations as connection notes', () => {
    const doc = parse(
      `${header}\ncore:1 notes "source annotation" -- host:1 notes "destination annotation"`,
    );
    expect(doc.notes?.map((n) => n.text)).toEqual(['destination annotation']);
    expect(doc.diagnostics).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          'Unexpected text after the source endpoint',
        ),
      }),
    );
  });

  it('preserves prior notes and parent metadata when a later suffix is malformed', () => {
    const doc = parse(
      `${header}\ncore:1 -- host:1 fibre category network notes "first" notes invalid adhoc\n4 "Other" notes "second" unsupported text`,
    );
    expect(doc.notes?.map((n) => n.text)).toEqual(['first', 'second']);
    expect(doc.connections[0]).toMatchObject({
      media: 'fibre',
      category: 'network',
    });
    expect(doc.connections[0]?.to).not.toHaveProperty('adHoc');
    expect(doc.diagnostics).toHaveLength(2);
  });

  it('uses raw position columns with explicit front and irregular whitespace', () => {
    const line = '  NoTeS   At   FrOnT    9 "invalid"';
    const doc = parse(`rack "Lab" 8U\n${line}\nNoTeS At FrOnT 3.5 "valid"`);
    const layout = resolve(doc);
    expect(layout.notes?.map((n) => n.target)).toEqual([
      {
        kind: 'rack-position',
        rackId: 'rack-1',
        positionU: 3.5,
        mountFace: 'front',
      },
    ]);
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({ line: 2, column: line.indexOf('9') + 1 }),
    ]);
  });

  it('protects standalone quoted references and decodes their escapes before lookup', () => {
    const doc = parse(String.raw`notes for "A\" -- // B" "before"
rack "Lab" 8U
8 "A\" -- // B" notes "inline"`);
    expect(doc.diagnostics).toEqual([]);
    expect(resolve(doc).notes?.map((n) => n.target)).toEqual([
      { kind: 'device', deviceId: 'device-3' },
      { kind: 'device', deviceId: 'device-3' },
    ]);
  });

  it('requires whitespace before an inline note after quoted values', () => {
    const deviceDoc = parse('rack "Lab" 8U\n8 "Core"notes "invalid"');
    const connectionDoc = parse(`${header}\ncore:1 -- host:"1"notes "invalid"`);
    expect(parse(`${header}\nnotes for "Host""invalid"`).notes).toBeUndefined();
    expect(deviceDoc.notes).toBeUndefined();
    expect(connectionDoc.notes).toBeUndefined();
    expect(deviceDoc.diagnostics).toHaveLength(1);
    expect(connectionDoc.diagnostics).toHaveLength(1);
  });

  it('requires ordinary keyword boundaries and does not invent global notes syntax', () => {
    const doc = parse(
      `${header}\nnotes-for host "invalid"\nnotebook at 3 "invalid"\ncore -- host notesx "invalid"`,
    );
    expect(doc.notes).toBeUndefined();
    expect(doc.connections[0]?.media).toBe('notesx');
    expect(doc.diagnostics).toHaveLength(3);
  });

  it('preserves geometry when inline text changes and qualifies line-derived IDs', () => {
    const source = `${header}\nnotes for host "a"`;
    const layout = resolve(parse(source));
    expect(layout.notes).toHaveLength(1);
    expect(toSvg(resolve(parse(source.replace('"a"', '"b"'))))).toBe(
      toSvg(layout),
    );
    const shifted = resolve(parse(`notes for host "a"\n${header}`));
    expect(shifted.devices.map(({ id, rackId, ...d }) => d)).toEqual(
      layout.devices.map(({ id, rackId, ...d }) => d),
    );
    expect(shifted.devices[0]?.id).not.toBe(layout.devices[0]?.id);
  });
});
