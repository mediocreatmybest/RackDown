export type DiagnosticSeverity = 'error' | 'warn' | 'info';

/** Non-fatal parser/layout feedback returned to callers instead of throwing. */
export interface Diagnostic {
  severity: DiagnosticSeverity;
  line: number;
  column?: number;
  message: string;
  hint?: string;
}
