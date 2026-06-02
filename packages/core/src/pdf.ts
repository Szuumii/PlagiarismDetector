import { extractText as unpdfExtract } from "unpdf";

const REFERENCES_TAIL_PATTERN = /^\s*(references|bibliography|works cited)\s*$/gim;
const TAIL_POSITION_THRESHOLD = 0.7;

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Find the *last* References-like heading on its own line. Only strip if it
// falls in the tail of the document — body-text mentions of "References"
// rarely sit that close to the end, so this heuristic minimizes false cuts.
function stripReferencesTail(text: string): string {
  const matches = [...text.matchAll(REFERENCES_TAIL_PATTERN)];
  if (matches.length === 0) return text;
  const last = matches[matches.length - 1];
  const idx = last.index ?? 0;
  if (idx / text.length < TAIL_POSITION_THRESHOLD) return text;
  return text.slice(0, idx).trimEnd();
}

export async function extractText(buffer: Uint8Array): Promise<string> {
  const { text } = await unpdfExtract(buffer, { mergePages: true });
  return stripReferencesTail(normalizeWhitespace(text));
}
