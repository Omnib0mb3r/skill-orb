/**
 * PDF text extraction.
 *
 * Default path: pdf-parse for text-based PDFs. Fast, accurate.
 * Scanned PDFs (image-only) yield very little text and would need
 * a rasterize-then-OCR fallback. That's queued for a later phase
 * (would add pdf2pic + tesseract); for now we extract whatever text
 * the PDF directly contains and warn if it looks empty.
 */
import * as fs from 'node:fs';

export interface PdfExtractResult {
  text: string;
  page_count: number;
  warnings: string[];
}

export async function extractPdf(filePath: string): Promise<PdfExtractResult> {
  const warnings: string[] = [];
  const buffer = fs.readFileSync(filePath);
  const mod = (await import('pdf-parse')) as unknown as {
    default: (data: Buffer) => Promise<{ text?: string; numpages?: number }>;
  };
  let parsed: { text?: string; numpages?: number };
  try {
    parsed = await mod.default(buffer);
  } catch (err) {
    return {
      text: '',
      page_count: 0,
      warnings: [`pdf-parse failed: ${(err as Error).message}`],
    };
  }
  const text = (parsed.text ?? '').trim();
  if (text.length < 50 && (parsed.numpages ?? 0) > 0) {
    warnings.push(
      'extracted text is very short for this page count; PDF may be scanned (image-only). OCR fallback for scanned PDFs is not yet implemented.',
    );
  }
  return {
    text,
    page_count: parsed.numpages ?? 0,
    warnings,
  };
}
