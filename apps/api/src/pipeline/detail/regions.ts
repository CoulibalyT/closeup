import sharp from 'sharp';

/** One byte per pixel, as sharp gives a greyscale raw buffer. */
export interface GreyImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface DetailOptions {
  /** Cells per side. */
  grid: number;
  /** Weight of a corner cell against 1 at the centre: the subject is framed in the middle. */
  edgeWeight: number;
  minPoints: number;
  maxPoints: number;
  /** Distance between two points, in radii. */
  separationRadii: number;
  /** Mean |Laplacian| (0..1) the best cell must reach, or the picture has no detail to show. */
  threshold: number;
}

export const DETAIL: DetailOptions = {
  grid: 10,
  edgeWeight: 0.4,
  minPoints: 2,
  maxPoints: 5,
  separationRadii: 2.5,
  threshold: 0.02,
};

/** The thumbnail's longest side: enough cells of enough pixels, and a few milliseconds. */
const THUMB_PX = 96;

/** The house scale: the 22 hand-drawn cards use about 6 % of the shorter side. */
export const objectRadius = (size: { width: number; height: number }): number =>
  Math.round(0.06 * Math.min(size.width, size.height));

/** A zoom point nobody placed, in the pixels of the stored original. */
export interface AutoPoint {
  x: number;
  y: number;
  baseRadius: number;
  labelFr: null;
  labelEn: null;
  weight: 1;
  origin: 'AUTO';
}

/**
 * How much edge and texture each cell of a grid holds: the mean absolute Laplacian of its pixels,
 * scaled to 0..1. Border pixels count as zero, which costs nothing at 96 px.
 */
export function cellEnergies(
  img: GreyImage,
  grid: number,
): { cols: number; rows: number; energy: Float64Array } {
  const { data, width, height } = img;
  const cols = Math.min(grid, width);
  const rows = Math.min(grid, height);
  const sum = new Float64Array(cols * rows);
  const count = new Float64Array(cols * rows);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const lap = 4 * data[i]! - data[i - 1]! - data[i + 1]! - data[i - width]! - data[i + width]!;
      const cell = Math.floor((y * rows) / height) * cols + Math.floor((x * cols) / width);
      sum[cell]! += Math.abs(lap) / (4 * 255);
      count[cell]! += 1;
    }
  }
  const energy = new Float64Array(cols * rows);
  for (let c = 0; c < energy.length; c++) energy[c] = count[c] ? sum[c]! / count[c]! : 0;
  return { cols, rows, energy };
}

/**
 * The 2 to 5 places of a picture worth a close-up: the cells with the most detail, weighted
 * towards the centre, kept apart from each other and off the edges. Null when the picture is
 * too plain, so that the admin looks instead.
 */
export function pickDetailRegions(
  img: GreyImage,
  size: { width: number; height: number },
  radiusPx: number,
  options: Partial<DetailOptions> = {},
): { x: number; y: number }[] | null {
  const opt = { ...DETAIL, ...options };
  const { cols, rows, energy } = cellEnergies(img, opt.grid);
  if (Math.max(...energy) < opt.threshold) return null;

  const cells = [...energy]
    .map((value, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = ((col + 0.5) / cols) * size.width;
      const y = ((row + 0.5) / rows) * size.height;
      // 0 at the centre, 1 at a corner.
      const d =
        Math.hypot(
          (x - size.width / 2) / (size.width / 2),
          (y - size.height / 2) / (size.height / 2),
        ) / Math.SQRT2;
      const weighted = value * (1 - (1 - opt.edgeWeight) * d);
      return { x: Math.round(x), y: Math.round(y), value, weighted };
    })
    .filter((cell) => cell.value >= opt.threshold)
    .filter(
      (cell) =>
        cell.x >= radiusPx &&
        cell.y >= radiusPx &&
        cell.x <= size.width - radiusPx &&
        cell.y <= size.height - radiusPx,
    )
    .sort((a, b) => b.weighted - a.weighted);

  const chosen: { x: number; y: number }[] = [];
  const apart = opt.separationRadii * radiusPx;
  for (const cell of cells) {
    if (chosen.length === opt.maxPoints) break;
    if (chosen.some((p) => Math.hypot(p.x - cell.x, p.y - cell.y) < apart)) continue;
    chosen.push({ x: cell.x, y: cell.y });
  }
  return chosen.length >= opt.minPoints ? chosen : null;
}

/** The stored original, reduced to a grey thumbnail, to the points of an object card. */
export async function detailZoomPoints(
  original: Buffer,
  size: { width: number; height: number },
): Promise<AutoPoint[] | null> {
  const { data, info } = await sharp(original)
    .resize(THUMB_PX, THUMB_PX, { fit: 'inside' })
    .greyscale()
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const regions = pickDetailRegions(
    {
      data: new Uint8Array(data.buffer, data.byteOffset, data.length),
      width: info.width,
      height: info.height,
    },
    size,
    objectRadius(size),
  );
  return (
    regions?.map((p) => ({
      ...p,
      baseRadius: objectRadius(size),
      labelFr: null,
      labelEn: null,
      weight: 1 as const,
      origin: 'AUTO' as const,
    })) ?? null
  );
}
