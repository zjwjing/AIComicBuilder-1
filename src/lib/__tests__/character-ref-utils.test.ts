import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { extractCharacterReferencePortrait } from "../character-ref-utils";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "character-ref-utils-"));
  process.env.UPLOAD_DIR = tmpDir;
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
});

async function makeImage(width: number, height: number, color: { r: number; g: number; b: number }) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .png()
    .toBuffer();
}

describe("extractCharacterReferencePortrait", () => {
  it("returns null for single layout", async () => {
    const result = await extractCharacterReferencePortrait("characters/single.png", "single");
    expect(result).toBeNull();
  });

  it("crops the top-left cell of a 2x2 grid (four-view) with square source", async () => {
    // 1000x1000 (aspect 1.0) → grid detector → 2x2
    // cellWidth=500, cellHeight=500, margin=25, crop=450x450, no padding
    const buf = await makeImage(1000, 1000, { r: 0, g: 0, b: 0 });
    const fileName = "characters/grid.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBe(path.join("characters", "grid_single.png"));
    const meta = await sharp(path.join(tmpDir, "characters", "grid_single.png")).metadata();
    expect(meta.width).toBe(450);
    expect(meta.height).toBe(450);
  });

  it("pads cropped cell to white square when source cells are non-square", async () => {
    // Use 1200x1000 (aspect 1.2) → grid path → 2x2 with rectangular cells.
    // cellWidth=600, cellHeight=500, margin 30/25, crop 540x450,
    // maxDim 540 → padX=0, padY=45 → 540x540 white-padded square.
    const buf = await makeImage(1200, 1000, { r: 0, g: 0, b: 0 });
    const fileName = "characters/rect.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBe(path.join("characters", "rect_single.png"));
    const out = path.join(tmpDir, "characters", "rect_single.png");
    const meta = await sharp(out).metadata();
    expect(meta.width).toBe(540);
    expect(meta.height).toBe(540);
    // top-center should be padding (white)
    const top = await sharp(out)
      .extract({ left: 269, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(Array.from(top)).toEqual([255, 255, 255]);
    // center should be original cell content (black)
    const center = await sharp(out)
      .extract({ left: 269, top: 269, width: 1, height: 1 })
      .raw()
      .toBuffer();
    expect(Array.from(center)).toEqual([0, 0, 0]);
  });

  it("crops the left cell of a horizontal 3-view strip", async () => {
    const buf = await makeImage(1500, 500, { r: 0, g: 0, b: 0 });
    const fileName = "characters/strip3h.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "three-view");
    expect(rel).toBe(path.join("characters", "strip3h_single.png"));
    const croppedAbs = path.join(tmpDir, "characters", "strip3h_single.png");
    const meta = await sharp(croppedAbs).metadata();
    // aspect 3.0 → horizontal strip, cols=3
    // cellWidth = 500, cellHeight = 500
    // margin = 5% of 500 = 25; crop = 500 - 50 = 450
    // maxDim = 450, padded square = 450x450
    expect(meta.width).toBe(450);
    expect(meta.height).toBe(450);
  });

  it("crops the top cell of a vertical 4-view strip", async () => {
    const buf = await makeImage(500, 2000, { r: 0, g: 0, b: 0 });
    const fileName = "characters/strip4v.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBe(path.join("characters", "strip4v_single.png"));
    const croppedAbs = path.join(tmpDir, "characters", "strip4v_single.png");
    const meta = await sharp(croppedAbs).metadata();
    // aspect 0.25 → vertical strip, rows=4
    // cellWidth = 500, cellHeight = 500
    // margin = 5% of 500 = 25; crop = 500 - 50 = 450
    expect(meta.width).toBe(450);
    expect(meta.height).toBe(450);
  });

  it("falls back to the requested grid when aspect is roughly square", async () => {
    // aspect 1.2 — between 0.7 and 1.4 → "grid"
    const buf = await makeImage(1200, 1000, { r: 0, g: 0, b: 0 });
    const fileName = "characters/square.png";
    await fs.mkdir(path.join(tmpDir, "characters"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBe(path.join("characters", "square_single.png"));
    const croppedAbs = path.join(tmpDir, "characters", "square_single.png");
    const meta = await sharp(croppedAbs).metadata();
    // 2x2 grid: cellWidth=600, cellHeight=500
    // marginX = 30, marginY = 25; crop = 540 × 450
    // maxDim = 540, padded square 540x540
    expect(meta.width).toBe(540);
    expect(meta.height).toBe(540);
  });

  it("returns a path that round-trips through uploadUrl's normalization", async () => {
    const buf = await makeImage(1024, 1024, { r: 0, g: 0, b: 0 });
    const fileName = "characters/sub/foo.png";
    await fs.mkdir(path.join(tmpDir, "characters", "sub"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, fileName), buf);

    const rel = await extractCharacterReferencePortrait(fileName, "four-view");
    expect(rel).toBe(path.join("characters", "sub", "foo_single.png"));
    // uploadUrl strips everything before "uploads/" — the relative path
    // produced by the helper must survive that normalization.
    const normalized = (rel as string).replace(/\\/g, "/").replace(/^.*?uploads\//, "");
    expect(normalized).toBe("characters/sub/foo_single.png");
  });
});
