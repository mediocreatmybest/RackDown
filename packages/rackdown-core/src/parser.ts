import { parseConnection } from './connection-parser.js';
import type { Diagnostic } from './diagnostics.js';
import type {
  DevicePlacement,
  RackDeclaration,
  RackDocument,
  RackFace,
  RackU1Position,
} from './document.js';
import { sourceSpan } from './source.js';

interface Token {
  value: string;
  column: number;
  quoted: boolean;
  unterminated?: true;
}

const POSITION_PATTERN = /^-?\d+(?:\.\d+)?$/;
const U_PATTERN = /^(\d+(?:\.\d+)?)u$/i;
const WIDTH_PATTERN = /^(\d+(?:\.\d+)?)in$/i;

/**
 * Parse RackDown source without throwing on malformed author input.
 *
 * The M1 parser owns rack declarations, device placements and simple
 * connections. Reference existence and physical placement are resolved later.
 */
export function parse(source: string): RackDocument {
  const document: RackDocument = {
    schemaVersion: 1,
    racks: [],
    devices: [],
    connections: [],
    diagnostics: [],
  };

  let currentRackId: string | undefined;
  const lines = source.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const line = index + 1;
    const trimmed = rawLine.trimStart();

    if (trimmed.length === 0 || trimmed.startsWith('//')) {
      continue;
    }

    const tokens = tokenizeLine(rawLine);
    const first = tokens[0];
    if (!first) {
      continue;
    }

    if (first.value.toLowerCase() === 'rack') {
      const rack = parseRack(tokens, rawLine, line, document.diagnostics);
      if (rack) {
        document.racks.push(rack);
        currentRackId = rack.id;
      }
      continue;
    }

    if (POSITION_PATTERN.test(first.value)) {
      const device = parseDevice(
        tokens,
        rawLine,
        line,
        currentRackId,
        document.diagnostics,
        0,
        'front',
      );
      if (device) {
        document.devices.push(device);
      }
      continue;
    }

    const second = tokens[1];
    if (
      first.value.toLowerCase() === 'rear' &&
      second &&
      POSITION_PATTERN.test(second.value)
    ) {
      const device = parseDevice(
        tokens,
        rawLine,
        line,
        currentRackId,
        document.diagnostics,
        1,
        'rear',
      );
      if (device) {
        document.devices.push(device);
      }
      continue;
    }

    if (rawLine.includes('--')) {
      const connection = parseConnection(rawLine, line, document.diagnostics);
      if (connection) {
        document.connections.push(connection);
      }
      continue;
    }

    document.diagnostics.push({
      severity: 'warn',
      line,
      column: first.column,
      message: `Unrecognised RackDown statement: ${first.value}`,
      hint: 'Expected a rack declaration, device placement or connection.',
    });
  }

  return document;
}

function parseRack(
  tokens: readonly Token[],
  rawLine: string,
  line: number,
  diagnostics: Diagnostic[],
): RackDeclaration | undefined {
  let cursor = 1;
  let name = 'Rack';
  const possibleName = tokens[cursor];
  const possibleUnits = possibleName
    ? parseRackUnits(possibleName.value)
    : undefined;

  if (possibleName && possibleUnits === undefined) {
    name = possibleName.value;
    if (!possibleName.quoted) {
      diagnostics.push({
        severity: 'warn',
        line,
        column: possibleName.column,
        message: 'Rack names should be quoted.',
        hint: `Use rack "${possibleName.value}" ...`,
      });
    }
    reportUnterminated(possibleName, line, 'rack name', diagnostics);
    cursor += 1;
  } else if (possibleUnits === undefined || possibleUnits > 0) {
    diagnostics.push({
      severity: 'warn',
      line,
      column: possibleName?.column ?? 1,
      message: 'Rack name is missing; using "Rack".',
    });
  }

  const unitsToken = tokens[cursor];
  const units = unitsToken ? parseRackUnits(unitsToken.value) : undefined;
  if (units === undefined || units <= 0) {
    diagnostics.push({
      severity: 'error',
      line,
      column: unitsToken?.column ?? rawLine.length + 1,
      message: 'Rack height is missing or invalid.',
      hint: 'Specify a positive rack height such as 42U.',
    });
    return undefined;
  }
  if (!Number.isInteger(units)) {
    diagnostics.push({
      severity: 'error',
      line,
      column: unitsToken?.column ?? rawLine.length + 1,
      message: `Rack height must be a whole number of rack units: ${unitsToken?.value}`,
      hint: 'Specify a positive whole number such as 42U. Fractional positions and heights are supported for devices, but racks require integer heights.',
    });
    return undefined;
  }
  cursor += 1;

  let widthInches: number | undefined;
  const widthToken = tokens[cursor];
  const parsedWidth = widthToken ? parseRackWidth(widthToken.value) : undefined;
  if (parsedWidth !== undefined) {
    widthInches = parsedWidth;
    cursor += 1;
  }

  let u1: RackU1Position = 'bottom';
  const u1Token = tokens[cursor];
  if (u1Token?.value.toLowerCase() === 'u1') {
    const direction = tokens[cursor + 1];
    if (direction && isRackDirection(direction.value)) {
      u1 = direction.value.toLowerCase() as RackU1Position;
      cursor += 2;
    } else {
      diagnostics.push({
        severity: 'warn',
        line,
        column: direction?.column ?? rawLine.length + 1,
        message: 'U1 direction is missing or invalid; using bottom.',
        hint: 'Use `u1 bottom` or `u1 top`.',
      });
      cursor += 1;
    }
  }

  let views: RackFace[] = ['front'];
  const viewsToken = tokens[cursor];
  if (viewsToken?.value.toLowerCase() === 'views') {
    cursor += 1;
    const parsedViews: RackFace[] = [];
    const seenViews = new Set<RackFace>();

    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (!token || !isRackFace(token.value)) {
        break;
      }

      const face = token.value.toLowerCase() as RackFace;
      if (seenViews.has(face)) {
        diagnostics.push({
          severity: 'warn',
          line,
          column: token.column,
          message: `Duplicate rack view: ${face}`,
          hint: 'Each of `front` and `rear` may appear at most once.',
        });
      } else {
        seenViews.add(face);
        parsedViews.push(face);
      }
      cursor += 1;
    }

    if (parsedViews.length > 0) {
      views = parsedViews;
    } else {
      diagnostics.push({
        severity: 'warn',
        line,
        column: tokens[cursor]?.column ?? rawLine.length + 1,
        message: 'Rack views are missing or invalid; using front.',
        hint: 'Use `views front`, `views rear`, `views front rear` or `views rear front`.',
      });
    }
  }

  reportTrailingTokens(tokens, cursor, line, 'rack', diagnostics);

  return {
    kind: 'rack',
    id: `rack-${line}`,
    name,
    units,
    ...(widthInches === undefined ? {} : { widthInches }),
    u1,
    views,
    source: sourceSpan(rawLine, line),
  };
}

function parseDevice(
  tokens: readonly Token[],
  rawLine: string,
  line: number,
  rackId: string | undefined,
  diagnostics: Diagnostic[],
  positionIndex: number,
  mountFace: RackFace,
): DevicePlacement | undefined {
  const positionToken = tokens[positionIndex];
  if (!positionToken) {
    return undefined;
  }

  const positionU = Number(positionToken.value);
  // Reachable: POSITION_PATTERN is unbounded in digits, so a syntactically
  // valid position token can still overflow Number to Infinity.
  if (!Number.isFinite(positionU)) {
    diagnostics.push({
      severity: 'error',
      line,
      column: positionToken.column,
      message: `Invalid rack position: ${positionToken.value}`,
    });
    return undefined;
  }

  if (!rackId) {
    diagnostics.push({
      severity: 'warn',
      line,
      column: positionToken.column,
      message:
        'Device placement appears before any rack declaration; ignoring it.',
      hint: 'Declare a rack before placing devices.',
    });
    return undefined;
  }

  let cursor = positionIndex + 1;
  let explicitUHeight: number | undefined;
  const possibleHeight = tokens[cursor];
  const parsedHeight = possibleHeight
    ? parseRackUnits(possibleHeight.value)
    : undefined;
  if (parsedHeight !== undefined) {
    explicitUHeight = parsedHeight;
    cursor += 1;
  }

  let deviceType = 'device';
  let label = 'device';
  let explicitLabel = false;
  const typeToken = tokens[cursor];

  if (!typeToken) {
    diagnostics.push({
      severity: 'warn',
      line,
      column: rawLine.length + 1,
      message: 'Device type is missing; using generic device.',
    });
  } else if (typeToken.quoted) {
    label = typeToken.value || 'device';
    explicitLabel = true;
    reportUnterminated(typeToken, line, 'device label', diagnostics);
    diagnostics.push({
      severity: 'warn',
      line,
      column: typeToken.column,
      message: 'Device type is missing; using generic device.',
    });
    cursor += 1;
  } else {
    deviceType = typeToken.value;
    label = deviceType;
    cursor += 1;

    const labelToken = tokens[cursor];
    if (labelToken?.quoted) {
      label = labelToken.value || deviceType;
      explicitLabel = true;
      reportUnterminated(labelToken, line, 'device label', diagnostics);
      cursor += 1;
    } else if (labelToken && labelToken.value.toLowerCase() !== 'as') {
      const labelTokens: Token[] = [];
      while (cursor < tokens.length) {
        const token = tokens[cursor];
        if (!token || token.value.toLowerCase() === 'as') {
          break;
        }
        labelTokens.push(token);
        cursor += 1;
      }
      if (labelTokens.length > 0) {
        label = labelTokens.map((token) => token.value).join(' ');
        explicitLabel = true;
        const firstLabelToken = labelTokens[0];
        if (firstLabelToken) {
          diagnostics.push({
            severity: 'warn',
            line,
            column: firstLabelToken.column,
            message:
              'Device labels should be quoted; recovered an unquoted label.',
            hint: `Use "${label}".`,
          });
        }
      }
    }
  }

  let alias: string | undefined;
  const asToken = tokens[cursor];
  if (asToken?.value.toLowerCase() === 'as') {
    const aliasToken = tokens[cursor + 1];
    if (aliasToken) {
      if (
        aliasToken.value &&
        !aliasToken.unterminated &&
        !/[\s:"[\]]/.test(aliasToken.value) &&
        !aliasToken.value.includes('--') &&
        !aliasToken.value.startsWith('//')
      ) {
        alias = aliasToken.value;
      } else {
        diagnostics.push({
          severity: 'warn',
          line,
          column: aliasToken.column,
          message:
            'Alias cannot be addressed by a connection; ignoring the alias.',
          hint: 'Use a non-empty alias without whitespace, quotes, colons, brackets or `--`, and not starting with `//`.',
        });
      }
      cursor += 2;
    } else {
      diagnostics.push({
        severity: 'warn',
        line,
        column: rawLine.length + 1,
        message: 'Alias name is missing after `as`.',
      });
      cursor += 1;
    }
  }

  reportTrailingTokens(tokens, cursor, line, 'device', diagnostics);

  return {
    kind: 'device',
    id: `device-${line}`,
    rackId,
    positionU,
    deviceType,
    label,
    ...(alias === undefined ? {} : { alias }),
    ...(explicitUHeight === undefined ? {} : { explicitUHeight }),
    mountFace,
    source: sourceSpan(rawLine, line),
    explicitLabel,
  };
}

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < line.length) {
    while (cursor < line.length && /\s/.test(line[cursor] ?? '')) {
      cursor += 1;
    }
    if (cursor >= line.length) {
      break;
    }

    const column = cursor + 1;
    if (line[cursor] === '"') {
      cursor += 1;
      const start = cursor;
      while (cursor < line.length && line[cursor] !== '"') {
        cursor += 1;
      }

      const value = line.slice(start, cursor);
      if (cursor < line.length && line[cursor] === '"') {
        cursor += 1;
        tokens.push({ value, column, quoted: true });
      } else {
        tokens.push({ value, column, quoted: true, unterminated: true });
      }
      continue;
    }

    const start = cursor;
    while (cursor < line.length && !/\s/.test(line[cursor] ?? '')) {
      cursor += 1;
    }
    tokens.push({
      value: line.slice(start, cursor),
      column,
      quoted: false,
    });
  }

  return tokens;
}

function parseSuffixedNumber(
  value: string,
  pattern: RegExp,
  predicate?: (value: number) => boolean,
): number | undefined {
  const match = pattern.exec(value);
  if (!match?.[1]) {
    return undefined;
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return predicate === undefined || predicate(parsed) ? parsed : undefined;
}

function parseRackUnits(value: string): number | undefined {
  return parseSuffixedNumber(value, U_PATTERN);
}

function parseRackWidth(value: string): number | undefined {
  return parseSuffixedNumber(value, WIDTH_PATTERN, (width) => width > 0);
}

function isRackDirection(value: string): boolean {
  const normalised = value.toLowerCase();
  return normalised === 'top' || normalised === 'bottom';
}

function isRackFace(value: string): boolean {
  const normalised = value.toLowerCase();
  return normalised === 'front' || normalised === 'rear';
}

function reportUnterminated(
  token: Token,
  line: number,
  description: string,
  diagnostics: Diagnostic[],
): void {
  if (!token.unterminated) {
    return;
  }
  diagnostics.push({
    severity: 'warn',
    line,
    column: token.column,
    message: `Unterminated quoted ${description}; recovered to end of line.`,
  });
}

function reportTrailingTokens(
  tokens: readonly Token[],
  cursor: number,
  line: number,
  subject: 'rack' | 'device',
  diagnostics: Diagnostic[],
): void {
  const extra = tokens[cursor];
  if (extra !== undefined) {
    diagnostics.push({
      severity: 'warn',
      line,
      column: extra.column,
      message: `Ignoring unsupported ${subject} text: ${tokens
        .slice(cursor)
        .map((token) => token.value)
        .join(' ')}`,
    });
  }
}
