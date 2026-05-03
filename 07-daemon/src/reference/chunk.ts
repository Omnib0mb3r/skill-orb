/**
 * Paragraph-aware chunking for reference docs.
 *
 * Goal: chunks of ~800 chars with ~100-char overlap, broken on
 * paragraph boundaries first, sentence boundaries second, hard at
 * char count last. Smaller chunks (under MIN_CHARS) are merged into
 * neighbors.
 */
const TARGET_CHARS = 800;
const OVERLAP_CHARS = 100;
const MIN_CHARS = 200;

export interface Chunk {
  index: number;
  text: string;
  start_offset: number;
  end_offset: number;
}

export function chunkText(text: string): Chunk[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return [];

  // Split on paragraph boundaries first
  const paragraphs = normalized.split(/\n\s*\n/).filter((p) => p.trim());
  const result: Chunk[] = [];
  let buffer = '';
  let bufferStart = 0;
  let cursor = 0;
  let index = 0;

  const flush = (endOffset: number): void => {
    const trimmed = buffer.trim();
    if (trimmed.length === 0) return;
    result.push({
      index: index++,
      text: trimmed,
      start_offset: bufferStart,
      end_offset: endOffset,
    });
    // Keep last OVERLAP_CHARS characters for overlap with next chunk
    const tail = trimmed.slice(Math.max(0, trimmed.length - OVERLAP_CHARS));
    buffer = tail;
    bufferStart = endOffset - tail.length;
  };

  for (const para of paragraphs) {
    const paraOffsetInNormalized = normalized.indexOf(para, cursor);
    cursor = paraOffsetInNormalized + para.length;

    if (buffer.length === 0) {
      bufferStart = paraOffsetInNormalized;
    }

    if (buffer.length + para.length + 2 <= TARGET_CHARS) {
      buffer = buffer.length === 0 ? para : `${buffer}\n\n${para}`;
      continue;
    }

    // Buffer would overflow. Flush, then handle this paragraph.
    flush(paraOffsetInNormalized);

    // If the paragraph itself is bigger than TARGET_CHARS, sentence-split.
    if (para.length > TARGET_CHARS) {
      const sentences = splitSentences(para);
      let chunkBuf = '';
      let chunkStart = paraOffsetInNormalized;
      let sentCursor = 0;
      for (const sent of sentences) {
        const sentOffsetInPara = para.indexOf(sent, sentCursor);
        sentCursor = sentOffsetInPara + sent.length;
        const absoluteOffset = paraOffsetInNormalized + sentOffsetInPara;
        if (chunkBuf.length === 0) chunkStart = absoluteOffset;
        if (chunkBuf.length + sent.length + 1 <= TARGET_CHARS) {
          chunkBuf = chunkBuf.length === 0 ? sent : `${chunkBuf} ${sent}`;
        } else {
          if (chunkBuf.trim().length > 0) {
            result.push({
              index: index++,
              text: chunkBuf.trim(),
              start_offset: chunkStart,
              end_offset: absoluteOffset,
            });
          }
          chunkBuf = sent;
          chunkStart = absoluteOffset;
        }
      }
      if (chunkBuf.trim().length > 0) {
        result.push({
          index: index++,
          text: chunkBuf.trim(),
          start_offset: chunkStart,
          end_offset: paraOffsetInNormalized + para.length,
        });
      }
      buffer = '';
      bufferStart = paraOffsetInNormalized + para.length;
    } else {
      buffer = para;
      bufferStart = paraOffsetInNormalized;
    }
  }

  if (buffer.trim().length > 0) {
    flush(normalized.length);
  }

  // Merge under-sized terminal chunks into the previous one
  for (let i = result.length - 1; i > 0; i--) {
    const cur = result[i];
    const prev = result[i - 1];
    if (cur && cur.text.length < MIN_CHARS && prev) {
      prev.text = `${prev.text}\n\n${cur.text}`;
      prev.end_offset = cur.end_offset;
      result.splice(i, 1);
    }
  }
  // Re-index after merge
  for (let i = 0; i < result.length; i++) {
    if (result[i]) result[i]!.index = i;
  }

  return result;
}

function splitSentences(text: string): string[] {
  // Cheap regex-based split. Good enough for chunking; we are not
  // doing linguistics here.
  return text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
