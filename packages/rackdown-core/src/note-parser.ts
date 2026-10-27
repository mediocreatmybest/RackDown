import type { Diagnostic } from './diagnostics.js';
import type { DocumentNote, ParsedNoteTarget } from './document.js';
import { readQuotedText } from './quoted-text.js';

/** Read one note using raw offsets, before quote decoding changes text lengths. */
export function readNote(
  text: string,
  quote: number,
  start: number,
  line: number,
  target: ParsedNoteTarget,
  diagnostics: Diagnostic[],
  notes: DocumentNote[],
): number {
  const quoted = readQuotedText(text, quote);
  if (!quoted.terminated || quoted.value.trim().length === 0) {
    diagnostics.push({
      severity: 'warn',
      line,
      column: quote + 1,
      message: quoted.terminated
        ? 'Note text is empty; ignoring it.'
        : 'Unterminated quoted note; ignoring it.',
    });
  } else {
    notes.push({
      id: `note-${line}-${start + 1}`,
      text: quoted.value,
      target,
      source: {
        start: { line, column: start + 1 },
        end: { line, column: quoted.end + 1 },
      },
    });
  }
  return quoted.end;
}

/** Notes are suffix clauses; a bare `notes` remains available as legacy media. */
export function noteClauseStart(text: string): boolean {
  return /^notes\s+"/i.test(text);
}

export function readInlineNotes(
  text: string,
  start: number,
  line: number,
  target: ParsedNoteTarget,
  diagnostics: Diagnostic[],
  notes: DocumentNote[],
): void {
  let cursor = start;
  while (cursor < text.length) {
    const clause = /^notes\s+"/i.exec(text.slice(cursor));
    if (!clause) {
      diagnostics.push({
        severity: 'warn',
        line,
        column: cursor + 1,
        message: 'Ignoring unsupported text after note; notes must come last.',
      });
      return;
    }
    cursor = readNote(
      text,
      cursor + clause[0].length - 1,
      cursor,
      line,
      target,
      diagnostics,
      notes,
    );
    const whitespace = /^\s*/.exec(text.slice(cursor))?.[0].length ?? 0;
    // A closing quote must be followed by whitespace or end of line.
    if (cursor < text.length && whitespace === 0) {
      diagnostics.push({
        severity: 'warn',
        line,
        column: cursor + 1,
        message: 'Expected whitespace after note text; ignoring trailing text.',
      });
      return;
    }
    cursor += whitespace;
  }
}
