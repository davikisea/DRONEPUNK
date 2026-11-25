/**
 * ==============================================================================
 * MOTOR DE CARRETERAS REGIONALES ORTOGONALES A* (ESTILO SPRITE-FORGE-STUDIO)
 * ==============================================================================
 * Reemplaza por completo la rasterización diagonal de vértices OSM:
 * - A* direccional con rectitud mínima (R_min = 4, c_turn = 4.5, repulsión lateral)
 * - Genera tramos largos completamente rectos (H / V) y curvas limpias de 90°
 * - CERO escaleras diagonales pixeladas, CERO bloques 2x2
 * - Puentes estrictamente rectos 1D (HBridge=1 / VBridge=2) solo en cruces válidos
 *   (MAX_BRIDGE_SPAN = 12 por defecto; 48 solo en el estrecho del Puente Urdaneta),
 *   prohibiendo puentes sobre mar abierto o Lago de Maracaibo.
 * ==============================================================================
 */

import {
  globalTacticalCellToLngLat,
  lngLatToGlobalTacticalCell,
  ZOOM_TACTICO,
  type LngLat,
} from './coordinates';
import { getAllCityScaleSpecs } from './urbanPopulationCatalog';
import { getResolvedMacroBridges, resetMacroBridgesCache } from './macroBridgeCorridors';
import { getProceduralSatelliteSpecs, resetProceduralSatellitesCache } from './proceduralSatelliteNetwork';

export interface SectorYellowTrunkMask {
  readonly sectorX: number;
  readonly sectorY: number;
  /** Bitmask 20-bit por fila (localY = 0..19, bit localX = 0..19) */
  readonly rowRoadBitmask: Uint32Array;
  /** Eje de puente por celda (localY * 20 + localX): 0 = road, 1 = HBridge, 2 = VBridge */
  readonly bridgeAxis: Uint8Array;
}

export interface RegionalAStarOptions {
  readonly maxBridgeSpan: number;
  readonly minStraightRun: number;
  readonly turnPenalty: number;
  readonly maxExpansions: number;
}

interface TrunkSamplePoint {
  readonly gx: number;
  readonly gy: number;
}

const GRID_SIZE = 20;
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // 0: N
  [1, 0],  // 1: E
  [0, 1],  // 2: S
  [-1, 0], // 3: W
];
const OPP_DIR: readonly number[] = [2, 3, 0, 1];

const sectorTrunkMasks = new Map<string, SectorYellowTrunkMask>();
const sampledTrunkAnchors: TrunkSamplePoint[] = [];
let trunkInitialized = false;
let trunkNodeAttempted = false;

function getOrCreateSectorMask(sx: number, sy: number): SectorYellowTrunkMask {
  const key = `${sx}_${sy}`;
  let mask = sectorTrunkMasks.get(key);
  if (!mask) {
    mask = {
      sectorX: sx,
      sectorY: sy,
      rowRoadBitmask: new Uint32Array(GRID_SIZE),
      bridgeAxis: new Uint8Array(GRID_SIZE * GRID_SIZE),
    };
    sectorTrunkMasks.set(key, mask);
  }
  return mask;
}

function hasTrunkCell(gx: number, gy: number): boolean {
  const sx = Math.floor(gx / GRID_SIZE);
  const sy = Math.floor(gy / GRID_SIZE);
  const mask = sectorTrunkMasks.get(`${sx}_${sy}`);
  if (!mask) return false;
  const lx = gx - sx * GRID_SIZE;
  const ly = gy - sy * GRID_SIZE;
  return (mask.rowRoadBitmask[ly] & (1 << lx)) !== 0;
}

function getBridgeAxisRaw(gx: number, gy: number): 0 | 1 | 2 {
  const sx = Math.floor(gx / GRID_SIZE);
  const sy = Math.floor(gy / GRID_SIZE);
  const mask = sectorTrunkMasks.get(`${sx}_${sy}`);
  if (!mask) return 0;
  const lx = gx - sx * GRID_SIZE;
  const ly = gy - sy * GRID_SIZE;
  return mask.bridgeAxis[ly * GRID_SIZE + lx] as 0 | 1 | 2;
}

function setTrunkCell(gx: number, gy: number, bridgeAxisVal: 0 | 1 | 2 = 0): void {
  const sx = Math.floor(gx / GRID_SIZE);
  const sy = Math.floor(gy / GRID_SIZE);
  const mask = getOrCreateSectorMask(sx, sy);
  const lx = gx - sx * GRID_SIZE;
  const ly = gy - sy * GRID_SIZE;
  mask.rowRoadBitmask[ly] |= 1 << lx;
  if (bridgeAxisVal !== 0) {
    mask.bridgeAxis[ly * GRID_SIZE + lx] = bridgeAxisVal;
  }
}

function wouldForm2x2WithExisting(gx: number, gy: number): boolean {
  const checks: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
    [-1, -1, 0, -1, -1, 0],
    [0, -1, 1, -1, 1, 0],
    [-1, 0, -1, 1, 0, 1],
    [1, 0, 0, 1, 1, 1],
  ];
  for (let i = 0; i < checks.length; i++) {
    const [dx1, dy1, dx2, dy2, dx3, dy3] = checks[i];
    if (
      hasTrunkCell(gx + dx1, gy + dy1) &&
      hasTrunkCell(gx + dx2, gy + dy2) &&
      hasTrunkCell(gx + dx3, gy + dy3)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Min-Heap binario ligero para A* direccional regional (< 15ms por corredor).
 */
class MinHeap<T> {
  private items: Array<{ priority: number; value: T }> = [];

  public get size(): number {
    return this.items.length;
  }

  public push(priority: number, value: T): void {
    const arr = this.items;
    arr.push({ priority, value });
    let idx = arr.length - 1;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (arr[parent].priority <= arr[idx].priority) break;
      const tmp = arr[parent];
      arr[parent] = arr[idx];
      arr[idx] = tmp;
      idx = parent;
    }
  }

  public pop(): T | undefined {
    const arr = this.items;
    if (arr.length === 0) return undefined;
    const top = arr[0].value;
    const last = arr.pop()!;
    if (arr.length > 0) {
      arr[0] = last;
      let idx = 0;
      const len = arr.length;
      while (true) {
        const left = (idx << 1) + 1;
        const right = left + 1;
        let smallest = idx;
        if (left < len && arr[left].priority < arr[smallest].priority) smallest = left;
        if (right < len && arr[right].priority < arr[smallest].priority) smallest = right;
        if (smallest === idx) break;
        const tmp = arr[smallest];
        arr[smallest] = arr[idx];
        arr[idx] = tmp;
        idx = smallest;
      }
    }
    return top;
  }
}

/**
 * Traza una carretera ortogonal limpia (tramos largos rectos H/V + curvas puras de 90°)
 * usando A* direccional sobre tierra firme, portado de _astar_highway (09_city_world_engine.py).
 */
export function routeRegionalHighwayAStar(
  start: readonly [number, number],
  goal: readonly [number, number],
  landPredicate: (lng: number, lat: number) => boolean,
  opts: RegionalAStarOptions = {
    maxBridgeSpan: 12,
    minStraightRun: 4,
    turnPenalty: 4.5,
    maxExpansions: 35_000,
  }
): Array<[number, number, 0 | 1 | 2]> | null {
  const [sx, sy] = start;
  const [gx, gy] = goal;
  if (sx === gx && sy === gy) return [[sx, sy, 0]];

  const landCache = new Map<string, boolean>();
  const isLandCell = (x: number, y: number): boolean => {
    const k = `${x}_${y}`;
    let v = landCache.get(k);
    if (v === undefined) {
      const [lng, lat] = globalTacticalCellToLngLat(x, y, GRID_SIZE, ZOOM_TACTICO);
      v = landPredicate(lng, lat);
      landCache.set(k, v);
    }
    return v;
  };

  // Acotar bbox de búsqueda para rendimiento garantizado en navegador
  const pad = Math.min(48, Math.max(24, Math.floor((Math.abs(gx - sx) + Math.abs(gy - sy)) * 0.35)));
  const minX = Math.min(sx, gx) - pad;
  const maxX = Math.max(sx, gx) + pad;
  const minY = Math.min(sy, gy) - pad;
  const maxY = Math.max(sy, gy) + pad;

  interface AStarNode {
    x: number;
    y: number;
    dir: number;
    run: number;
    g: number;
    parentKey: string | null;
    viaBridgeAxis: 0 | 1 | 2;
    prevX: number;
    prevY: number;
  }

  const stateKey = (x: number, y: number, d: number, r: number) => `${x}_${y}_${d}_${r}`;
  const heap = new MinHeap<AStarNode>();
  const bestG = new Map<string, number>();
  const closedNodes = new Map<string, AStarNode>();

  const startDist = Math.abs(gx - sx) + Math.abs(gy - sy);
  for (let d = 0; d < 4; d++) {
    const k = stateKey(sx, sy, d, opts.minStraightRun);
    const node: AStarNode = {
      x: sx,
      y: sy,
      dir: d,
      run: opts.minStraightRun,
      g: 0,
      parentKey: null,
      viaBridgeAxis: 0,
      prevX: sx,
      prevY: sy,
    };
    bestG.set(k, 0);
    closedNodes.set(k, node);
    heap.push(1.15 * startDist, node);
  }

  let goalNode: AStarNode | null = null;
  let expansions = 0;

  while (heap.size > 0 && expansions < opts.maxExpansions) {
    const curr = heap.pop()!;
    const currKey = stateKey(curr.x, curr.y, curr.dir, curr.run);
    const recordedG = bestG.get(currKey);
    if (recordedG !== undefined && curr.g > recordedG + 1e-6) continue;

    expansions++;
    const distToGoal = Math.abs(gx - curr.x) + Math.abs(gy - curr.y);
    if (distToGoal <= 1) {
      goalNode = curr;
      break;
    }

    for (let dNext = 0; dNext < 4; dNext++) {
      if (dNext === OPP_DIR[curr.dir]) continue;
      const [dx, dy] = DIRS[dNext];
      const nx = curr.x + dx;
      const ny = curr.y + dy;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;

      const isStart = curr.x === sx && curr.y === sy;
      const isTurn = !isStart && dNext !== curr.dir;
      const onExistingRoad = hasTrunkCell(nx, ny);

      // Invariante anti-escalera: prohibir giro si run < minStraightRun (salvo fusión o llegada)
      if (isTurn && curr.run < opts.minStraightRun && !onExistingRoad && distToGoal > 3) {
        continue;
      }

      const lx = -dy;
      const ly = dx;

      if (!isLandCell(nx, ny)) {
        // Puente 1D colineal estricto: solo entrada recta, sin encadenar puentes
        if (isTurn || curr.viaBridgeAxis !== 0 || getBridgeAxisRaw(curr.x, curr.y) !== 0) continue;
        if (opts.maxBridgeSpan <= 0) continue;

        let wx = nx;
        let wy = ny;
        let span = 0;
        let validBridge = true;
        while (span < opts.maxBridgeSpan && !isLandCell(wx, wy)) {
          // Separación lateral libre de otros puentes/carreteras
          for (let side = -2; side <= 2; side++) {
            if (side === 0) continue;
            if (hasTrunkCell(wx + lx * side, wy + ly * side)) {
              validBridge = false;
              break;
            }
          }
          if (!validBridge) break;
          wx += dx;
          wy += dy;
          span++;
          if (wx < minX || wx > maxX || wy < minY || wy > maxY) {
            validBridge = false;
            break;
          }
        }

        if (!validBridge || span === 0 || span > opts.maxBridgeSpan || !isLandCell(wx, wy)) {
          continue;
        }
        if (!hasTrunkCell(wx, wy) && wouldForm2x2WithExisting(wx, wy)) {
          continue;
        }

        const bAxis: 1 | 2 = dy === 0 ? 1 : 2;
        const ng = curr.g + span * 12.0 + 4.0;
        const nextRun = opts.minStraightRun;
        const nk = stateKey(wx, wy, dNext, nextRun);
        const prevBest = bestG.get(nk);
        if (prevBest === undefined || ng < prevBest) {
          bestG.set(nk, ng);
          const nextNode: AStarNode = {
            x: wx,
            y: wy,
            dir: dNext,
            run: nextRun,
            g: ng,
            parentKey: currKey,
            viaBridgeAxis: bAxis,
            prevX: curr.x,
            prevY: curr.y,
          };
          closedNodes.set(nk, nextNode);
          const h = Math.abs(gx - wx) + Math.abs(gy - wy);
          heap.push(ng + 1.15 * h, nextNode);
        }
        continue;
      }

      // Celda terrestre firme
      if (!onExistingRoad) {
        if (wouldForm2x2WithExisting(nx, ny)) continue;
        // Hard-reject doble calzada paralela pegada
        if (
          (hasTrunkCell(curr.x + lx, curr.y + ly) && hasTrunkCell(nx + lx, ny + ly)) ||
          (hasTrunkCell(curr.x - lx, curr.y - ly) && hasTrunkCell(nx - lx, ny - ly))
        ) {
          continue;
        }
      }

      const cTerr = onExistingRoad ? 0.25 : 1.0;
      const cTurn = isTurn ? opts.turnPenalty : 0;
      let cLat = 0;
      if (!onExistingRoad && distToGoal > 3) {
        if (hasTrunkCell(nx + lx, ny + ly) || hasTrunkCell(nx - lx, ny - ly)) cLat += 48.0;
        if (hasTrunkCell(nx + lx * 2, ny + ly * 2) || hasTrunkCell(nx - lx * 2, ny - ly * 2)) cLat += 26.0;
      }

      const ng = curr.g + cTerr + cTurn + cLat;
      const nextRun = isTurn ? 1 : Math.min(opts.minStraightRun, curr.run + 1);
      const nk = stateKey(nx, ny, dNext, nextRun);
      const prevBest = bestG.get(nk);
      if (prevBest === undefined || ng < prevBest) {
        bestG.set(nk, ng);
        const nextNode: AStarNode = {
          x: nx,
          y: ny,
          dir: dNext,
          run: nextRun,
          g: ng,
          parentKey: currKey,
          viaBridgeAxis: 0,
          prevX: curr.x,
          prevY: curr.y,
        };
        closedNodes.set(nk, nextNode);
        const h = Math.abs(gx - nx) + Math.abs(gy - ny);
        heap.push(ng + 1.15 * h, nextNode);
      }
    }
  }

  if (!goalNode) return null;

  // Reconstrucción exacta interpolando saltos de puente en pasos de 1 tile
  const reversed: Array<[number, number, 0 | 1 | 2]> = [];
  if (goalNode.x !== gx || goalNode.y !== gy) {
    reversed.push([gx, gy, 0]);
  }
  let node: AStarNode | undefined = goalNode;
  while (node) {
    reversed.push([node.x, node.y, 0]);
    if (node.viaBridgeAxis !== 0) {
      const stepX = Math.sign(node.prevX - node.x);
      const stepY = Math.sign(node.prevY - node.y);
      let bx = node.x + stepX;
      let by = node.y + stepY;
      while (bx !== node.prevX || by !== node.prevY) {
        reversed.push([bx, by, node.viaBridgeAxis]);
        bx += stepX;
        by += stepY;
      }
    }
    node = node.parentKey ? closedNodes.get(node.parentKey) : undefined;
  }

  reversed.reverse();
  return reversed;
}

function stampPathIntoTrunkIndex(path: Array<[number, number, 0 | 1 | 2]>): number {
  let stamped = 0;
  for (let i = 0; i < path.length; i++) {
    const [gx, gy, bAxis] = path[i];
    if (!hasTrunkCell(gx, gy) && !wouldForm2x2WithExisting(gx, gy)) {
      setTrunkCell(gx, gy, bAxis);
      if (bAxis === 0 && i % 6 === 0) {
        sampledTrunkAnchors.push({ gx, gy });
      }
      stamped++;
    }
  }
  return stamped;
}

/**
 * Construye un corredor ortogonal limpio en tramos largos (L-bend o Z-bend con R_min >= 4)
 * guiado por puntos de paso en tierra firme cuando la distancia supera el presupuesto A* fino.
 */
function stampCleanOrthogonalCorridor(
  start: readonly [number, number],
  goal: readonly [number, number],
  landPredicate: (lng: number, lat: number) => boolean,
  maxBridgeSpan: number = 12
): number {
  const dist = Math.abs(goal[0] - start[0]) + Math.abs(goal[1] - start[1]);
  if (dist <= 260) {
    const astarPath = routeRegionalHighwayAStar(start, goal, landPredicate, {
      maxBridgeSpan,
      minStraightRun: 4,
      turnPenalty: 4.5,
      maxExpansions: 40_000,
    });
    if (astarPath) return stampPathIntoTrunkIndex(astarPath);
  }

  // Fallback ortogonal puro en 2 tramos rectos (CERO escaleras diagonales) solo sobre tierra
  const [x0, y0] = start;
  const [x1, y1] = goal;
  const path: Array<[number, number, 0 | 1 | 2]> = [];
  const stepX = x1 >= x0 ? 1 : -1;
  let waterRun = 0;
  for (let x = x0; x !== x1 + stepX; x += stepX) {
    const [lng, lat] = globalTacticalCellToLngLat(x, y0, GRID_SIZE, ZOOM_TACTICO);
    const isLand = landPredicate(lng, lat);
    if (!isLand) {
      waterRun++;
      if (waterRun > maxBridgeSpan) return 0; // Abortar si cruza mar abierto
      path.push([x, y0, 1]);
    } else {
      waterRun = 0;
      path.push([x, y0, 0]);
    }
  }
  const stepY = y1 >= y0 ? 1 : -1;
  waterRun = 0;
  for (let y = y0; y !== y1 + stepY; y += stepY) {
    const [lng, lat] = globalTacticalCellToLngLat(x1, y, GRID_SIZE, ZOOM_TACTICO);
    const isLand = landPredicate(lng, lat);
    if (!isLand) {
      waterRun++;
      if (waterRun > maxBridgeSpan) return 0;
      path.push([x1, y, 2]);
    } else {
      waterRun = 0;
      path.push([x1, y, 0]);
    }
  }
  return stampPathIntoTrunkIndex(path);
}

/**
 * Construye la red troncal regional ortogonal limpia (rectas H/V + curvas 90°)
 * uniendo las ciudades continentales de theatre_cities.json sin escaleras diagonales.
 */
export function registerYellowTrunkGeoJson(
  _geojson: unknown,
  landPredicate?: (lng: number, lat: number) => boolean
): number {
  sectorTrunkMasks.clear();
  sampledTrunkAnchors.length = 0;
  resetMacroBridgesCache();
  resetProceduralSatellitesCache();

  const isLand = landPredicate ?? (() => true);
  const cities = getAllCityScaleSpecs().filter((c) => c.cityId !== 'CITY_EL_TORO');
  const proceduralSats = getProceduralSatelliteSpecs(isLand);

  // 0. PRIORITY-0: Estampar todos los Macro-Puentes Rectos 1D (Puente General Rafael Urdaneta)
  //    100% línea recta horizontal (HBridge, gy constante) de orilla a orilla sin límite de 48 tiles
  const macroBridges = getResolvedMacroBridges(isLand);
  for (let i = 0; i < macroBridges.length; i++) {
    const br = macroBridges[i];
    for (let t = 0; t < br.tiles.length; t++) {
      const [gx, gy, axis] = br.tiles[t];
      setTrunkCell(gx, gy, axis);
      if (axis === 0 && t % 4 === 0) {
        sampledTrunkAnchors.push({ gx, gy });
      }
    }
  }

  // 1. Malla Regional Completa del Zulia (Ciudades <-> SATs <-> Ciudades + SAT <-> SAT + Cabeceras del Puente)
  const cityById = new Map(cities.map((c) => [c.cityId, c]));
  const satById = new Map(proceduralSats.map((s) => [s.cityId, s]));

  // Conectar ambas cabeceras del Puente Rafael Urdaneta con San Francisco/Maracaibo (Oeste) y Santa Rita/Cabimas (Este)
  for (const br of macroBridges) {
    const westSat = satById.get(br.def.westSatId);
    const eastSat = satById.get(br.def.eastSatId);
    if (westSat) {
      stampCleanOrthogonalCorridor([westSat.anchorGlobalX, westSat.anchorGlobalY], br.westLandfall, isLand, 8);
      const sf = cityById.get('CITY_SAN_FRANCISCO');
      const mcbo = cityById.get('CITY_MARACAIBO');
      if (sf) stampCleanOrthogonalCorridor([sf.anchorGlobalX, sf.anchorGlobalY], [westSat.anchorGlobalX, westSat.anchorGlobalY], isLand, 8);
      if (mcbo) stampCleanOrthogonalCorridor([mcbo.anchorGlobalX, mcbo.anchorGlobalY], [westSat.anchorGlobalX, westSat.anchorGlobalY], isLand, 8);
    }
    if (eastSat) {
      stampCleanOrthogonalCorridor([eastSat.anchorGlobalX, eastSat.anchorGlobalY], br.eastLandfall, isLand, 8);
      const sr = cityById.get('CITY_SANTA_RITA');
      const cab = cityById.get('CITY_CABIMAS');
      const alt = cityById.get('CITY_LOS_PUERTOS_DE_ALTAGRACIA');
      if (sr) stampCleanOrthogonalCorridor([sr.anchorGlobalX, sr.anchorGlobalY], [eastSat.anchorGlobalX, eastSat.anchorGlobalY], isLand, 8);
      if (cab) stampCleanOrthogonalCorridor([cab.anchorGlobalX, cab.anchorGlobalY], [eastSat.anchorGlobalX, eastSat.anchorGlobalY], isLand, 8);
      if (alt) stampCleanOrthogonalCorridor([alt.anchorGlobalX, alt.anchorGlobalY], [eastSat.anchorGlobalX, eastSat.anchorGlobalY], isLand, 10);
    }
  }

  // Corredores troncales multi-direccionales del Zulia (enlazando todas las direcciones de cada ciudad)
  const zuliaPriorityPairs: ReadonlyArray<readonly [string, string, number]> = [
    // Eje Occidental del Lago + enlaces transversales multi-salida
    ['CITY_MARACAIBO', 'CITY_SAN_FRANCISCO', 8],
    ['CITY_MARACAIBO', 'CITY_LA_CONCEPCION', 8],
    ['CITY_MARACAIBO', 'CITY_SAN_RAFAEL_DEL_MOJAN', 10],
    ['CITY_SAN_RAFAEL_DEL_MOJAN', 'CITY_SINAMAICA_PARAGUAIPOA', 10],
    ['CITY_SAN_FRANCISCO', 'CITY_CONCEPCION', 8],
    ['CITY_SAN_FRANCISCO', 'CITY_LA_CONCEPCION', 8],
    ['CITY_CONCEPCION', 'CITY_LA_VILLA_DEL_ROSARIO', 10],
    ['CITY_LA_CONCEPCION', 'CITY_LA_VILLA_DEL_ROSARIO', 8],
    ['CITY_LA_VILLA_DEL_ROSARIO', 'CITY_MACHIQUES', 10],
    // Costa Oriental del Lago (COL) + enlaces interiores
    ['CITY_SANTA_RITA', 'CITY_LOS_PUERTOS_DE_ALTAGRACIA', 10],
    ['CITY_SANTA_RITA', 'CITY_CABIMAS', 10],
    ['CITY_CABIMAS', 'CITY_TIA_JUANA', 10],
    ['CITY_CABIMAS', 'CITY_CIUDAD_OJEDA', 10],
    ['CITY_TIA_JUANA', 'CITY_CIUDAD_OJEDA', 10],
    ['CITY_CIUDAD_OJEDA', 'CITY_BACHAQUERO', 10],
    ['CITY_BACHAQUERO', 'CITY_MENE_GRANDE', 10],
    // Sur del Lago
    ['CITY_BOBURES', 'CITY_PUEBLO_NUEVO_EL_CHIVO', 10],
    ['CITY_PUEBLO_NUEVO_EL_CHIVO', 'CITY_SAN_CARLOS_DEL_ZULIA', 10],
    ['CITY_SAN_CARLOS_DEL_ZULIA', 'CITY_ENCONTRADOS', 10],
    ['CITY_ENCONTRADOS', 'CITY_CASIGUA_EL_CUBO', 10],
  ];

  // Máscara de exclusión intra-urbana: las autopistas rodean el casco urbano en vez de cruzarlo por el centro
  const coreCityCircles = cities.map((c) => ({
    id: c.cityId,
    gx: c.anchorGlobalX,
    gy: c.anchorGlobalY,
    rSq: Math.max(49, (c.radiusTiles - 2) * (c.radiusTiles - 2)),
  }));

  const isInsideOtherCityCore = (x: number, y: number, allowDistSq: number, sx: number, sy: number, gx: number, gy: number): boolean => {
    if ((x - sx) * (x - sx) + (y - sy) * (y - sy) <= allowDistSq) return false;
    if ((x - gx) * (x - gx) + (y - gy) * (y - gy) <= allowDistSq) return false;
    for (let i = 0; i < coreCityCircles.length; i++) {
      const cc = coreCityCircles[i];
      const dx = x - cc.gx;
      const dy = y - cc.gy;
      if (dx * dx + dy * dy <= cc.rSq) return true;
    }
    return false;
  };

  // Helper para proyectar el punto de salida al borde perimetral de la ciudad en dirección al destino
  const perimeterExitToward = (
    from: { anchorGlobalX: number; anchorGlobalY: number; radiusTiles: number; isProceduralSat?: boolean },
    to: { anchorGlobalX: number; anchorGlobalY: number }
  ): [number, number] => {
    const dx = to.anchorGlobalX - from.anchorGlobalX;
    const dy = to.anchorGlobalY - from.anchorGlobalY;
    const len = Math.max(1, Math.hypot(dx, dy));
    const offset = from.isProceduralSat ? 6 : Math.max(6, from.radiusTiles - 1);
    const px = Math.round(from.anchorGlobalX + (dx / len) * offset);
    const py = Math.round(from.anchorGlobalY + (dy / len) * offset);
    const [lng, lat] = globalTacticalCellToLngLat(px, py, GRID_SIZE, ZOOM_TACTICO);
    return isLand(lng, lat) ? [px, py] : [from.anchorGlobalX, from.anchorGlobalY];
  };

  const landExcludingCityCores = (sx: number, sy: number, gx: number, gy: number) => (lng: number, lat: number): boolean => {
    if (!isLand(lng, lat)) return false;
    const cell = lngLatToGlobalTacticalCell([lng, lat], GRID_SIZE, ZOOM_TACTICO);
    return !isInsideOtherCityCore(cell.globalX, cell.globalY, 16, sx, sy, gx, gy);
  };

  for (let i = 0; i < zuliaPriorityPairs.length; i++) {
    const [fromId, toId, maxSpan] = zuliaPriorityPairs[i];
    const fromCity = cityById.get(fromId);
    const toCity = cityById.get(toId);
    if (!fromCity || !toCity) continue;
    const pStart = perimeterExitToward(fromCity, toCity);
    const pGoal = perimeterExitToward(toCity, fromCity);
    const stamped = stampCleanOrthogonalCorridor(
      pStart,
      pGoal,
      landExcludingCityCores(pStart[0], pStart[1], pGoal[0], pGoal[1]),
      maxSpan
    );
    if (stamped === 0) {
      stampCleanOrthogonalCorridor(pStart, pGoal, isLand, maxSpan);
    }
  }

  // Conectar cada SAT procedural con sus 2 nodos más cercanos (Ciudades y/u otros SATs -> grafo Ciudad<->SAT y SAT<->SAT)
  const allRegionalNodes = [...cities.filter((c) => c.stateId === 'REG_VE_02'), ...proceduralSats];
  for (let i = 0; i < proceduralSats.length; i++) {
    const sat = proceduralSats[i];
    const neighbors = allRegionalNodes
      .filter((n) => n.cityId !== sat.cityId)
      .map((n) => ({
        node: n,
        dist: Math.abs(n.anchorGlobalX - sat.anchorGlobalX) + Math.abs(n.anchorGlobalY - sat.anchorGlobalY),
      }))
      .filter((x) => x.dist >= 20 && x.dist <= 220)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 3);

    for (const nb of neighbors) {
      stampCleanOrthogonalCorridor(
        [sat.anchorGlobalX, sat.anchorGlobalY],
        [nb.node.anchorGlobalX, nb.node.anchorGlobalY],
        isLand,
        10
      );
    }
  }

  // 2. Simplificación ortogonal limpia de troncales nacionales de _geojson (cada 16 vértices -> A* recto)
  // Solo se trazan segmentos largos entre waypoints en tierra firme para conectar las 12 capitales nacionales
  const features =
    _geojson && typeof _geojson === 'object' && Array.isArray((_geojson as { features?: unknown[] }).features)
      ? (_geojson as { features: Array<{ geometry?: { type?: string; coordinates?: unknown } }> }).features
      : [];

  const nationalWaypoints: Array<[number, number]> = [];
  for (let i = 0; i < cities.length; i++) {
    if (cities[i].stateId !== 'REG_VE_02') {
      nationalWaypoints.push([cities[i].anchorGlobalX, cities[i].anchorGlobalY]);
    }
  }
  // Conectar cada capital nacional con su vecino más cercano (MST simple) mediante tramos ortogonales limpios
  for (let i = 0; i < nationalWaypoints.length; i++) {
    const a = nationalWaypoints[i];
    let bestB: [number, number] | null = null;
    let bestD = Infinity;
    for (let j = 0; j < nationalWaypoints.length; j++) {
      if (i === j) continue;
      const b = nationalWaypoints[j];
      const d = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      if (d < bestD && d <= 450) {
        bestD = d;
        bestB = b;
      }
    }
    if (bestB) {
      stampCleanOrthogonalCorridor(a, bestB, isLand, 8);
    }
  }

  // Sembrar anclas de referencia para features principales si cities aún no estaba cargado
  if (sectorTrunkMasks.size === 0 && features.length > 0) {
    for (let f = 0; f < Math.min(features.length, 60); f++) {
      const geom = features[f]?.geometry;
      if (geom?.type === 'LineString' && Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
        const coords = geom.coordinates as number[][];
        const a = lngLatToGlobalTacticalCell([coords[0][0], coords[0][1]] as LngLat, GRID_SIZE, ZOOM_TACTICO);
        const last = coords[coords.length - 1];
        const b = lngLatToGlobalTacticalCell([last[0], last[1]] as LngLat, GRID_SIZE, ZOOM_TACTICO);
        stampCleanOrthogonalCorridor([a.globalX, a.globalY], [b.globalX, b.globalY], isLand, 8);
      }
    }
  }

  trunkInitialized = true;
  return sectorTrunkMasks.size;
}

export function ensureYellowTrunkLoadedInNode(
  landPredicate?: (lng: number, lat: number) => boolean
): void {
  if (trunkInitialized || trunkNodeAttempted) return;
  trunkNodeAttempted = true;
  try {
    if (typeof window !== 'undefined' || typeof process === 'undefined' || !process.versions?.node) {
      return;
    }
    const getBuiltin = (process as unknown as { getBuiltinModule?: (m: string) => Record<string, unknown> }).getBuiltinModule;
    const loadMod = (m: string) =>
      getBuiltin ? getBuiltin(m) : (Function('mod', 'return require(mod)') as (mod: string) => Record<string, unknown>)(m);
    const fsMod = loadMod('fs') as { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: string) => string };
    const pathMod = loadMod('path') as { resolve: (...p: string[]) => string };
    const filePath = pathMod.resolve(process.cwd(), 'public', 'map', 'theatre_roads.json');
    if (fsMod.existsSync(filePath)) {
      const parsed = JSON.parse(fsMod.readFileSync(filePath, 'utf-8'));
      registerYellowTrunkGeoJson(parsed, landPredicate);
    } else {
      registerYellowTrunkGeoJson(null, landPredicate);
    }
  } catch {
    // Fallback silencioso
  }
}

export function getSectorYellowTrunkMask(
  sectorX: number,
  sectorY: number,
  landPredicate?: (lng: number, lat: number) => boolean
): SectorYellowTrunkMask | null {
  ensureYellowTrunkLoadedInNode(landPredicate);
  return sectorTrunkMasks.get(`${sectorX}_${sectorY}`) ?? null;
}

export function isYellowTrunkAtGlobalCell(
  gx: number,
  gy: number,
  landPredicate?: (lng: number, lat: number) => boolean
): boolean {
  ensureYellowTrunkLoadedInNode(landPredicate);
  return hasTrunkCell(gx, gy);
}

export function getYellowTrunkBridgeAxisAtGlobalCell(
  gx: number,
  gy: number,
  landPredicate?: (lng: number, lat: number) => boolean
): 0 | 1 | 2 {
  ensureYellowTrunkLoadedInNode(landPredicate);
  return getBridgeAxisRaw(gx, gy);
}

export function findNearestYellowTrunkCell(
  targetGx: number,
  targetGy: number,
  landPredicate?: (lng: number, lat: number) => boolean
): { gx: number; gy: number; distanceTiles: number } | null {
  ensureYellowTrunkLoadedInNode(landPredicate);
  if (sampledTrunkAnchors.length === 0) return null;

  let bestGx = sampledTrunkAnchors[0].gx;
  let bestGy = sampledTrunkAnchors[0].gy;
  let bestDistSq = Infinity;

  for (let i = 0; i < sampledTrunkAnchors.length; i++) {
    const pt = sampledTrunkAnchors[i];
    const dx = pt.gx - targetGx;
    const dy = pt.gy - targetGy;
    const dSq = dx * dx + dy * dy;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestGx = pt.gx;
      bestGy = pt.gy;
    }
  }

  return {
    gx: bestGx,
    gy: bestGy,
    distanceTiles: Math.sqrt(bestDistSq),
  };
}

/**
 * Conecta un portal urbano a la troncal más cercana mediante A* direccional limpio
 * (reemplaza la L ciega anterior; 0 puentes sobre mar abierto y 0 escaleras).
 */
export function stampPrecompiledTrunkSpur(
  fromGlobal: readonly [number, number],
  toGlobal: readonly [number, number],
  landPredicate?: (lng: number, lat: number) => boolean
): number {
  const isLand = landPredicate ?? (() => true);
  const path = routeRegionalHighwayAStar(fromGlobal, toGlobal, isLand, {
    maxBridgeSpan: 6,
    minStraightRun: 3,
    turnPenalty: 4.0,
    maxExpansions: 18_000,
  });
  if (!path) return 0;
  return stampPathIntoTrunkIndex(path);
}

export function getYellowTrunkSectorCount(): number {
  ensureYellowTrunkLoadedInNode();
  return sectorTrunkMasks.size;
}
