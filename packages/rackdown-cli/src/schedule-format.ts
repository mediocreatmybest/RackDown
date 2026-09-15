import type { CableScheduleEndpoint, CableScheduleRow } from '@rackdown/core';

export type CableScheduleFormat = 'md' | 'csv' | 'json';

const COLUMNS = [
  'Connection',
  'Category',
  'Endpoint A',
  'Port A',
  'Location A',
  'Endpoint B',
  'Port B',
  'Location B',
  'Media',
] as const;

function endpointLocation(endpoint: CableScheduleEndpoint): string {
  return endpoint.kind === 'device'
    ? `${endpoint.rackName} · U${endpoint.positionU} · ${endpoint.mountFace}`
    : '';
}

function fields(row: CableScheduleRow): readonly string[] {
  return [
    row.connectionId,
    row.category,
    row.a.label,
    row.a.kind === 'device' ? (row.a.portName ?? '') : '',
    endpointLocation(row.a),
    row.b.label,
    row.b.kind === 'device' ? (row.b.portName ?? '') : '',
    endpointLocation(row.b),
    row.media ?? '',
  ];
}

function escapeMarkdownTableCell(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replace(/\r\n|\r|\n/g, '<br>');
}

function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function formatCableScheduleMarkdown(
  rows: readonly CableScheduleRow[],
): string {
  const lines = [
    `| ${COLUMNS.join(' | ')} |`,
    `| ${COLUMNS.map(() => '---').join(' | ')} |`,
    ...rows.map(
      (row) => `| ${fields(row).map(escapeMarkdownTableCell).join(' | ')} |`,
    ),
  ];
  return `${lines.join('\n')}\n`;
}

export function formatCableScheduleCsv(
  rows: readonly CableScheduleRow[],
): string {
  const lines = [
    COLUMNS.map(escapeCsvField).join(','),
    ...rows.map((row) => fields(row).map(escapeCsvField).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export function formatCableScheduleJson(
  rows: readonly CableScheduleRow[],
): string {
  return `${JSON.stringify({ schemaVersion: 1, connections: rows }, null, 2)}\n`;
}

export function formatCableSchedule(
  rows: readonly CableScheduleRow[],
  format: CableScheduleFormat,
): string {
  switch (format) {
    case 'md':
      return formatCableScheduleMarkdown(rows);
    case 'csv':
      return formatCableScheduleCsv(rows);
    case 'json':
      return formatCableScheduleJson(rows);
  }
}
