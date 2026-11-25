/**
 * ==============================================================================
 * PRIMITIVAS MORFOLÓGICAS Y DE GRAFOS — PORT EXACTO DE SPRITE-FORGE-STUDIO
 * ==============================================================================
 * Port 100 % fiel de 09_city_world_engine.py (v6.0.0-awbw, L895-1047, L2550-2702):
 * - chaikinSmooth (0.78 / 0.22, passes=2)
 * - rasterizePolygon (ray-casting +0.01)
 * - erode4, erode8, fillHoles, connectedComponents4, keepOnly3x3Blocks, cleanLobeMask
 * - wouldMake2x2, count2x2Blobs, peel2x2, extractThinRing
 * - bfsDistance, trace4ConnNo2x2 (A* direccional 0.08*ld), closeLoopFromDeg1
 * - maxEmptySquareSide (DP exacto O(w*h))
 * ==============================================================================
 */

export const CARDINAL_DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // 0: N
  [1, 0],  // 1: E
  [0, 1],  // 2: S
  [-1, 0], // 3: W
];

export function detHash32(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function detHashInt(a: number, b: number, seed: number): number {
  let h = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(seed | 0, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function chaikinSmooth(
  pts: ReadonlyArray<readonly [number, number]>,
  passes: number = 2
): Array<[number, number]> {
  let cur: Array<[number, number]> = pts.map(([x, y]) => [x, y]);
  for (let p = 0; p < passes; p++) {
    const n = cur.length;
    if (n < 3) break;
    const nxt: Array<[number, number]> = new Array(n * 2);
    for (let i = 0; i < n; i++) {
      const p0 = cur[i];
      const p1 = cur[(i + 1) % n];
      nxt[i * 2] = [0.78 * p0[0] + 0.22 * p1[0], 0.78 * p0[1] + 0.22 * p1[1]];
      nxt[i * 2 + 1] = [0.22 * p0[0] + 0.78 * p1[0], 0.22 * p0[1] + 0.78 * p1[1]];
    }
    cur = nxt;
  }
  return cur;
}

export function rasterizePolygon(
  verts: ReadonlyArray<readonly [number, number]>,
  w: number,
  h: number
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const n = verts.length;
  if (n < 3) return mask;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const [vx, vy] = verts[i];
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy;
    if (vy > maxY) maxY = vy;
  }
  const x0 = Math.max(0, Math.floor(minX) - 1);
  const x1 = Math.min(w - 1, Math.ceil(maxX) + 1);
  const y0 = Math.max(0, Math.floor(minY) - 1);
  const y1 = Math.min(h - 1, Math.ceil(maxY) + 1);
  if (x1 < x0 || y1 < y0) return mask;

  for (let y = y0; y <= y1; y++) {
    const yf = y + 0.01;
    const rowOff = y * w;
    for (let x = x0; x <= x1; x++) {
      const xf = x + 0.01;
      let inside = false;
      for (let i = 0; i < n; i++) {
        const [xa, ya] = verts[i];
        const [xb, yb] = verts[(i + 1) % n];
        if ((ya > yf) !== (yb > yf)) {
          const denom = Math.abs(yb - ya) > 1e-6 ? yb - ya : 1e-6;
          const xInt = xa + ((yf - ya) * (xb - xa)) / denom;
          if (xf < xInt) inside = !inside;
        }
      }
      if (inside) mask[rowOff + x] = 1;
    }
  }
  return mask;
}

export function erode4(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = row + x;
      if (
        mask[idx] &&
        mask[idx - 1] &&
        mask[idx + 1] &&
        mask[idx - w] &&
        mask[idx + w]
      ) {
        out[idx] = 1;
      }
    }
  }
  return out;
}

export function erode8(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let ok = true;
      for (let dy = -1; dy <= 1 && ok; dy++) {
        const r = (y + dy) * w;
        for (let dx = -1; dx <= 1; dx++) {
          if (!mask[r + x + dx]) {
            ok = false;
            break;
          }
        }
      }
      if (ok) out[y * w + x] = 1;
    }
  }
  return out;
}

export function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  const exterior = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const pushIfZero = (x: number, y: number) => {
    const idx = y * w + x;
    if (!mask[idx] && !exterior[idx]) {
      exterior[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < w; x++) {
    pushIfZero(x, 0);
    pushIfZero(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    pushIfZero(0, y);
    pushIfZero(w - 1, y);
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx - x) / w;
    if (x > 0) pushIfZero(x - 1, y);
    if (x < w - 1) pushIfZero(x + 1, y);
    if (y > 0) pushIfZero(x, y - 1);
    if (y < h - 1) pushIfZero(x, y + 1);
  }

  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    out[i] = exterior[i] ? 0 : 1;
  }
  return out;
}

export function connectedComponents4(
  mask: Uint8Array,
  w: number,
  h: number
): { labels: Int32Array; sizes: Map<number, number> } {
  const labels = new Int32Array(w * h);
  const sizes = new Map<number, number>();
  const queue = new Int32Array(w * h);
  let nextLabel = 0;

  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i] !== 0) continue;
    nextLabel++;
    let head = 0;
    let tail = 0;
    labels[i] = nextLabel;
    queue[tail++] = i;
    let sz = 0;
    while (head < tail) {
      const cur = queue[head++];
      sz++;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      if (cx > 0 && mask[cur - 1] && labels[cur - 1] === 0) {
        labels[cur - 1] = nextLabel;
        queue[tail++] = cur - 1;
      }
      if (cx < w - 1 && mask[cur + 1] && labels[cur + 1] === 0) {
        labels[cur + 1] = nextLabel;
        queue[tail++] = cur + 1;
      }
      if (cy > 0 && mask[cur - w] && labels[cur - w] === 0) {
        labels[cur - w] = nextLabel;
        queue[tail++] = cur - w;
      }
      if (cy < h - 1 && mask[cur + w] && labels[cur + w] === 0) {
        labels[cur + w] = nextLabel;
        queue[tail++] = cur + w;
      }
    }
    sizes.set(nextLabel, sz);
  }
  return { labels, sizes };
}

export function keepOnly3x3Blocks(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let full = true;
      for (let dy = -1; dy <= 1 && full; dy++) {
        const r = (y + dy) * w;
        for (let dx = -1; dx <= 1; dx++) {
          if (!mask[r + x + dx]) {
            full = false;
            break;
          }
        }
      }
      if (full) {
        for (let dy = -1; dy <= 1; dy++) {
          const r = (y + dy) * w;
          for (let dx = -1; dx <= 1; dx++) {
            out[r + x + dx] = 1;
          }
        }
      }
    }
  }
  return out;
}

export function cleanLobeMask(
  raw: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  borderMargin: number = 2
): Uint8Array {
  const clipped = new Uint8Array(w * h);
  const bm = Math.max(1, Math.min(borderMargin, Math.floor(Math.min(w, h) / 4)));
  for (let y = bm; y < h - bm; y++) {
    const row = y * w;
    for (let x = bm; x < w - bm; x++) {
      clipped[row + x] = raw[row + x];
    }
  }

  const retainCenterCC = (m: Uint8Array): Uint8Array => {
    const { labels, sizes } = connectedComponents4(m, w, h);
    let bestCid = 0;
    if (cx >= 0 && cx < w && cy >= 0 && cy < h && labels[cy * w + cx] > 0) {
      bestCid = labels[cy * w + cx];
    } else {
      let bestSz = 0;
      for (const [cid, sz] of sizes.entries()) {
        if (sz > bestSz) {
          bestSz = sz;
          bestCid = cid;
        }
      }
    }
    const res = new Uint8Array(w * h);
    if (bestCid === 0) return res;
    for (let i = 0; i < w * h; i++) {
      if (labels[i] === bestCid) res[i] = 1;
    }
    return res;
  };

  let m = fillHoles(clipped, w, h);
  m = retainCenterCC(m);
  const m3 = keepOnly3x3Blocks(m, w, h);
  let hasAny3 = false;
  for (let i = 0; i < m3.length; i++) {
    if (m3[i]) {
      hasAny3 = true;
      break;
    }
  }
  if (!hasAny3) return m;
  m = fillHoles(m3, w, h);
  m = keepOnly3x3Blocks(m, w, h);
  return retainCenterCC(m);
}

export function orthoDegree(mask: Uint8Array, w: number, h: number, x: number, y: number): number {
  let d = 0;
  if (x > 0 && mask[y * w + x - 1]) d++;
  if (x < w - 1 && mask[y * w + x + 1]) d++;
  if (y > 0 && mask[(y - 1) * w + x]) d++;
  if (y < h - 1 && mask[(y + 1) * w + x]) d++;
  return d;
}

export function wouldMake2x2(
  roadMask: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number
): boolean {
  if (x < 0 || x >= w || y < 0 || y >= h) return true;
  const isR = (rx: number, ry: number): boolean => {
    if (rx === x && ry === y) return true;
    if (rx < 0 || rx >= w || ry < 0 || ry >= h) return false;
    return roadMask[ry * w + rx] !== 0;
  };
  for (let dy = -1; dy <= 0; dy++) {
    for (let dx = -1; dx <= 0; dx++) {
      const bx = x + dx;
      const by = y + dy;
      if (
        isR(bx, by) &&
        isR(bx + 1, by) &&
        isR(bx, by + 1) &&
        isR(bx + 1, by + 1)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function count2x2Blobs(roadMask: Uint8Array, w: number, h: number): number {
  let count = 0;
  for (let y = 0; y < h - 1; y++) {
    const r0 = y * w;
    const r1 = (y + 1) * w;
    for (let x = 0; x < w - 1; x++) {
      if (roadMask[r0 + x] && roadMask[r0 + x + 1] && roadMask[r1 + x] && roadMask[r1 + x + 1]) {
        count++;
      }
    }
  }
  return count;
}

export function peel2x2(
  roadMask: Uint8Array,
  w: number,
  h: number,
  protectedMask?: Uint8Array
): Uint8Array {
  const out = new Uint8Array(roadMask);

  const localConnectedWithout = (remSet: Set<number>, px: number, py: number): boolean => {
    const nbs: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = px + CARDINAL_DIRS[d][0];
      const ny = py + CARDINAL_DIRS[d][1];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (out[nIdx] && !remSet.has(nIdx)) nbs.push(nIdx);
    }
    if (nbs.length <= 1) return true;
    // BFS en ventana local +-4
    const visited = new Set<number>([nbs[0]]);
    const q: number[] = [nbs[0]];
    while (q.length > 0) {
      const cur = q.shift()!;
      const cx = cur % w;
      const cy = (cur - cx) / w;
      for (let d = 0; d < 4; d++) {
        const nx = cx + CARDINAL_DIRS[d][0];
        const ny = cy + CARDINAL_DIRS[d][1];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        if (Math.abs(nx - px) > 4 || Math.abs(ny - py) > 4) continue;
        const nIdx = ny * w + nx;
        if (!out[nIdx] || remSet.has(nIdx) || visited.has(nIdx)) continue;
        visited.add(nIdx);
        q.push(nIdx);
      }
    }
    return nbs.every((n) => visited.has(n));
  };

  for (let pass = 0; pass < 24; pass++) {
    let changed = false;
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const c00 = y * w + x;
        const c10 = c00 + 1;
        const c01 = c00 + w;
        const c11 = c01 + 1;
        if (!out[c00] || !out[c10] || !out[c01] || !out[c11]) continue;

        const corners: Array<[number, number, number]> = [
          [x, y, c00],
          [x + 1, y, c10],
          [x, y + 1, c01],
          [x + 1, y + 1, c11],
        ];
        // Preferir remover esquina de menor grado que no esté protegida y mantenga conectividad local
        corners.sort((a, b) => orthoDegree(out, w, h, a[0], a[1]) - orthoDegree(out, w, h, b[0], b[1]));
        let peeled = false;
        for (const [cx, cy, cIdx] of corners) {
          if (protectedMask && protectedMask[cIdx]) continue;
          const rem = new Set<number>([cIdx]);
          if (localConnectedWithout(rem, cx, cy)) {
            out[cIdx] = 0;
            changed = true;
            peeled = true;
            break;
          }
        }
        if (!peeled) {
          // Fallback: remover la esquina no protegida de menor grado
          for (const [, , cIdx] of corners) {
            if (protectedMask && protectedMask[cIdx]) continue;
            out[cIdx] = 0;
            changed = true;
            break;
          }
        }
      }
    }
    if (!changed) break;
  }
  return out;
}

export function extractThinRing(mask: Uint8Array, w: number, h: number): Uint8Array {
  const eroded = erode4(mask, w, h);
  const e4 = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    e4[i] = mask[i] && !eroded[i] ? 1 : 0;
  }
  let ring: Uint8Array = new Uint8Array(e4);

  // Puenteo de esquinas diagonales e4 a través de celdas interiores de mask sin crear 2x2
  for (let y = 0; y < h - 1; y++) {
    const r0 = y * w;
    const r1 = (y + 1) * w;
    for (let x = 0; x < w - 1; x++) {
      const a = e4[r0 + x] !== 0;
      const b = e4[r0 + x + 1] !== 0;
      const c = e4[r1 + x] !== 0;
      const d = e4[r1 + x + 1] !== 0;
      if (a && d && !b && !c) {
        if (mask[r0 + x + 1] && !wouldMake2x2(ring, w, h, x + 1, y)) {
          ring[r0 + x + 1] = 1;
        } else if (mask[r1 + x] && !wouldMake2x2(ring, w, h, x, y + 1)) {
          ring[r1 + x] = 1;
        } else if (mask[r0 + x + 1]) {
          ring[r0 + x + 1] = 1;
        } else if (mask[r1 + x]) {
          ring[r1 + x] = 1;
        }
      } else if (b && c && !a && !d) {
        if (mask[r0 + x] && !wouldMake2x2(ring, w, h, x, y)) {
          ring[r0 + x] = 1;
        } else if (mask[r1 + x + 1] && !wouldMake2x2(ring, w, h, x + 1, y + 1)) {
          ring[r1 + x + 1] = 1;
        } else if (mask[r0 + x]) {
          ring[r0 + x] = 1;
        } else if (mask[r1 + x + 1]) {
          ring[r1 + x + 1] = 1;
        }
      }
    }
  }

  ring = peel2x2(ring, w, h);

  // Podar espolones accidentales con deg < 2
  for (let pass = 0; pass < 8; pass++) {
    let anyBad = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (ring[idx] && orthoDegree(ring, w, h, x, y) < 2) {
          ring[idx] = 0;
          anyBad = true;
        }
      }
    }
    if (!anyBad) break;
  }

  return ring;
}

export function bfsDistance(seedMask: Uint8Array, w: number, h: number): Int32Array {
  const dist = new Int32Array(w * h);
  dist.fill(-1);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < w * h; i++) {
    if (seedMask[i]) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const cur = queue[head++];
    const nd = dist[cur] + 1;
    const x = cur % w;
    const y = (cur - x) / w;
    if (x > 0 && dist[cur - 1] < 0) {
      dist[cur - 1] = nd;
      queue[tail++] = cur - 1;
    }
    if (x < w - 1 && dist[cur + 1] < 0) {
      dist[cur + 1] = nd;
      queue[tail++] = cur + 1;
    }
    if (y > 0 && dist[cur - w] < 0) {
      dist[cur - w] = nd;
      queue[tail++] = cur - w;
    }
    if (y < h - 1 && dist[cur + w] < 0) {
      dist[cur + w] = nd;
      queue[tail++] = cur + w;
    }
  }
  return dist;
}

/**
 * A* direccional 4-conectado con penalización de giro, atracción lineal 0.08*ld
 * y garantía estricta de 0 bloques 2x2 (port exacto de _trace_4conn_no_2x2).
 */
export function trace4ConnNo2x2(
  roadMask: Uint8Array,
  w: number,
  h: number,
  start: readonly [number, number],
  goal: readonly [number, number],
  allowedMask: Uint8Array,
  blockedMask?: Uint8Array | null,
  targetStopMask?: Uint8Array | null,
  maxExpansions: number = 4000
): Array<[number, number]> | null {
  const [sx, sy] = start;
  const [gx, gy] = goal;
  if (sx < 0 || sx >= w || sy < 0 || sy >= h || gx < 0 || gx >= w || gy < 0 || gy >= h) {
    return null;
  }

  const vx = gx - sx;
  const vy = gy - sy;
  const vLen = Math.max(1.0, Math.hypot(vx, vy));

  // Estado codificado: (y * w + x) * 5 + dir (dir 4 = sin dirección inicial)
  const totalStates = w * h * 5;
  const gScore = new Float32Array(totalStates);
  gScore.fill(1e18);
  const parent = new Int32Array(totalStates);
  parent.fill(-1);

  const startSt = (sy * w + sx) * 5 + 4;
  gScore[startSt] = 0;

  // Min-heap simple sobre arrays paralelos
  const heapF: number[] = [Math.abs(gx - sx) + Math.abs(gy - sy)];
  const heapSt: number[] = [startSt];
  const pushHeap = (f: number, st: number) => {
    let i = heapF.length;
    heapF.push(f);
    heapSt.push(st);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapF[p] <= heapF[i]) break;
      const tf = heapF[p];
      heapF[p] = heapF[i];
      heapF[i] = tf;
      const ts = heapSt[p];
      heapSt[p] = heapSt[i];
      heapSt[i] = ts;
      i = p;
    }
  };
  const popHeap = (): number => {
    const top = heapSt[0];
    const lastF = heapF.pop()!;
    const lastSt = heapSt.pop()!;
    if (heapF.length > 0) {
      heapF[0] = lastF;
      heapSt[0] = lastSt;
      let i = 0;
      const len = heapF.length;
      while (true) {
        let s = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < len && heapF[l] < heapF[s]) s = l;
        if (r < len && heapF[r] < heapF[s]) s = r;
        if (s === i) break;
        const tf = heapF[i];
        heapF[i] = heapF[s];
        heapF[s] = tf;
        const ts = heapSt[i];
        heapSt[i] = heapSt[s];
        heapSt[s] = ts;
        i = s;
      }
    }
    return top;
  };

  let goalSt = -1;
  let expansions = 0;

  while (heapSt.length > 0 && expansions < maxExpansions) {
    const st = popHeap();
    expansions++;
    const dp = st % 5;
    const cellIdx = (st - dp) / 5;
    const x = cellIdx % w;
    const y = (cellIdx - x) / w;
    const g = gScore[st];

    if (
      (x === gx && y === gy) ||
      (targetStopMask && cellIdx !== sy * w + sx && targetStopMask[cellIdx])
    ) {
      goalSt = st;
      break;
    }

    for (let dn = 0; dn < 4; dn++) {
      const nx = x + CARDINAL_DIRS[dn][0];
      const ny = y + CARDINAL_DIRS[dn][1];
      if (nx < 1 || nx >= w - 1 || ny < 1 || ny >= h - 1) continue;
      const nIdx = ny * w + nx;
      const isTarget = (nx === gx && ny === gy) || (targetStopMask ? targetStopMask[nIdx] !== 0 : false);
      if (!isTarget) {
        if (!allowedMask[nIdx] && !roadMask[nIdx]) continue;
        if (blockedMask && blockedMask[nIdx] && !roadMask[nIdx]) continue;
        if (!roadMask[nIdx] && wouldMake2x2(roadMask, w, h, nx, ny)) continue;
      }
      const stepC = roadMask[nIdx] ? 0.35 : 1.0;
      const turnC = dp < 4 && dp !== dn ? 0.65 : 0.0;
      const ld = Math.abs((nx - sx) * vy - (ny - sy) * vx) / vLen;
      const ng = g + stepC + turnC + 0.08 * ld;
      const nSt = nIdx * 5 + dn;
      if (ng < gScore[nSt]) {
        gScore[nSt] = ng;
        parent[nSt] = st;
        pushHeap(ng + Math.abs(gx - nx) + Math.abs(gy - ny), nSt);
      }
    }
  }

  if (goalSt < 0) return null;
  const pts: Array<[number, number]> = [];
  let cur = goalSt;
  while (cur >= 0) {
    const cellIdx = Math.floor(cur / 5);
    const x = cellIdx % w;
    const y = (cellIdx - x) / w;
    pts.push([x, y]);
    cur = parent[cur];
  }
  pts.reverse();
  return pts;
}

/**
 * Cierra un bucle desde una punta deg==1 sin retroceder ni crear bloques 2x2
 * (port exacto de _close_loop_from_deg1, L2642-2702).
 */
export function closeLoopFromDeg1(
  roadMask: Uint8Array,
  buildingsMask: Uint8Array,
  allowedMask: Uint8Array,
  protectedMask: Uint8Array | null,
  w: number,
  h: number,
  start: readonly [number, number],
  avoidPt: readonly [number, number] | null,
  maxLen: number = 10,
  bbox?: readonly [number, number, number, number],
  blockedMask?: Uint8Array | null
): boolean {
  const [sx, sy] = start;
  const bx0 = bbox ? Math.max(1, bbox[0]) : 1;
  const by0 = bbox ? Math.max(1, bbox[1]) : 1;
  const bx1 = bbox ? Math.min(w - 2, bbox[2]) : w - 2;
  const by1 = bbox ? Math.min(h - 2, bbox[3]) : h - 2;

  const startIdx = sy * w + sx;
  const parent = new Int32Array(w * h);
  parent.fill(-2);
  parent[startIdx] = -1;

  const qIdx: number[] = [startIdx];
  const qDist: number[] = [0];
  let head = 0;
  let hit = -1;

  while (head < qIdx.length) {
    const cur = qIdx[head];
    const dist = qDist[head];
    head++;
    if (dist >= maxLen) continue;
    const ux = cur % w;
    const uy = (cur - ux) / w;

    for (let d = 0; d < 4; d++) {
      const vx = ux + CARDINAL_DIRS[d][0];
      const vy = uy + CARDINAL_DIRS[d][1];
      if (vx < bx0 || vx > bx1 || vy < by0 || vy > by1) continue;
      if (dist === 0 && avoidPt && vx === avoidPt[0] && vy === avoidPt[1]) continue;
      const vIdx = vy * w + vx;
      if (parent[vIdx] !== -2) continue;
      if (buildingsMask[vIdx] || !allowedMask[vIdx]) continue;
      if (protectedMask && protectedMask[vIdx]) continue;
      if (blockedMask && blockedMask[vIdx] && !roadMask[vIdx]) continue;

      if (roadMask[vIdx]) {
        if (dist >= 1) {
          parent[vIdx] = cur;
          hit = vIdx;
          break;
        }
        continue;
      }
      if (wouldMake2x2(roadMask, w, h, vx, vy)) continue;
      parent[vIdx] = cur;
      qIdx.push(vIdx);
      qDist.push(dist + 1);
    }
    if (hit >= 0) break;
  }

  if (hit < 0) return false;

  const pathIndices: number[] = [];
  let cur = hit;
  while (cur >= 0) {
    pathIndices.push(cur);
    cur = parent[cur];
  }

  // Verificar incrementalmente que no cree ningún bloque 2x2
  const temp = new Uint8Array(roadMask);
  for (let i = 0; i < pathIndices.length; i++) {
    const pIdx = pathIndices[i];
    if (!temp[pIdx]) {
      const px = pIdx % w;
      const py = (pIdx - px) / w;
      if (wouldMake2x2(temp, w, h, px, py)) return false;
      temp[pIdx] = 1;
    }
  }
  for (let i = 0; i < pathIndices.length; i++) {
    roadMask[pathIndices[i]] = 1;
  }
  return true;
}

/**
 * DP exacto O(w*h) para el lado del cuadrado todo-1 más grande en mask
 * (port exacto de _max_empty_square_side, L965-981).
 */
export function maxEmptySquareSide(mask: Uint8Array, w: number, h: number): number {
  const dp = new Int32Array(w * h);
  let maxSide = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const idx = row + x;
      if (!mask[idx]) continue;
      if (x === 0 || y === 0) {
        dp[idx] = 1;
      } else {
        const a = dp[idx - w];
        const b = dp[idx - 1];
        const c = dp[idx - w - 1];
        dp[idx] = 1 + (a < b ? (a < c ? a : c) : (b < c ? b : c));
      }
      if (dp[idx] > maxSide) maxSide = dp[idx];
    }
  }
  return maxSide;
}
