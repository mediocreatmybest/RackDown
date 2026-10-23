/** Scan from an opening quote, returning decoded text and an exclusive source offset. */
export function readQuotedText(
  text: string,
  quote: number,
): { value: string; end: number; terminated: boolean } {
  let value = '';
  for (let cursor = quote + 1; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    const next = text[cursor + 1];
    if (character === '\\' && (next === '"' || next === '\\')) {
      value += next;
      cursor += 1;
    } else if (character === '"') {
      return { value, end: cursor + 1, terminated: true };
    } else {
      value += character;
    }
  }
  return { value, end: text.length, terminated: false };
}
