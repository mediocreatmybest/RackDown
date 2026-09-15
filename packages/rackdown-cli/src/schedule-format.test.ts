import type { CableScheduleRow } from '@rackdown/core';
import { describe, expect, it } from 'vitest';
import {
  formatCableScheduleCsv,
  formatCableScheduleJson,
  formatCableScheduleMarkdown,
} from './schedule-format.js';

const row: CableScheduleRow = {
  connectionId: 'connection-1',
  category: 'network',
  media: 'fibre, "duplex"\nOM4',
  a: {
    kind: 'device',
    label: 'Core | Switch',
    deviceId: 'device-1',
    alias: 'core',
    portName: 'SFP \\ | 1',
    rackId: 'rack-1',
    rackName: 'Main\nRack',
    positionU: 18,
    mountFace: 'front',
  },
  b: {
    kind: 'external',
    label: 'WAN, "primary"',
    externalId: 'external-1',
  },
};

describe('cable schedule formatters', () => {
  it('escapes Markdown delimiters, backslashes and line breaks deterministically', () => {
    const output = formatCableScheduleMarkdown([row]);
    expect(output).toContain('Core \\| Switch');
    expect(output).toContain('SFP \\\\ \\| 1');
    expect(output).toContain('Main<br>Rack · U18 · front');
    expect(output.endsWith('\n')).toBe(true);
    expect(formatCableScheduleMarkdown([row])).toBe(output);
  });

  it('applies RFC-style CSV escaping for commas, quotes and newlines', () => {
    const output = formatCableScheduleCsv([row]);
    expect(output).toContain('"WAN, ""primary"""');
    expect(output).toContain('"fibre, ""duplex""\nOM4"');
    expect(output).toContain('"Main\nRack · U18 · front"');
    expect(output.endsWith('\n')).toBe(true);
    expect(formatCableScheduleCsv([row])).toBe(output);
  });

  it('serializes structured rows with schedule schemaVersion 1', () => {
    const output = formatCableScheduleJson([row]);
    expect(JSON.parse(output)).toEqual({
      schemaVersion: 1,
      connections: [row],
    });
    expect(output.startsWith('{\n  "schemaVersion": 1,')).toBe(true);
    expect(output.endsWith('\n')).toBe(true);
  });
});
