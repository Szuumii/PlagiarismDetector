// M2 stub: returns a constant multi-paragraph string. The double-newline
// boundaries are what the chunking stub splits on. Real implementation
// (unpdf) lands in M3; signature stays stable across the swap.

const FAKE_TEXT = [
  "First paragraph of the fake document. This stands in for whatever the real PDF extractor would produce.",
  "Second paragraph with different content so chunking has more than one chunk to work with.",
  "Third paragraph rounding out the fixture; the indexer should produce three Chunk rows from this.",
].join("\n\n");

export async function extractText(_buffer: Uint8Array): Promise<string> {
  return FAKE_TEXT;
}
