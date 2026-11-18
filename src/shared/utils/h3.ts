// ==============================================================================
// INDEXACIÓN HEXAGONAL H3 RESOLUCIÓN 9 (~174m) Y RESOLUCIÓN 4 (AGRUPACIÓN REGIONAL)
// ==============================================================================

export const H3_RES9_EDGE_METERS = 174;

function getH3Constants() {
  return {
    edgeMeters: 174,
    res9Prefix: 0x0009000000000000n,
    res4Prefix: 0x0004000000000000n,
    axialBias: 8_388_608n,
    axialMask: 0xFFFFFFn,
    mercatorR: 6_378_137,
  };
}

function packH3Axial(prefix: bigint, q: number, r: number): bigint {
  const { axialBias, axialMask } = getH3Constants();
  const pq = (BigInt(q) + axialBias) & axialMask;
  const pr = (BigInt(r) + axialBias) & axialMask;
  return prefix | (pq << 24n) | pr;
}

function unpackH3Axial(h3Index: bigint): { q: number; r: number } {
  const { axialBias, axialMask } = getH3Constants();
  const q = Number(((h3Index >> 24n) & axialMask) - axialBias);
  const r = Number((h3Index & axialMask) - axialBias);
  return { q, r };
}

function axialRound(qf: number, rf: number): { q: number; r: number } {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const qDiff = Math.abs(q - qf);
  const rDiff = Math.abs(r - rf);
  const sDiff = Math.abs(s - sf);

  if (qDiff > rDiff && qDiff > sDiff) {
    q = -r - s;
  } else if (rDiff > sDiff) {
    r = -q - s;
  }
  return { q, r };
}

export function latLngToH3Res9(lat: number, lng: number): bigint {
  const { edgeMeters, res9Prefix, mercatorR } = getH3Constants();
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const xM = ((lng * Math.PI) / 180) * mercatorR;
  const yM =
    Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360)) * mercatorR;

  const qf = ((Math.sqrt(3) / 3) * xM - (1 / 3) * yM) / edgeMeters;
  const rf = ((2 / 3) * yM) / edgeMeters;
  const { q, r } = axialRound(qf, rf);
  return packH3Axial(res9Prefix, q, r);
}

export function h3Res9ToLatLng(h3Index: bigint): [number, number] {
  const { edgeMeters, mercatorR } = getH3Constants();
  const { q, r } = unpackH3Axial(h3Index);
  const xM = edgeMeters * Math.sqrt(3) * (q + r / 2);
  const yM = edgeMeters * 1.5 * r;
  const lng = (xM / mercatorR) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(yM / mercatorR)) - Math.PI / 2) * (180 / Math.PI);
  return [Number(lat.toFixed(6)), Number(lng.toFixed(6))];
}

export function h3Res9ToParentRes4(h3Index: bigint): bigint {
  const { res4Prefix } = getH3Constants();
  const { q, r } = unpackH3Axial(h3Index);
  return packH3Axial(res4Prefix, Math.floor(q / 32), Math.floor(r / 32));
}

export function h3GridDistance(h3A: bigint, h3B: bigint): number {
  const a = unpackH3Axial(h3A);
  const b = unpackH3Axial(h3B);
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return Math.round((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2);
}

export function h3GridDisk(originH3: bigint, radiusRings: number): bigint[] {
  const { res9Prefix } = getH3Constants();
  const k = Math.max(0, Math.floor(radiusRings));
  const { q, r } = unpackH3Axial(originH3);
  const result: bigint[] = [];
  for (let dq = -k; dq <= k; dq++) {
    const rMin = Math.max(-k, -dq - k);
    const rMax = Math.min(k, -dq + k);
    for (let dr = rMin; dr <= rMax; dr++) {
      result.push(packH3Axial(res9Prefix, q + dq, r + dr));
    }
  }
  return result;
}

export function h3GridPathCells(startH3: bigint, endH3: bigint): bigint[] {
  const { res9Prefix } = getH3Constants();
  const dist = h3GridDistance(startH3, endH3);
  if (dist === 0) return [startH3];
  const a = unpackH3Axial(startH3);
  const b = unpackH3Axial(endH3);
  const path: bigint[] = [];
  for (let i = 0; i <= dist; i++) {
    const t = i / dist;
    const qf = a.q + (b.q - a.q) * t + 1e-6;
    const rf = a.r + (b.r - a.r) * t + 1e-6;
    const { q, r } = axialRound(qf, rf);
    const cell = packH3Axial(res9Prefix, q, r);
    if (path.length === 0 || path[path.length - 1] !== cell) {
      path.push(cell);
    }
  }
  return path;
}
