/**
 * Image OCR via tesseract.js.
 *
 * Tesseract is fast and dumb. Good enough for cleanly-scanned manual
 * pages, photos of whiteboards in good lighting. Bad on noisy
 * photos. Run as a one-shot per upload.
 *
 * The vision-model upgrade (LLaVA / Qwen-VL via ollama) is opt-in
 * via DEVNEURAL_IMAGE_VISION_MODEL and lands later.
 */
export interface ImageExtractResult {
  text: string;
  warnings: string[];
}

export async function extractImage(
  filePath: string,
): Promise<ImageExtractResult> {
  const warnings: string[] = [];
  try {
    const tesseract = (await import('tesseract.js')) as unknown as {
      recognize: (
        path: string,
        lang: string,
        opts?: Record<string, unknown>,
      ) => Promise<{ data: { text: string } }>;
    };
    const result = await tesseract.recognize(filePath, 'eng');
    const text = (result.data.text ?? '').trim();
    if (text.length < 20) {
      warnings.push(
        'OCR yielded very little text; the image may be too noisy or text-free.',
      );
    }
    return { text, warnings };
  } catch (err) {
    return {
      text: '',
      warnings: [`tesseract OCR failed: ${(err as Error).message}`],
    };
  }
}
