/**
 * PDF text extraction.
 *
 * Two-pass strategy:
 *
 *   1. pdf-parse for text-based PDFs. Fast, accurate. Most PDFs land
 *      here and the OCR pass never runs.
 *
 *   2. OCR fallback for scanned PDFs (image-only or majority-image).
 *      Triggers when pass 1 returns suspiciously little text per page.
 *      Rasterizes pages with pdf-to-png-converter (pure JS, no native
 *      deps) and runs tesseract.js (WASM) per page. Bounded by page
 *      count and total processing time so a multi-hundred-page scanned
 *      contract can't park the ingest queue forever.
 *
 * On any OCR error the original pdf-parse result is returned unchanged
 * with a warning. Wiki ingest tolerates short / empty content.
 */
import * as fs from 'node:fs';

const OCR_PER_PAGE_MIN_CHARS = Number(
  process.env.DEVNEURAL_PDF_OCR_PER_PAGE_MIN_CHARS ?? 40,
);
const OCR_MAX_PAGES = Math.max(
  1,
  Number(process.env.DEVNEURAL_PDF_OCR_MAX_PAGES ?? 50),
);
const OCR_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.DEVNEURAL_PDF_OCR_TIMEOUT_MS ?? 5 * 60 * 1000),
);
const OCR_LANG = process.env.DEVNEURAL_PDF_OCR_LANG ?? 'eng';

export interface PdfExtractResult {
  text: string;
  page_count: number;
  warnings: string[];
  ocr_used?: boolean;
  ocr_pages?: number;
  ocr_ms?: number;
}

export async function extractPdf(
  filePath: string,
  log: (msg: string) => void = () => undefined,
): Promise<PdfExtractResult> {
  const warnings: string[] = [];

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch (err) {
    return {
      text: '',
      page_count: 0,
      warnings: [`pdf read failed: ${(err as Error).message}`],
    };
  }

  let mod: {
    default: (data: Buffer) => Promise<{ text?: string; numpages?: number }>;
  };
  try {
    mod = (await import('pdf-parse')) as unknown as typeof mod;
  } catch (err) {
    return {
      text: '',
      page_count: 0,
      warnings: [`pdf-parse import failed: ${(err as Error).message}`],
    };
  }

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
  const pageCount = parsed.numpages ?? 0;
  const avgCharsPerPage = pageCount > 0 ? text.length / pageCount : text.length;
  const looksScanned =
    pageCount > 0 && avgCharsPerPage < OCR_PER_PAGE_MIN_CHARS;

  if (!looksScanned) {
    return { text, page_count: pageCount, warnings };
  }

  // Image-only or majority-image PDF: try OCR.
  log(
    `[pdf-ocr] fallback engaged for ${filePath} (text=${text.length}b across ${pageCount} pages, avg=${Math.round(avgCharsPerPage)})`,
  );
  try {
    // Whole-pipeline timeout. The per-page guard inside ocrPdf only
    // covers the recognize loop; rasterization and worker startup
    // sit outside it, so we wrap the entire promise in a hard
    // deadline so a stuck pdf-to-png-converter or tesseract worker
    // can't hold up the ingest queue forever.
    const ocr = await Promise.race<OcrResult>([
      ocrPdf(buffer, pageCount, log),
      new Promise<OcrResult>((_, reject) =>
        setTimeout(
          () => reject(new Error(`ocr pipeline timeout after ${OCR_TIMEOUT_MS}ms`)),
          OCR_TIMEOUT_MS,
        ),
      ),
    ]);
    if (ocr.text.length > text.length) {
      return {
        text: ocr.text,
        page_count: pageCount,
        warnings,
        ocr_used: true,
        ocr_pages: ocr.pagesProcessed,
        ocr_ms: ocr.elapsedMs,
      };
    }
    warnings.push(
      `pdf appears scanned but OCR produced no additional text (extracted=${text.length}b, ocr=${ocr.text.length}b)`,
    );
    return {
      text,
      page_count: pageCount,
      warnings,
      ocr_used: true,
      ocr_pages: ocr.pagesProcessed,
      ocr_ms: ocr.elapsedMs,
    };
  } catch (err) {
    warnings.push(`pdf ocr failed: ${(err as Error).message}`);
    return { text, page_count: pageCount, warnings };
  }
}

interface OcrResult {
  text: string;
  pagesProcessed: number;
  elapsedMs: number;
}

async function ocrPdf(
  buffer: Buffer,
  pageCount: number,
  log: (msg: string) => void,
): Promise<OcrResult> {
  const started = Date.now();
  const pageBudget = Math.min(pageCount, OCR_MAX_PAGES);

  const { pdfToPng } = (await import('pdf-to-png-converter')) as unknown as {
    pdfToPng: (
      data: Buffer,
      opts?: {
        viewportScale?: number;
        pagesToProcess?: number[];
        outputFolder?: string;
      },
    ) => Promise<Array<{ pageNumber: number; content: Buffer }>>;
  };
  const tesseractMod = (await import('tesseract.js')) as unknown as {
    createWorker: (lang: string) => Promise<{
      recognize: (
        image: Buffer,
      ) => Promise<{ data: { text: string } }>;
      terminate: () => Promise<void>;
    }>;
  };

  const pages = await pdfToPng(buffer, {
    viewportScale: 2.0,
    pagesToProcess: Array.from({ length: pageBudget }, (_, i) => i + 1),
  });

  const worker = await tesseractMod.createWorker(OCR_LANG);
  const parts: string[] = [];
  let processed = 0;
  try {
    for (const page of pages) {
      if (Date.now() - started > OCR_TIMEOUT_MS) {
        log(
          `[pdf-ocr] timeout after page ${processed}/${pageBudget} (${Date.now() - started}ms)`,
        );
        break;
      }
      const { data } = await worker.recognize(page.content);
      const pageText = (data?.text ?? '').trim();
      if (pageText.length > 0) {
        parts.push(pageText);
      }
      processed += 1;
      log(
        `[pdf-ocr] page ${page.pageNumber}/${pageBudget} +${pageText.length}chars`,
      );
    }
  } finally {
    try {
      await worker.terminate();
    } catch {
      /* ignore */
    }
  }

  const elapsedMs = Date.now() - started;
  const text = parts.join('\n\n').trim();
  log(
    `[pdf-ocr] done +${text.length}chars across ${processed}/${pageBudget} pages in ${elapsedMs}ms`,
  );
  return { text, pagesProcessed: processed, elapsedMs };
}
