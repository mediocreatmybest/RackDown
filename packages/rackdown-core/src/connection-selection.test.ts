import { describe, expect, it } from 'vitest';
import {
  type ConnectionSelection,
  parse,
  resolve,
  selectConnections,
} from './index.js';

const source = `rack "Mixed" 10U
10 server "Server" as server
8 ups "UPS" as ups
6 pdu "PDU" as pdu
4 switch "Switch" as sw
ups:out -- pdu:in category power
pdu:out -- server:psu category power
server:net -- sw:1 category network
ups:net -- sw:2 category network
pdu:net -- sw:3 category network
server:console -- sw:console category console
server:odd -- external "Unknown"
sw:4 -- [[WAN]] category network`;

function fixture() {
  return resolve(parse(source));
}
function deepFreeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
}

describe('shared semantic connection selection', () => {
  it('selects all with no restrictions and selects unclassified only when requested', () => {
    const layout = fixture();
    expect(selectConnections(layout)).toEqual(layout.connections);
    expect(selectConnections(layout, {})).toEqual(layout.connections);
    expect(selectConnections(layout, { categories: ['unclassified'] })).toEqual(
      [layout.connections[6]],
    );
    expect(
      selectConnections(layout, {
        categories: ['power', 'network', 'console'],
      }),
    ).toHaveLength(7);
  });

  it.each(['categories', 'deviceIds', 'connectionIds'] as const)(
    'an empty %s restriction matches nothing',
    (field) => {
      expect(selectConnections(fixture(), { [field]: [] })).toEqual([]);
    },
  );

  it('combines OR within fields and AND across fields, preserving source order and references', () => {
    const layout = fixture();
    const server = layout.devices.find((d) => d.alias === 'server');
    const ups = layout.devices.find((d) => d.alias === 'ups');
    if (!server || !ups) throw new Error('Missing fixture device');
    const result = selectConnections(layout, {
      categories: ['network', 'power', 'power'],
      deviceIds: [ups.id, server.id, server.id],
      connectionIds: layout.connections
        .slice(1)
        .map((c) => c.id)
        .reverse(),
    });
    expect(result).toEqual(layout.connections.slice(1, 4));
    result.forEach((connection, index) => {
      expect(connection).toBe(layout.connections[index + 1]);
    });
  });

  it('touches either endpoint, one hop only, without treating aliases or external labels as IDs', () => {
    const layout = fixture();
    const server = layout.devices.find((d) => d.alias === 'server');
    if (!server) throw new Error('Missing server');
    expect(selectConnections(layout, { deviceIds: [server.id] })).toEqual([
      layout.connections[1],
      layout.connections[2],
      layout.connections[5],
      layout.connections[6],
    ]);
    expect(
      selectConnections(layout, { deviceIds: ['server', 'WAN', 'external-1'] }),
    ).toEqual([]);
    const reversed = {
      ...layout,
      connections: layout.connections.map((c) => ({
        ...c,
        from: c.to,
        to: c.from,
      })),
    };
    expect(
      selectConnections(reversed, { deviceIds: [server.id] }).map((c) => c.id),
    ).toEqual(
      selectConnections(layout, { deviceIds: [server.id] }).map((c) => c.id),
    );
  });

  it('does not widen unknown runtime categories or IDs to all', () => {
    const layout = fixture();
    const invalid = {
      categories: ['all', 'bogus', 'NETWORK'],
    } as unknown as ConnectionSelection;
    expect(selectConnections(layout, invalid)).toEqual([]);
    expect(selectConnections(layout, { connectionIds: ['missing'] })).toEqual(
      [],
    );
    expect(selectConnections(layout, { deviceIds: ['missing'] })).toEqual([]);
  });

  it('supplies a future row consumer without SVG or input mutation', () => {
    const layout = fixture();
    const before = JSON.stringify(layout);
    deepFreeze(layout);
    const selection: ConnectionSelection = { categories: ['power'] };
    deepFreeze(selection);
    const selected = selectConnections(layout, selection);
    const rows = selected.map((c) => ({
      id: c.id,
      from: c.from,
      to: c.to,
      media: c.media,
      category: c.category,
    }));
    expect(rows.map((row) => row.id)).toEqual(
      layout.connections.slice(0, 2).map((c) => c.id),
    );
    expect(JSON.stringify(layout)).toBe(before);
    expect(layout.diagnostics).toHaveLength(0);
  });
});
