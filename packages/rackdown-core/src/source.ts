/** 1-based source position used by diagnostics and parsed statements. */
export interface SourcePosition {
  line: number;
  column: number;
}

/** Source range for one parsed statement. End may be omitted for recovered input. */
export interface SourceSpan {
  start: SourcePosition;
  end?: SourcePosition;
}

export function sourceSpan(rawLine: string, line: number): SourceSpan {
  const leadingWhitespace = rawLine.length - rawLine.trimStart().length;
  return {
    start: { line, column: leadingWhitespace + 1 },
    end: { line, column: rawLine.length + 1 },
  };
}
