export interface ObsidianWikiLink {
  target: string;
  display: string;
}

/** Parse a whole-label Obsidian wikilink without interpreting RackDown syntax. */
export function parseObsidianWikiLink(
  value: string,
): ObsidianWikiLink | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[[') || !trimmed.endsWith(']]')) {
    return undefined;
  }

  const body = trimmed.slice(2, -2);
  if (body.includes('[[') || body.includes(']]')) {
    return undefined;
  }

  const separator = body.indexOf('|');
  const target = (separator === -1 ? body : body.slice(0, separator)).trim();
  const display = (
    separator === -1 ? target : body.slice(separator + 1)
  ).trim();

  if (!target || !display) {
    return undefined;
  }

  return { target, display };
}
