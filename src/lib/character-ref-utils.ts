import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { CharacterReferenceLayout } from "@/lib/ai/prompts/registry-character";

const LAYOUT_COLS: Record<Exclude<CharacterReferenceLayout, "single">, number> = {
  "three-view": 3,
  "four-view": 2,
};

const LAYOUT_ROWS: Record<Exclude<CharacterReferenceLayout, "single">, number> = {
  "three-view": 1,
  "four-view": 2,
};

const CELL_MARGIN_RATIO = 0.05;

export interface CharacterReferencePortraitResult {
  portraitPath: string;
  sourceWidth: number;
  sourceHeight: number;
  cellWidth: number;
  cellHeight: number;
  detectedLayout: "horizontal" | "vertical" | "grid";
}

/**
 * Extract a single-character portrait from a multi-view reference image.
 *
 * The character generator may produce images in three shapes:
 *   - horizontal strip (1x3 / 1x4) when the requested aspect ratio is wide
 *   - vertical strip   (3x1 / 4x1) when the aspect ratio is tall
 *   - 2x2 grid         when the aspect ratio is roughly square
 *
 * We auto-detect which by the actual image dimensions, since the model does
 * not always honor the requested layout exactly. The front view is taken
 * from the top-left cell after applying a small white-border margin.
 *
 * Returns a path relative to the upload dir. Returns null when the input
 * is already a single portrait.
 */
export async function extractCharacterReferencePortrait(
  imagePath: string,
  layout: CharacterReferenceLayout,
): Promise<string | null> {
  if (layout === "single") return null;

  const inputPath = path.isAbsolute(imagePath)
    ? imagePath
    : path.join(process.env.UPLOAD_DIR || "./uploads", imagePath);
  const inputBuf = await fs.readFile(inputPath);
  const meta = await sharp(inputBuf).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Could not read dimensions of ${inputPath}`);
  }

  // Auto-detect the actual grid from the image aspect ratio. The model is
  // free to rearrange the requested layout into a strip if it finds that
  // easier, so we trust the rendered shape over the requested layout.
  const aspect = meta.width / meta.height;
  const expectedCols = LAYOUT_COLS[layout];
  const expectedRows = LAYOUT_ROWS[layout];
  let cols = expectedCols;
  let rows = expectedRows;
  let detectedLayout: "horizontal" | "vertical" | "grid";
  if (aspect > 1.4) {
    detectedLayout = "horizontal";
    rows = 1;
    cols = layout === "three-view" ? 3 : 4;
  } else if (aspect < 0.7) {
    detectedLayout = "vertical";
    cols = 1;
    rows = layout === "three-view" ? 3 : 4;
  } else {
    detectedLayout = "grid";
    cols = expectedCols;
    rows = expectedRows;
  }

  const cellWidth = Math.floor(meta.width / cols);
  const cellHeight = Math.floor(meta.height / rows);
  const marginX = Math.max(1, Math.floor(cellWidth * CELL_MARGIN_RATIO));
  const marginY = Math.max(1, Math.floor(cellHeight * CELL_MARGIN_RATIO));

  const left = marginX;
  const top = marginY;
  const width = cellWidth - 2 * marginX;
  const height = cellHeight - 2 * marginY;

  const croppedBuf = await sharp(inputBuf)
    .extract({ left, top, width, height })
    .toBuffer();
  const croppedMeta = await sharp(croppedBuf).metadata();
  const croppedW = croppedMeta.width ?? width;
  const croppedH = croppedMeta.height ?? height;
  const maxDim = Math.max(croppedW, croppedH);
  const padX = Math.floor((maxDim - croppedW) / 2);
  const padY = Math.floor((maxDim - croppedH) / 2);

  const parsed = path.parse(imagePath);
  const portraitFileName = `${parsed.name}_single${parsed.ext}`;
  const uploadDir = process.env.UPLOAD_DIR || "./uploads";
  const portraitAbsPath = path.isAbsolute(imagePath)
    ? path.join(path.dirname(imagePath), portraitFileName)
    : path.join(uploadDir, parsed.dir, portraitFileName);
  const portraitRelPath = path.isAbsolute(imagePath)
    ? path.relative(uploadDir, portraitAbsPath)
    : path.join(parsed.dir, portraitFileName);

  await sharp(croppedBuf)
    .extend({
      top: padY,
      bottom: maxDim - croppedH - padY,
      left: padX,
      right: maxDim - croppedW - padX,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toFile(portraitAbsPath);

  return portraitRelPath;
}

// (no helpers re-exported below — `extractCharacterReferencePortrait` is the
// only public surface of this module)
