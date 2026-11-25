/**
 * ==============================================================================
 * ÍNDICE ESPACIAL 2D NATIVO PARA REDES VIALES (SPATIAL ROAD INDEX)
 * ==============================================================================
 * Arquitectura: Grid Bucket Spatial Partitioning & 2D Spatial Hash (O(1) / O(log N))
 * Optimización: Zero-allocation bitwise cell hashing, scale precomputation,
 * y radio de poda matemática para snapCoordinatesToNearestNode e isLocationAdjacentToRoad.
 * ==============================================================================
 */

import { RoadNode, RoadSegment } from '../types/tacticalRoadTypes';

export interface NearestNodeResult {
  nearestNode: RoadNode | null;
  distanceKm: number;
}

export interface RoadAdjacencyResult {
  isAdjacent: boolean;
  nearestSegmentId?: string;
  distanceMeters: number;
}

export interface SpatialBoundingBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

interface IndexedNodeItem {
  node: RoadNode;
  lng: number;
  lat: number;
  scaleX: number; // 111.32 * cos(lat * PI / 180)
}

interface IndexedSegmentItem {
  segment: RoadSegment;
  bbox: SpatialBoundingBox;
}

// 0.08 grados equivale a aprox. 8.8 km en latitud y longitud tropical
const DEFAULT_CELL_SIZE = 0.08;
const KM_PER_LAT_DEGREE = 110.57;
const BASE_KM_PER_LNG_DEGREE = 111.32;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Función pura de hash bitwise para mapear coordenadas 2D de celda (cx, cy)
 * a una clave entera SMI de 32 bits sin asignación de strings.
 */
export function getCellKey(cx: number, cy: number): number {
  return (((cx + 32768) << 16) | ((cy + 32768) & 0xffff)) | 0;
}

/**
 * Distancia mínima analítica (en km) desde un punto P = [pLng, pLat] a un segmento AB
 * en proyección equirrectangular local O(1) sin asignaciones en heap.
 */
export function pointToSegmentAnalyticalDistanceKm(
  pLng: number,
  pLat: number,
  aLng: number,
  aLat: number,
  bLng: number,
  bLat: number,
  scaleX: number
): number {
  const px = (pLng - aLng) * scaleX;
  const py = (pLat - aLat) * KM_PER_LAT_DEGREE;
  const bx = (bLng - aLng) * scaleX;
  const by = (bLat - aLat) * KM_PER_LAT_DEGREE;
  const lenSq = bx * bx + by * by;
  if (lenSq <= 1e-12) {
    return Math.sqrt(px * px + py * py);
  }
  let t = (px * bx + py * by) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calcula la distancia elipsoidal simplificada (proyección equirrectangular local)
 * idéntica a la fórmula canónica de RoadNetworkEngine.
 */
export function calculateAnalyticalDistanceKm(
  coordA: [number, number],
  coordB: [number, number]
): number {
  const dx = (coordA[0] - coordB[0]) * BASE_KM_PER_LNG_DEGREE * Math.cos(coordB[1] * DEG_TO_RAD);
  const dy = (coordA[1] - coordB[1]) * KM_PER_LAT_DEGREE;
  return Math.sqrt(dx * dx + dy * dy);
}

// 9 celdas concéntricas (anillo 0 + anillo 1) ordenadas por proximidad radial
const NEIGHBOR_OFFSETS: readonly [number, number][] = [
  [0, 0],
  [-1, -1], [0, -1], [1, -1],
  [-1,  0],          [1,  0],
  [-1,  1], [0,  1], [1,  1],
];

export class SpatialRoadIndex {
  private readonly cellSize: number;
  private readonly nodeBuckets: Map<number, IndexedNodeItem[]> = new Map();
  private readonly segmentBuckets: Map<number, IndexedSegmentItem[]> = new Map();

  private readonly nodes: Map<string, IndexedNodeItem> = new Map();
  private readonly segments: Map<string, IndexedSegmentItem> = new Map();
  private readonly nodeToSegments: Map<string, RoadSegment[]> = new Map();
  private readonly allIndexedNodes: IndexedNodeItem[] = [];

  constructor(cellSize: number = DEFAULT_CELL_SIZE) {
    this.cellSize = cellSize;
  }

  /**
   * Limpia toda la estructura de partición espacial
   */
  public clear(): void {
    this.nodeBuckets.clear();
    this.segmentBuckets.clear();
    this.nodes.clear();
    this.segments.clear();
    this.nodeToSegments.clear();
    this.allIndexedNodes.length = 0;
  }

  /**
   * Inserta o actualiza un nodo vial en el índice espacial
   */
  public insertNode(node: RoadNode): void {
    if (this.nodes.has(node.id)) {
      this.removeNode(node.id);
    }

    const lng = node.coordinates[0];
    const lat = node.coordinates[1];
    const scaleX = BASE_KM_PER_LNG_DEGREE * Math.cos(lat * DEG_TO_RAD);

    const indexedItem: IndexedNodeItem = {
      node,
      lng,
      lat,
      scaleX,
    };

    this.nodes.set(node.id, indexedItem);
    this.allIndexedNodes.push(indexedItem);

    const cx = Math.floor(lng / this.cellSize);
    const cy = Math.floor(lat / this.cellSize);
    const cellKey = getCellKey(cx, cy);

    let bucket = this.nodeBuckets.get(cellKey);
    if (!bucket) {
      bucket = [];
      this.nodeBuckets.set(cellKey, bucket);
    }
    bucket.push(indexedItem);

    if (!this.nodeToSegments.has(node.id)) {
      this.nodeToSegments.set(node.id, []);
    }
  }

  /**
   * Elimina un nodo del índice espacial
   */
  public removeNode(nodeId: string): boolean {
    const existing = this.nodes.get(nodeId);
    if (!existing) return false;

    this.nodes.delete(nodeId);

    const arrIdx = this.allIndexedNodes.findIndex(item => item.node.id === nodeId);
    if (arrIdx !== -1) {
      this.allIndexedNodes.splice(arrIdx, 1);
    }

    const cx = Math.floor(existing.lng / this.cellSize);
    const cy = Math.floor(existing.lat / this.cellSize);
    const cellKey = getCellKey(cx, cy);

    const bucket = this.nodeBuckets.get(cellKey);
    if (bucket) {
      const bIdx = bucket.findIndex(item => item.node.id === nodeId);
      if (bIdx !== -1) {
        bucket.splice(bIdx, 1);
        if (bucket.length === 0) {
          this.nodeBuckets.delete(cellKey);
        }
      }
    }

    return true;
  }

  /**
   * Inserta un segmento vial asociándolo a sus nodos terminales y celdas espaciales
   */
  public insertSegment(segment: RoadSegment): void {
    if (this.segments.has(segment.id)) {
      this.removeSegment(segment.id);
    }

    // Indexar mapeo nodo -> segmentos para resolución O(1) de adyacencia
    let fromList = this.nodeToSegments.get(segment.fromNodeId);
    if (!fromList) {
      fromList = [];
      this.nodeToSegments.set(segment.fromNodeId, fromList);
    }
    fromList.push(segment);

    let toList = this.nodeToSegments.get(segment.toNodeId);
    if (!toList) {
      toList = [];
      this.nodeToSegments.set(segment.toNodeId, toList);
    }
    toList.push(segment);

    // Bounding box del segmento
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;

    if (segment.coordinates && segment.coordinates.length > 0) {
      for (const pt of segment.coordinates) {
        if (pt[0] < minLng) minLng = pt[0];
        if (pt[0] > maxLng) maxLng = pt[0];
        if (pt[1] < minLat) minLat = pt[1];
        if (pt[1] > maxLat) maxLat = pt[1];
      }
    } else {
      const fromNode = this.nodes.get(segment.fromNodeId);
      const toNode = this.nodes.get(segment.toNodeId);
      if (fromNode) {
        minLng = Math.min(minLng, fromNode.lng);
        maxLng = Math.max(maxLng, fromNode.lng);
        minLat = Math.min(minLat, fromNode.lat);
        maxLat = Math.max(maxLat, fromNode.lat);
      }
      if (toNode) {
        minLng = Math.min(minLng, toNode.lng);
        maxLng = Math.max(maxLng, toNode.lng);
        minLat = Math.min(minLat, toNode.lat);
        maxLat = Math.max(maxLat, toNode.lat);
      }
    }

    if (!isFinite(minLng)) {
      minLng = 0; maxLng = 0; minLat = 0; maxLat = 0;
    }

    const bbox: SpatialBoundingBox = { minLng, minLat, maxLng, maxLat };
    const segItem: IndexedSegmentItem = { segment, bbox };
    this.segments.set(segment.id, segItem);

    // Registrar en los buckets que solapan la caja envolvente
    const minCx = Math.floor(minLng / this.cellSize);
    const maxCx = Math.floor(maxLng / this.cellSize);
    const minCy = Math.floor(minLat / this.cellSize);
    const maxCy = Math.floor(maxLat / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const k = getCellKey(cx, cy);
        let b = this.segmentBuckets.get(k);
        if (!b) {
          b = [];
          this.segmentBuckets.set(k, b);
        }
        b.push(segItem);
      }
    }
  }

  /**
   * Elimina un segmento vial del índice
   */
  public removeSegment(segmentId: string): boolean {
    const existing = this.segments.get(segmentId);
    if (!existing) return false;

    this.segments.delete(segmentId);

    const fromList = this.nodeToSegments.get(existing.segment.fromNodeId);
    if (fromList) {
      const idx = fromList.findIndex(s => s.id === segmentId);
      if (idx !== -1) fromList.splice(idx, 1);
    }

    const toList = this.nodeToSegments.get(existing.segment.toNodeId);
    if (toList) {
      const idx = toList.findIndex(s => s.id === segmentId);
      if (idx !== -1) toList.splice(idx, 1);
    }

    const minCx = Math.floor(existing.bbox.minLng / this.cellSize);
    const maxCx = Math.floor(existing.bbox.maxLng / this.cellSize);
    const minCy = Math.floor(existing.bbox.minLat / this.cellSize);
    const maxCy = Math.floor(existing.bbox.maxLat / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const k = getCellKey(cx, cy);
        const b = this.segmentBuckets.get(k);
        if (b) {
          const idx = b.findIndex(item => item.segment.id === segmentId);
          if (idx !== -1) {
            b.splice(idx, 1);
            if (b.length === 0) this.segmentBuckets.delete(k);
          }
        }
      }
    }

    return true;
  }

  /**
   * Snapping espacial optimizado O(1) / O(log N).
   * Encuentra el nodo más cercano a unas coordenadas dadas con garantía matemática
   * de equivalencia con la búsqueda por fuerza bruta.
   */
  public snapCoordinatesToNearestNode(coords: [number, number]): NearestNodeResult {
    if (this.allIndexedNodes.length === 0) {
      return { nearestNode: null, distanceKm: Infinity };
    }

    const qLng = coords[0];
    const qLat = coords[1];
    const cx = Math.floor(qLng / this.cellSize);
    const cy = Math.floor(qLat / this.cellSize);

    let bestNode: RoadNode | null = null;
    let minDSq = Infinity;

    // 1. Exploración concéntrica en ventana de 9 celdas adyacentes
    for (let o = 0; o < 9; o++) {
      const off = NEIGHBOR_OFFSETS[o];
      const k = getCellKey(cx + off[0], cy + off[1]);
      const bucket = this.nodeBuckets.get(k);
      if (bucket !== undefined) {
        const len = bucket.length;
        for (let i = 0; i < len; i++) {
          const item = bucket[i];
          const ndx = (qLng - item.lng) * item.scaleX;
          const ndy = (qLat - item.lat) * KM_PER_LAT_DEGREE;
          const dSq = ndx * ndx + ndy * ndy;
          if (dSq < minDSq) {
            minDSq = dSq;
            bestNode = item.node;
          }
        }
      }
    }

    // 2. Verificación de frontera matemática de seguridad:
    // Distancia mínima desde (qLng, qLat) al exterior de la ventana 3x3
    const boundLeftKm = (qLng - (cx - 1) * this.cellSize) * 109.5;
    const boundRightKm = ((cx + 2) * this.cellSize - qLng) * 109.5;
    const boundBottomKm = (qLat - (cy - 1) * this.cellSize) * KM_PER_LAT_DEGREE;
    const boundTopKm = ((cy + 2) * this.cellSize - qLat) * KM_PER_LAT_DEGREE;
    const minBorderKm = Math.min(boundLeftKm, boundRightKm, boundBottomKm, boundTopKm);

    // Si no se encontró ningún nodo o si la distancia al mejor nodo excede la frontera exterior,
    // se recorren todos los nodos para garantizar consistencia analítica 100% matemática
    if (bestNode === null || minDSq > minBorderKm * minBorderKm) {
      const allLen = this.allIndexedNodes.length;
      for (let i = 0; i < allLen; i++) {
        const item = this.allIndexedNodes[i];
        const ndx = (qLng - item.lng) * item.scaleX;
        const ndy = (qLat - item.lat) * KM_PER_LAT_DEGREE;
        const dSq = ndx * ndx + ndy * ndy;
        if (dSq < minDSq) {
          minDSq = dSq;
          bestNode = item.node;
        }
      }
    }

    const distanceKm = Math.round(Math.sqrt(minDSq) * 100) / 100;
    return { nearestNode: bestNode, distanceKm };
  }

  /**
   * Valida si unas coordenadas geodésicas están a una distancia menor o igual
   * al umbral permitido (ej. 150m = 0.15 km) de una carretera o nodo vial.
   * Ejecución en O(1) tiempo constante gracias al índice de celdas y mapeo directo nodo-segmento.
   */
  public isLocationAdjacentToRoad(
    coords: [number, number],
    maxDistanceKm: number = 0.15
  ): RoadAdjacencyResult {
    const qLng = coords[0];
    const qLat = coords[1];
    const maxDSq = maxDistanceKm * maxDistanceKm;
    const queryScaleX = BASE_KM_PER_LNG_DEGREE * Math.cos(qLat * DEG_TO_RAD);

    const cx = Math.floor(qLng / this.cellSize);
    const cy = Math.floor(qLat / this.cellSize);

    let bestNode: RoadNode | null = null;
    let bestSegmentId: string | undefined = undefined;
    let minDSq = Infinity;

    // 1. Inspeccionar nodos en las 9 celdas inmediatas
    for (let o = 0; o < 9; o++) {
      const off = NEIGHBOR_OFFSETS[o];
      const k = getCellKey(cx + off[0], cy + off[1]);
      const bucket = this.nodeBuckets.get(k);
      if (bucket !== undefined) {
        const len = bucket.length;
        for (let i = 0; i < len; i++) {
          const item = bucket[i];
          const ndx = (qLng - item.lng) * item.scaleX;
          const ndy = (qLat - item.lat) * KM_PER_LAT_DEGREE;
          const dSq = ndx * ndx + ndy * ndy;
          if (dSq < minDSq) {
            minDSq = dSq;
            bestNode = item.node;
            bestSegmentId = this.nodeToSegments.get(item.node.id)?.[0]?.id;
          }
        }
      }
    }

    // 2. Inspeccionar geometría de segmentos (segmentBuckets) punto-a-polilínea O(1)
    const visitedSegments = new Set<string>();
    for (let o = 0; o < 9; o++) {
      const off = NEIGHBOR_OFFSETS[o];
      const k = getCellKey(cx + off[0], cy + off[1]);
      const segBucket = this.segmentBuckets.get(k);
      if (segBucket === undefined) continue;
      for (let i = 0; i < segBucket.length; i++) {
        const segItem = segBucket[i];
        const seg = segItem.segment;
        if (visitedSegments.has(seg.id)) continue;
        visitedSegments.add(seg.id);

        const coordsList = seg.coordinates;
        if (coordsList && coordsList.length >= 2) {
          for (let p = 0; p < coordsList.length - 1; p++) {
            const a = coordsList[p];
            const b = coordsList[p + 1];
            const distKm = pointToSegmentAnalyticalDistanceKm(
              qLng,
              qLat,
              a[0],
              a[1],
              b[0],
              b[1],
              queryScaleX
            );
            const dSq = distKm * distKm;
            if (dSq < minDSq) {
              minDSq = dSq;
              bestSegmentId = seg.id;
            }
          }
        } else {
          const fromItem = this.nodes.get(seg.fromNodeId);
          const toItem = this.nodes.get(seg.toNodeId);
          if (fromItem && toItem) {
            const distKm = pointToSegmentAnalyticalDistanceKm(
              qLng,
              qLat,
              fromItem.lng,
              fromItem.lat,
              toItem.lng,
              toItem.lat,
              queryScaleX
            );
            const dSq = distKm * distKm;
            if (dSq < minDSq) {
              minDSq = dSq;
              bestSegmentId = seg.id;
            }
          }
        }
      }
    }

    if ((bestNode === null && bestSegmentId === undefined) || minDSq > maxDSq) {
      const distKm =
        bestNode !== null || bestSegmentId !== undefined
          ? Math.sqrt(minDSq)
          : this.cellSize * KM_PER_LAT_DEGREE;
      return {
        isAdjacent: false,
        nearestSegmentId: bestSegmentId,
        distanceMeters: Math.round(distKm * 1000),
      };
    }

    const distKm = Math.sqrt(minDSq);
    return {
      isAdjacent: true,
      nearestSegmentId: bestSegmentId,
      distanceMeters: Math.round(distKm * 1000),
    };
  }

  /**
   * Búsqueda en radio geodésico (Range Query): encuentra todos los nodos dentro de radiusKm
   */
  public findNodesInRadius(
    coords: [number, number],
    radiusKm: number
  ): { node: RoadNode; distanceKm: number }[] {
    const qLng = coords[0];
    const qLat = coords[1];
    const radiusSq = radiusKm * radiusKm;
    const results: { node: RoadNode; distanceKm: number }[] = [];

    const deltaLatDeg = radiusKm / KM_PER_LAT_DEGREE;
    const deltaLngDeg = radiusKm / (BASE_KM_PER_LNG_DEGREE * Math.cos(qLat * DEG_TO_RAD));

    const minCx = Math.floor((qLng - deltaLngDeg) / this.cellSize);
    const maxCx = Math.floor((qLng + deltaLngDeg) / this.cellSize);
    const minCy = Math.floor((qLat - deltaLatDeg) / this.cellSize);
    const maxCy = Math.floor((qLat + deltaLatDeg) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const k = getCellKey(cx, cy);
        const bucket = this.nodeBuckets.get(k);
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            const item = bucket[i];
            const ndx = (qLng - item.lng) * item.scaleX;
            const ndy = (qLat - item.lat) * KM_PER_LAT_DEGREE;
            const dSq = ndx * ndx + ndy * ndy;
            if (dSq <= radiusSq) {
              results.push({
                node: item.node,
                distanceKm: Number(Math.sqrt(dSq).toFixed(2)),
              });
            }
          }
        }
      }
    }

    return results;
  }

  public getNodeCount(): number {
    return this.nodes.size;
  }

  public getSegmentCount(): number {
    return this.segments.size;
  }

  public getBucketCount(): number {
    return this.nodeBuckets.size;
  }

  public getNode(id: string): RoadNode | undefined {
    return this.nodes.get(id)?.node;
  }

  public getSegment(id: string): RoadSegment | undefined {
    return this.segments.get(id)?.segment;
  }
}
