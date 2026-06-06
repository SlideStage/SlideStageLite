/**
 * Pure PDF assembly: turn an ordered list of slide PNG rasters into a
 * one-slide-per-page PDF whose pages match the deck's native aspect
 * ratio.
 *
 * This module is intentionally DOM-free and side-effect-free so it can be
 * unit-tested in node/jsdom. Capturing the rasters
 * (`slidePdfCapture.ts`) and saving the bytes (`downloadPdf.ts`) live
 * elsewhere.
 *
 * `pdf-lib` is imported dynamically so it lands in its own lazy chunk —
 * the ~300 KB library only loads when the user actually exports, keeping
 * the initial app payload lean.
 */
export interface SlidePdfPage {
  /** Encoded PNG bytes for one slide. */
  png: Uint8Array;
}

export interface BuildSlidesPdfOptions {
  /** Page width in PDF points (use the deck's logical slide width). */
  pageWidth: number;
  /** Page height in PDF points (use the deck's logical slide height). */
  pageHeight: number;
  /** Optional document title metadata. */
  title?: string;
}

/**
 * Assemble `pages` into a single PDF. Each page is sized to
 * `[pageWidth, pageHeight]` (in points) and the slide raster is drawn to
 * fill it edge-to-edge, so the higher-resolution capture stays crisp
 * while the page keeps the deck's native aspect ratio.
 *
 * Throws when there are no pages or the page dimensions are invalid so
 * callers never produce an empty/0×0 PDF.
 */
export async function buildSlidesPdf(
  pages: ReadonlyArray<SlidePdfPage>,
  options: BuildSlidesPdfOptions,
): Promise<Uint8Array> {
  if (pages.length === 0) {
    throw new Error('buildSlidesPdf: no pages to render');
  }
  const { pageWidth, pageHeight, title } = options;
  if (
    !Number.isFinite(pageWidth) ||
    !Number.isFinite(pageHeight) ||
    pageWidth <= 0 ||
    pageHeight <= 0
  ) {
    throw new Error('buildSlidesPdf: invalid page dimensions');
  }

  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setProducer('SlideStage Lite');
  doc.setCreator('SlideStage Lite');
  if (title && title.trim().length > 0) {
    doc.setTitle(title);
  }

  for (const { png } of pages) {
    const image = await doc.embedPng(png);
    const page = doc.addPage([pageWidth, pageHeight]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    });
  }

  return doc.save();
}
