/** Number of segments per organic edge curve. More = smoother. */
export const CURVE_SEGMENTS = 24;

/**
 * Deterministic pseudo-random float in [0,1] from two integer seeds.
 * Uses integer multiply-xorshift — no external library required.
 */
function seededRand(seed: number, index: number): number {
  let h = ((seed * 2654435761) ^ (index * 1234567891)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

/**
 * Catmull-Rom basis evaluation at local parameter t in [0,1]
 * through segment defined by four consecutive control points.
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t
  );
}

/**
 * Generate an organic Catmull-Rom spline between two 3-D points.
 * Three noise-displaced midpoints create the curve shape; driftTime
 * adds a slow sinusoidal oscillation on top for the living-synapse effect.
 *
 * @param sx,sy,sz  Source point
 * @param tx,ty,tz  Target point
 * @param seed      Integer seed derived from edge IDs — same seed = same base shape
 * @param driftTime Monotonically increasing time value (seconds * 0.3) for animation
 * @returns         Flat Float32Array of (CURVE_SEGMENTS+1)*3 values [x,y,z, x,y,z, ...]
 */
export function generateEdgeCurve(
  sx: number, sy: number, sz: number,
  tx: number, ty: number, tz: number,
  seed: number,
  driftTime = 0,
): Float32Array {
  const n = CURVE_SEGMENTS + 1;
  const positions = new Float32Array(n * 3);

  const dx = tx - sx, dy = ty - sy, dz = tz - sz;
  const edgeLen = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // Degenerate edge — all positions at src
  if (edgeLen < 0.001) {
    for (let i = 0; i < n; i++) {
      positions[i * 3] = sx;
      positions[i * 3 + 1] = sy;
      positions[i * 3 + 2] = sz;
    }
    return positions;
  }

  // Unit direction vector
  const ux = dx / edgeLen, uy = dy / edgeLen, uz = dz / edgeLen;

  // Perpendicular basis vectors (perp1, perp2) for displacement
  let rx = 0, ry = 1, rz = 0;
  if (Math.abs(uy) > 0.9) { rx = 1; ry = 0; rz = 0; }
  // perp1 = normalize(u × right)
  let p1x = uy * rz - uz * ry;
  let p1y = uz * rx - ux * rz;
  let p1z = ux * ry - uy * rx;
  const p1len = Math.sqrt(p1x * p1x + p1y * p1y + p1z * p1z);
  p1x /= p1len; p1y /= p1len; p1z /= p1len;
  // perp2 = u × perp1 (already unit length)
  const p2x = uy * p1z - uz * p1y;
  const p2y = uz * p1x - ux * p1z;
  const p2z = ux * p1y - uy * p1x;

  // 5 Catmull-Rom control points: [src, mid1, mid2, mid3, tgt]
  const cx = new Float32Array(5);
  const cy = new Float32Array(5);
  const cz = new Float32Array(5);
  cx[0] = sx; cy[0] = sy; cz[0] = sz;
  cx[4] = tx; cy[4] = ty; cz[4] = tz;

  const ctrlT = [0.25, 0.5, 0.75];
  for (let i = 0; i < 3; i++) {
    const t = ctrlT[i];
    const bx = sx + dx * t, by = sy + dy * t, bz = sz + dz * t;
    const d1 = (seededRand(seed, i * 2) * 2 - 1) * edgeLen * 0.03;
    const d2 = (seededRand(seed, i * 2 + 1) * 2 - 1) * edgeLen * 0.03;
    const driftAmp = edgeLen * 0.05 * (0.4 + seededRand(seed, i + 10) * 0.6);
    const driftFreq = 0.25 + seededRand(seed, i + 20) * 0.15;
    const driftPhase = seededRand(seed, i + 30) * Math.PI * 2;
    const drift = driftAmp * Math.sin(driftTime * driftFreq * Math.PI * 2 + driftPhase);

    cx[i + 1] = bx + p1x * (d1 + drift) + p2x * d2;
    cy[i + 1] = by + p1y * (d1 + drift) + p2y * d2;
    cz[i + 1] = bz + p1z * (d1 + drift) + p2z * d2;
  }

  // Sample Catmull-Rom spline at CURVE_SEGMENTS+1 evenly-spaced points
  for (let v = 0; v < n; v++) {
    const tGlobal = v / (n - 1);
    const seg = Math.min(Math.floor(tGlobal * 4), 3);
    const tLocal = tGlobal * 4 - seg;
    const i0 = Math.max(0, seg - 1);
    const i1 = seg;
    const i2 = Math.min(4, seg + 1);
    const i3 = Math.min(4, seg + 2);

    positions[v * 3]     = catmullRom(cx[i0], cx[i1], cx[i2], cx[i3], tLocal);
    positions[v * 3 + 1] = catmullRom(cy[i0], cy[i1], cy[i2], cy[i3], tLocal);
    positions[v * 3 + 2] = catmullRom(cz[i0], cz[i1], cz[i2], cz[i3], tLocal);
  }

  return positions;
}
