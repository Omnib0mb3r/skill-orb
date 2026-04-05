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
 *
 * Uses cumulative direction jitter (inspired by wandering-path dendrite
 * techniques) — each control point perturbs the heading from the previous
 * step, creating naturally wandering neural-dendrite shapes instead of
 * smooth arcs.  A linear error correction distributes the endpoint miss
 * evenly so the curve still connects source → target exactly.
 * driftTime adds a slow sinusoidal oscillation for the living-synapse effect.
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
  const N_CTRL = 8;           // 8 control points → 7 Catmull-Rom segments
  const JITTER = 0.12;        // direction-wander intensity per step
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

  const stepLen = edgeLen / (N_CTRL - 1);

  // ── Walk from source with cumulative direction jitter ──────────────
  let cDirX = dx / edgeLen;
  let cDirY = dy / edgeLen;
  let cDirZ = dz / edgeLen;

  const cx = new Float32Array(N_CTRL);
  const cy = new Float32Array(N_CTRL);
  const cz = new Float32Array(N_CTRL);
  cx[0] = sx; cy[0] = sy; cz[0] = sz;

  let currX = sx, currY = sy, currZ = sz;

  for (let i = 1; i < N_CTRL; i++) {
    // Perturb direction (cumulative — path wanders like a dendrite)
    cDirX += (seededRand(seed, i * 3)     - 0.5) * JITTER;
    cDirY += (seededRand(seed, i * 3 + 1) - 0.5) * JITTER;
    cDirZ += (seededRand(seed, i * 3 + 2) - 0.5) * JITTER;

    // Re-normalize
    const len = Math.sqrt(cDirX * cDirX + cDirY * cDirY + cDirZ * cDirZ);
    cDirX /= len; cDirY /= len; cDirZ /= len;

    currX += cDirX * stepLen;
    currY += cDirY * stepLen;
    currZ += cDirZ * stepLen;

    cx[i] = currX;
    cy[i] = currY;
    cz[i] = currZ;
  }

  // ── Linear error correction — ensure last point == target ──────────
  const errX = tx - cx[N_CTRL - 1];
  const errY = ty - cy[N_CTRL - 1];
  const errZ = tz - cz[N_CTRL - 1];
  for (let i = 1; i < N_CTRL; i++) {
    const t = i / (N_CTRL - 1);
    cx[i] += errX * t;
    cy[i] += errY * t;
    cz[i] += errZ * t;
  }

  // ── Drift animation on interior control points ─────────────────────
  // Perpendicular basis for drift displacement
  const ux = dx / edgeLen, uy = dy / edgeLen, uz = dz / edgeLen;
  let rx = 0, ry = 1, rz = 0;
  if (Math.abs(uy) > 0.9) { rx = 1; ry = 0; rz = 0; }
  let p1x = uy * rz - uz * ry;
  let p1y = uz * rx - ux * rz;
  let p1z = ux * ry - uy * rx;
  const p1len = Math.sqrt(p1x * p1x + p1y * p1y + p1z * p1z);
  p1x /= p1len; p1y /= p1len; p1z /= p1len;

  for (let i = 1; i < N_CTRL - 1; i++) {
    const driftAmp = edgeLen * 0.05 * (0.4 + seededRand(seed, i + 10) * 0.6);
    const driftFreq = 0.25 + seededRand(seed, i + 20) * 0.15;
    const driftPhase = seededRand(seed, i + 30) * Math.PI * 2;
    const drift = driftAmp * Math.sin(driftTime * driftFreq * Math.PI * 2 + driftPhase);

    cx[i] += p1x * drift;
    cy[i] += p1y * drift;
    cz[i] += p1z * drift;
  }

  // ── Sample Catmull-Rom spline through all N_CTRL points ────────────
  const segs = N_CTRL - 1;
  for (let v = 0; v < n; v++) {
    const tGlobal = v / (n - 1);
    const seg = Math.min(Math.floor(tGlobal * segs), segs - 1);
    const tLocal = tGlobal * segs - seg;
    const i0 = Math.max(0, seg - 1);
    const i1 = seg;
    const i2 = Math.min(N_CTRL - 1, seg + 1);
    const i3 = Math.min(N_CTRL - 1, seg + 2);

    positions[v * 3]     = catmullRom(cx[i0], cx[i1], cx[i2], cx[i3], tLocal);
    positions[v * 3 + 1] = catmullRom(cy[i0], cy[i1], cy[i2], cy[i3], tLocal);
    positions[v * 3 + 2] = catmullRom(cz[i0], cz[i1], cz[i2], cz[i3], tLocal);
  }

  return positions;
}
