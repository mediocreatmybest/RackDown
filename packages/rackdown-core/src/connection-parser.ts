import type { Diagnostic } from './diagnostics.js';
import type {
  ConnectionEndpointReference,
  ConnectionStatement,
} from './document.js';
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
  endpoint: ConnectionEndpointReference;
  media?: string;
}

/** Quoted ports, plain external labels, wiki references and Markdown links protect `--` from being treated as structural. */
function connectionOperators(text: string): number[] {
  const operators: number[] = [];
  let quoted = false;
  let external = false;
  let markdownState: 'none' | 'bracket' | 'paren' = 'none';
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
        markdownState = 'paren';
        cursor += 1;
        continue;
      }
      if (text[cursor] === ']') {
        markdownState = 'none';
        continue;
      }
      continue;
    }

    if (markdownState === 'paren') {
      if (text[cursor] === ')') {
        markdownState = 'none';
        continue;
      }
      continue;
    }

    if (quoted) {
      if (text[cursor] === '"') {
        quoted = false;
      }
      continue;
    }

    if (text[cursor] === '"') {
      quoted = true;
      atEndpointStart = false;
      continue;
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

  return operators;
}

/** Parse one line containing the v0 `--` connection operator. */
export function parseConnection(
  rawLine: string,
  line: number,
  diagnostics: Diagnostic[],
): ConnectionStatement | undefined {
  const operators = connectionOperators(rawLine);
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

    if (allowMedia && media === undefined) {
      media = token.text;
      continue;
    }

    unsupported.push(token);
  }

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
        ? 'Connection media is a single optional token; `adhoc` may appear beside a device port.'
        : 'Only `adhoc` may follow a source device port before the `--` operator.',
    });
  }

  return {
    endpoint,
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
  while (
    cursor < text.length &&
    text[cursor] !== ':' &&
    !/\s/.test(text[cursor] ?? '')
  ) {
    cursor += 1;
  }

  const device = text.slice(0, cursor);
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
    cursor += 1;
    const start = cursor;
    const close = text.indexOf('"', cursor);
    if (close < 0) {
      const port = text.slice(start);
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

    const port = text.slice(start, close);
    if (!port) {
      diagnostics.push({
        severity: 'warn',
        line,
        column: quoteColumn,
        message: 'Connection port is empty; preserving the device endpoint.',
      });
      return {
        endpoint: { kind: 'device', device },
        ...trailingText(text, close + 1),
      };
    }

    return {
      endpoint: { kind: 'device', device, port },
      ...trailingText(text, close + 1),
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
  const closeIndex = text.indexOf('"', quoteIndex + 1);

  if (closeIndex < 0) {
    const label = text.slice(quoteIndex + 1);
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

  const label = text.slice(quoteIndex + 1, closeIndex);
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
    ...trailingText(text, closeIndex + 1),
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

  const closeParen = text.indexOf(')', separator + 2);
  if (closeParen < 0) {
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
