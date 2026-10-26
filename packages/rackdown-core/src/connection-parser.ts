import { isConnectionCategory } from './connection-category.js';
import type { Diagnostic } from './diagnostics.js';
import type {
  ConnectionEndpointReference,
  ConnectionStatement,
} from './document.js';
import { readQuotedText } from './quoted-text.js';
import { sourceSpan } from './source.js';

interface ParsedEndpointText {
  endpoint: ConnectionEndpointReference;
  remainder: string;
  /** Offset of `remainder` within the endpoint text, so trailing tokens keep their source column. */
  remainderOffset: number;
}

/** Trailing text after an endpoint, with the offset its first character occupies in `text`. */
function trailingText(
  text: string,
  index: number,
): { remainder: string; remainderOffset: number } {
  const rest = text.slice(index);
  const leading = rest.length - rest.trimStart().length;
  return { remainder: rest.trim(), remainderOffset: index + leading };
}

interface TrailingToken {
  text: string;
  /** 1-based column of the token in the source line. */
  column: number;
}

interface EndpointWithMedia {
  category?: ConnectionStatement['category'];
  endpoint: ConnectionEndpointReference;
  media?: string;
}

/** Find the closing destination delimiter in one bounded pass, without decoding the target. */
function markdownDestinationEnd(text: string, openParen: number): number {
  let depth = 1;
  for (let cursor = openParen + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    const next = text[cursor + 1];
    // Only parentheses and backslashes are escaped here; other target text is literal.
    if (character === '\\' && (next === '(' || next === ')' || next === '\\')) {
      cursor += 1;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

/** Scan operators and comments outside quoted text, wiki references and Markdown links. */
function scanLine(
  text: string,
  findComment = false,
): { operators: number[]; commentStart: number } {
  const operators: number[] = [];
  let external = false;
  let markdownState: 'none' | 'bracket' = 'none';
  let atEndpointStart = true;

  for (let cursor = 0; cursor < text.length; cursor += 1) {
    if (external) {
      if (text.startsWith(']]', cursor)) {
        external = false;
        cursor += 1;
      }
      continue;
    }

    if (markdownState === 'bracket') {
      if (text.startsWith('](', cursor)) {
        const close = markdownDestinationEnd(text, cursor + 1);
        // An unfinished destination protects the rest of the line as URL content.
        if (close < 0) break;
        markdownState = 'none';
        cursor = close;
        continue;
      }
      continue;
    }

    if (text[cursor] === '"') {
      const quoted = readQuotedText(text, cursor);
      cursor = quoted.end - 1;
      atEndpointStart = false;
      continue;
    }

    if (
      findComment &&
      text.startsWith('//', cursor) &&
      (cursor === 0 || /\s/.test(text[cursor - 1] ?? '')) &&
      (cursor + 2 === text.length || /\s/.test(text[cursor + 2] ?? ''))
    ) {
      return { operators, commentStart: cursor };
    }

    if (atEndpointStart) {
      if (/\s/.test(text[cursor] ?? '')) {
        continue;
      }
      if (text.startsWith('[[', cursor)) {
        external = true;
        atEndpointStart = false;
        cursor += 1;
        continue;
      }
      if (text[cursor] === '[') {
        markdownState = 'bracket';
        atEndpointStart = false;
        continue;
      }
      atEndpointStart = false;
    }

    if (text.startsWith('--', cursor)) {
      operators.push(cursor);
      cursor += 1;
      atEndpointStart = true;
    }
  }

  return { operators, commentStart: text.length };
}

/** Recognise connections using the same protected-text rules as endpoint parsing. */
export function startsWithConnection(text: string): boolean {
  const operator = scanLine(text).operators[0];
  if (operator === undefined) return false;
  // A declaration can contain an invalid alias such as `as core--backup`.
  // Only give connections priority when the source is an endpoint, not a
  // declaration prefix. The normal fallback still diagnoses malformed lines.
  const left = text.slice(0, operator).trim();
  if (left.startsWith('"') || left.startsWith('[') || isPlainExternal(left)) {
    return true;
  }
  const parsed = parseDeviceEndpoint(left, 1, 1, []);
  return (
    parsed !== undefined &&
    (parsed.remainder === '' ||
      parsed.remainder
        .split(/\s+/)
        .every((token) => token.toLowerCase() === 'adhoc'))
  );
}

/** Remove a whitespace-delimited comment without changing preceding source offsets. */
export function stripInlineComment(text: string): string {
  const { commentStart } = scanLine(text, true);
  return commentStart === text.length
    ? text
    : text.slice(0, commentStart).trimEnd();
}

/** Parse one line containing the v0 `--` connection operator. */
export function parseConnection(
  rawLine: string,
  line: number,
  diagnostics: Diagnostic[],
): ConnectionStatement | undefined {
  const { operators } = scanLine(rawLine);
  const operator = operators[0] ?? -1;
  if (operator < 0) {
    diagnostics.push({
      severity: 'warn',
      line,
      message: 'Connection has no structural `--` operator; ignoring it.',
    });
    return undefined;
  }

  if (operators.length > 1) {
    diagnostics.push({
      severity: 'warn',
      line,
      column: operator + 1,
      message: 'Connection contains more than one `--` operator; ignoring it.',
      hint: 'Use exactly one `--` between two endpoints.',
    });
    return undefined;
  }

  const leftText = rawLine.slice(0, operator).trim();
  const rightSegment = rawLine.slice(operator + 2);
  const rightText = rightSegment.trim();

  if (!leftText || !rightText) {
    diagnostics.push({
      severity: 'warn',
      line,
      column: operator + 1,
      message: 'Connection is missing an endpoint; ignoring it.',
      hint: 'Use `device:port -- device:port` or an external reference.',
    });
    return undefined;
  }

  const leftColumn = rawLine.indexOf(leftText) + 1;
  const rightLeadingWhitespace =
    rightSegment.length - rightSegment.trimStart().length;
  const rightColumn = operator + 3 + rightLeadingWhitespace;

  const left = parseEndpointWithTrailing(
    leftText,
    line,
    leftColumn,
    diagnostics,
    false,
  );
  const right = parseEndpointWithTrailing(
    rightText,
    line,
    rightColumn,
    diagnostics,
    true,
  );

  if (!left || !right) {
    return undefined;
  }

  return {
    kind: 'connection',
    id: `connection-${line}`,
    from: left.endpoint,
    to: right.endpoint,
    ...(right.media === undefined ? {} : { media: right.media }),
    ...(right.category === undefined ? {} : { category: right.category }),
    source: sourceSpan(rawLine, line),
  };
}

function parseEndpointWithTrailing(
  text: string,
  line: number,
  column: number,
  diagnostics: Diagnostic[],
  allowMedia: boolean,
): EndpointWithMedia | undefined {
  const parsed = text.startsWith('[[')
    ? parseWikiEndpoint(text, line, column, diagnostics)
    : text.startsWith('[')
      ? parseMarkdownEndpoint(text, line, column, diagnostics)
      : isPlainExternal(text)
        ? parsePlainExternalEndpoint(text, line, column, diagnostics)
        : parseDeviceEndpoint(text, line, column, diagnostics);
  if (!parsed) {
    return undefined;
  }

  let endpoint = parsed.endpoint;
  let media: string | undefined;
  const unsupported: TrailingToken[] = [];
  // Trailing tokens keep their own column so diagnostics point at the offending
  // token rather than at the start of the endpoint that precedes it.
  const trailing: TrailingToken[] = [];
  for (const match of parsed.remainder.matchAll(/\S+/g)) {
    trailing.push({
      text: match[0],
      column: column + parsed.remainderOffset + match.index,
    });
  }

  let category: ConnectionStatement['category'];
  const content: TrailingToken[] = [];
  for (const token of trailing) {
    if (token.text.toLowerCase() === 'adhoc') {
      if (endpoint.kind === 'device' && endpoint.port !== undefined) {
        endpoint = { ...endpoint, adHoc: true };
      } else {
        diagnostics.push({
          severity: 'warn',
          line,
          column: token.column,
          message:
            'The `adhoc` modifier applies only to a device endpoint with a port; ignoring it.',
        });
      }
      continue;
    }

    content.push(token);
  }

  for (let index = 0; index < content.length; index += 1) {
    const token = content[index];
    if (!token) continue;
    // A lone first `category` remains historical free-form media.
    if (
      allowMedia &&
      token.text.toLowerCase() === 'category' &&
      (media !== undefined ||
        category !== undefined ||
        content[index + 1] !== undefined)
    ) {
      const value = content[index + 1];
      const normalized = value?.text.toLowerCase();
      const duplicate = category !== undefined;
      if (duplicate || !isConnectionCategory(normalized)) {
        category = 'invalid';
        diagnostics.push({
          severity: 'warn',
          line,
          column:
            duplicate || value === undefined ? token.column : value.column,
          message: duplicate
            ? 'Duplicate connection category; preserving connection as unclassified.'
            : 'Missing or unknown connection category; preserving connection as unclassified.',
        });
      } else {
        category = normalized;
      }
      // Leave a repeated keyword for the duplicate/missing-value diagnostic.
      if (value !== undefined && normalized !== 'category') index += 1;
      continue;
    }

    if (allowMedia && media === undefined && category === undefined) {
      media = token.text;
      continue;
    }

    unsupported.push(token);
  }

  if (category !== undefined && unsupported.length > 0) category = 'invalid';
  const firstUnsupported = unsupported[0];
  if (firstUnsupported !== undefined) {
    const unsupportedText = unsupported.map((token) => token.text).join(' ');
    diagnostics.push({
      severity: 'warn',
      line,
      column: firstUnsupported.column,
      message: allowMedia
        ? `Ignoring unsupported connection text: ${unsupportedText}`
        : `Unexpected text after the source endpoint: ${unsupportedText}`,
      hint: allowMedia
        ? category === undefined
          ? 'Connection media is a single optional token; `adhoc` may appear beside a device port.'
          : 'Use `[media] category <power|network|console|unclassified>`; extra text leaves this connection unclassified.'
        : 'Only `adhoc` may follow a source device port before the `--` operator.',
    });
  }

  return {
    endpoint,
    ...(category === undefined ? {} : { category }),
    ...(media === undefined ? {} : { media }),
  };
}

function parseDeviceEndpoint(
  text: string,
  line: number,
  column: number,
  diagnostics: Diagnostic[],
): ParsedEndpointText | undefined {
  let cursor = 0;
  let device: string;
  if (text[0] === '"') {
    const quoted = readQuotedText(text, 0);
    device = quoted.value;
    cursor = quoted.end;
    if (!quoted.terminated) {
      diagnostics.push({
        severity: 'warn',
        line,
        column,
        message:
          'Unterminated quoted device reference; recovered to end of line.',
      });
    } else if (
      cursor < text.length &&
      text[cursor] !== ':' &&
      !/\s/.test(text[cursor] ?? '')
    ) {
      diagnostics.push({
        severity: 'warn',
        line,
        column,
        message: 'Unexpected text after quoted device reference; ignoring it.',
        hint: 'Follow the closing quote with a colon, whitespace or the connection operator.',
      });
      return undefined;
    }
  } else {
    while (
      cursor < text.length &&
      text[cursor] !== ':' &&
      !/\s/.test(text[cursor] ?? '')
    ) {
      cursor += 1;
    }
    device = text.slice(0, cursor);
  }
  if (!device) {
    diagnostics.push({
      severity: 'warn',
      line,
      column,
      message:
        'Connection endpoint is missing a device reference; ignoring it.',
    });
    return undefined;
  }

  while (cursor < text.length && /\s/.test(text[cursor] ?? '')) {
    cursor += 1;
  }

  if (text[cursor] !== ':') {
    return {
      endpoint: { kind: 'device', device },
      ...trailingText(text, cursor),
    };
  }

  cursor += 1;
  while (cursor < text.length && /\s/.test(text[cursor] ?? '')) {
    cursor += 1;
  }

  if (cursor >= text.length) {
    diagnostics.push({
      severity: 'warn',
      line,
      column: column + cursor,
      message: 'Connection port is unfinished; preserving the device endpoint.',
    });
    return {
      endpoint: { kind: 'device', device },
      remainder: '',
      remainderOffset: text.length,
    };
  }

  if (text[cursor] === '"') {
    const quoteColumn = column + cursor;
    const quoted = readQuotedText(text, cursor);
    const port = quoted.value;
    if (!quoted.terminated) {
      diagnostics.push({
        severity: 'warn',
        line,
        column: quoteColumn,
        message:
          'Unterminated quoted connection port; recovered to end of line.',
      });
      if (!port) {
        return {
          endpoint: { kind: 'device', device },
          remainder: '',
          remainderOffset: text.length,
        };
      }
      return {
        endpoint: { kind: 'device', device, port },
        remainder: '',
        remainderOffset: text.length,
      };
    }

    if (!port) {
      diagnostics.push({
        severity: 'warn',
        line,
        column: quoteColumn,
        message: 'Connection port is empty; preserving the device endpoint.',
      });
      return {
        endpoint: { kind: 'device', device },
        ...trailingText(text, quoted.end),
      };
    }

    return {
      endpoint: { kind: 'device', device, port },
      ...trailingText(text, quoted.end),
    };
  }

  const start = cursor;
  while (cursor < text.length && !/\s/.test(text[cursor] ?? '')) {
    cursor += 1;
  }
  const port = text.slice(start, cursor);
  if (!port) {
    diagnostics.push({
      severity: 'warn',
      line,
      column: column + start,
      message: 'Connection port is unfinished; preserving the device endpoint.',
    });
    return {
      endpoint: { kind: 'device', device },
      remainder: '',
      remainderOffset: text.length,
    };
  }

  return {
    endpoint: { kind: 'device', device, port },
    ...trailingText(text, cursor),
  };
}

function isPlainExternal(text: string): boolean {
  return /^external(?:\s*")/.test(text);
}

function parsePlainExternalEndpoint(
  text: string,
  line: number,
  column: number,
  diagnostics: Diagnostic[],
): ParsedEndpointText | undefined {
  const quoteIndex = text.indexOf('"', 8);
  if (quoteIndex < 0) {
    return undefined;
  }

  const quoteColumn = column + quoteIndex;
  const quoted = readQuotedText(text, quoteIndex);
  const label = quoted.value;

  if (!quoted.terminated) {
    if (!label) {
      diagnostics.push({
        severity: 'warn',
        line,
        column: quoteColumn,
        message: 'External connection label is empty; ignoring it.',
      });
      return undefined;
    }

    diagnostics.push({
      severity: 'warn',
      line,
      column: quoteColumn,
      message: 'Unterminated quoted external label; recovered to end of line.',
    });
    return {
      endpoint: { kind: 'external', label },
      remainder: '',
      remainderOffset: text.length,
    };
  }

  if (!label) {
    diagnostics.push({
      severity: 'warn',
      line,
      column: quoteColumn,
      message: 'External connection label is empty; ignoring it.',
    });
    return undefined;
  }

  return {
    endpoint: { kind: 'external', label },
    ...trailingText(text, quoted.end),
  };
}

function parseWikiEndpoint(
  text: string,
  line: number,
  column: number,
  diagnostics: Diagnostic[],
): ParsedEndpointText | undefined {
  const close = text.indexOf(']]', 2);

  if (close < 0) {
    const rawBody = text.slice(2);
    const pipeIndex = rawBody.indexOf('|');
    const target = (
      pipeIndex >= 0 ? rawBody.slice(0, pipeIndex) : rawBody
    ).trim();
    let label = (
      pipeIndex >= 0 ? rawBody.slice(pipeIndex + 1) : rawBody
    ).trim();

    if (!target) {
      diagnostics.push({
        severity: 'warn',
        line,
        column,
        message: 'External connection target is empty; ignoring it.',
      });
      return undefined;
    }

    if (!label) {
      diagnostics.push({
        severity: 'warn',
        line,
        column,
        message:
          'External connection alias is empty; recovered to target label.',
      });
      label = target;
    }

    diagnostics.push({
      severity: 'warn',
      line,
      column,
      message: 'Unterminated external `[[target]]`; recovered to end of line.',
    });
    return {
      endpoint: {
        kind: 'external',
        label,
        link: { style: 'wiki', target },
      },
      remainder: '',
      remainderOffset: text.length,
    };
  }

  const rawBody = text.slice(2, close);
  const pipeIndex = rawBody.indexOf('|');
  const target = (
    pipeIndex >= 0 ? rawBody.slice(0, pipeIndex) : rawBody
  ).trim();
  let label = (pipeIndex >= 0 ? rawBody.slice(pipeIndex + 1) : rawBody).trim();

  if (!target) {
    diagnostics.push({
      severity: 'warn',
      line,
      column,
      message: 'External connection target is empty; ignoring it.',
    });
    return undefined;
  }

  if (pipeIndex >= 0 && !label) {
    diagnostics.push({
      severity: 'warn',
      line,
      column,
      message: 'External connection alias is empty; recovered to target label.',
    });
    label = target;
  }

  return {
    endpoint: {
      kind: 'external',
      label,
      link: { style: 'wiki', target },
    },
    ...trailingText(text, close + 2),
  };
}

function parseMarkdownEndpoint(
  text: string,
  line: number,
  column: number,
  diagnostics: Diagnostic[],
): ParsedEndpointText | undefined {
  const separator = text.indexOf('](');
  if (separator < 1) {
    if (separator === 0) {
      diagnostics.push({
        severity: 'warn',
        line,
        column,
        message: 'Markdown link label is empty; ignoring it.',
      });
      return undefined;
    }
    diagnostics.push({
      severity: 'warn',
      line,
      column,
      message: 'Malformed Markdown link syntax; ignoring it.',
    });
    return undefined;
  }

  const rawLabel = text.slice(1, separator);
  const label = rawLabel.trim();
  if (!label) {
    diagnostics.push({
      severity: 'warn',
      line,
      column,
      message: 'Markdown link label is empty; ignoring it.',
    });
    return undefined;
  }

  const closeParen = markdownDestinationEnd(text, separator + 1);
  // An adjacent unmatched closing parenthesis is malformed URL text, not media.
  if (closeParen < 0 || text[closeParen + 1] === ')') {
    diagnostics.push({
      severity: 'warn',
      line,
      column,
      message: 'Malformed Markdown link syntax; ignoring it.',
    });
    return undefined;
  }

  const rawTarget = text.slice(separator + 2, closeParen);
  const target = rawTarget.trim();
  if (!target) {
    diagnostics.push({
      severity: 'warn',
      line,
      column,
      message: 'Markdown link target is empty; ignoring it.',
    });
    return undefined;
  }

  return {
    endpoint: {
      kind: 'external',
      label,
      link: { style: 'markdown', target },
    },
    ...trailingText(text, closeParen + 1),
  };
}
