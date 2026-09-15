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

  it.each([
    ['**Core**', '\\*\\*Core\\*\\*'],
    ['_server_', '\\_server\\_'],
    ['[link](target)', '\\[link\\]\\(target\\)'],
    ['`code`', '\\`code\\`'],
    ['~~old~~', '\\~\\~old\\~\\~'],
    ['![image](target)', '\\!\\[image\\]\\(target\\)'],
    ['<script>alert(1)</script>', '&lt;script&gt;alert\\(1\\)&lt;/script&gt;'],
    ['A & B &copy; &#42;', 'A &amp; B &amp;copy; &amp;#42;'],
    ['SFP \\ | 1', 'SFP \\\\ \\| 1'],
    ['<br>\r\nnext\rline\nlast', '&lt;br&gt;<br>next<br>line<br>last'],
  ])('renders authored %j as literal cell text', (value, escaped) => {
    const rows = [{ ...row, media: value }];
    const output = formatCableScheduleMarkdown(rows);
    expect(output.split('\n')[2]).toBe(
      `| connection-1 | network | Core \\| Switch | SFP \\\\ \\| 1 | Main<br>Rack · U18 · front | WAN, "primary" |  |  | ${escaped} |`,
    );
    expect(formatCableScheduleMarkdown(rows)).toBe(output);
  });

  it('applies literal escaping to device and external labels, ports, locations and media', () => {
    if (row.a.kind !== 'device') throw new Error('Expected device fixture');
    const value = '**A** & <br>\n[link](target)';
    const escaped = '\\*\\*A\\*\\* &amp; &lt;br&gt;<br>\\[link\\]\\(target\\)';
    const output = formatCableScheduleMarkdown([
      {
        ...row,
        a: { ...row.a, label: value, portName: value, rackName: value },
        b: { ...row.b, label: value },
        media: value,
      },
    ]);
    expect(output.split('\n')[2]).toBe(
      `| connection-1 | network | ${escaped} | ${escaped} | ${escaped} · U18 · front | ${escaped} |  |  | ${escaped} |`,
    );
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
