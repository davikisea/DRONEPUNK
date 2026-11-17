/**
 * ==============================================================================
 * MOTOR DE EXPANSIÓN TERRITORIAL DINÁMICA (ESTILO TERRITORIAL.IO) Y CONTROL DE NODOS
 * ==============================================================================
 * Especificación Canónica: docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md
 * Plan Maestro: docs/01_MASTER_CARTOGRAPHY_WEBGL_ZERO_RASTER.md & docs/ANALISIS_PROJECT_ALICE_RUTAS_INGENIERIA_MAPA_METAPOLITICA.md
 * ==============================================================================
 * Modela el avance de frontera celular determinista ("pintado del mapa"),
 * el control de zonas de influencia y la captura activa de Puntos Estratégicos.
 * ==============================================================================
 */

import {
  StrategicNode,
  settleResourceTriadExtraction,
  calculateAdministrativeOverloadFuelMultiplier,
} from '@domains/economy';
import {
  CANONICAL_H3_DRONE_CATALOG,
  resolveDeterministicH3Combat,
  evaluateCartridgeGambitRules,
} from '@domains/tactics';
import {
  MASTER_METAGAME_CONSTANTS,
  OSM_HEX_TERRAIN_CATALOG,
  calculateLossScrapRecovery,
  type MunicipalMicroGrid,
  type MunicipalMicroCell,
  type DroneSignalProjection,
  type ExclusiveResourceNodeType,
  type MunicipalPublicInfrastructureType,
  type DroneArchetypeId,
  type OsmHexTerrainType,
  type GambitSlotRule,
  type SparseMapHexRecord,
  type ResourceTriad,
  type MunicipalBuildingType,
  type StatePerkId,
} from '@shared';
import {
  ZOOM_TACTICO,
  MUNICIPAL_GRID_COLS,
  MUNICIPAL_GRID_ROWS,
  MUNICIPAL_TOTAL_MICRO_CELLS,
  MICRO_CELL_SIZE_METERS,
  lngLatToGridCoords,
  lngLatToMunicipalMicroCell,
  h3Res9ToParentRes4,
  h3GridDistance,
  h3GridPathCells,
} from './coordinates';
import { canUnitTraverseOsmHex } from './roadNetworkEngine';

export interface TerritorialCell {
  x: number;
  y: number;
  clanId: string | null; // null si es tierra de nadie / neutral
  controlStrength: number; // 0 a 100%
  strategicNodeId?: string | null;
  terrainDefenseStar: number; // 0★ a 4★ de cobertura de terreno
}

export interface RegionGridMap {
  regionId: string;
  dimension: number; // e.g. 10x10 = 100 celdas
  cells: TerritorialCell[];
  controllingClanId: string | null;
  sovereigntyPercent: Record<string, number>; // clanId -> % de control
}

export interface ExpansionOrder {
  regionId: string;
  clanId: string;
  expansionBudgetFunds: number; // Fondos $G o Manpower invertido en el avance
  bridgeheadOrigin?: { x: number; y: number }; // Coordenada de inicio si es primera incursión
}

export interface ExpansionResult {
  regionId: string;
  clanId: string;
  cellsConquered: number;
  cellsContested: number;
  newSovereigntyPercent: number;
  capturedStrategicNodeIds: string[];
  remainingBudget: number;
}

// ============================================================================
// 1. INICIALIZACIÓN DE LA MALLA TERRITORIAL POR REGIÓN
// ============================================================================

/**
 * Genera la cuadrícula de micro-celdas para una región geopolítica.
 * Ubica nodos estratégicos en coordenadas centrales y asigna estrellas de terreno.
 */
export function initializeRegionGrid(
  regionId: string,
  dimension = 10,
  strategicNodes: StrategicNode[] = [],
  initialOwnerClanId: string | null = null
): RegionGridMap {
  const cells: TerritorialCell[] = [];
  const nodesInRegion = strategicNodes.filter((n) => n.regionId === regionId);

  // Mapear posiciones de nodos estratégicos en la cuadrícula
  const nodePositionMap = new Map<string, string>();
  if (nodesInRegion.length > 0) {
    // Si hay un nodo capital, va al centro (dim/2, dim/2)
    const mid = Math.floor(dimension / 2);
    nodesInRegion.forEach((node, index) => {
      const nx = (mid + index * 2) % dimension;
      const ny = (mid + Math.floor(index / 2) * 2) % dimension;
      nodePositionMap.set(`${nx},${ny}`, node.id);
    });
  }

  for (let y = 0; y < dimension; y++) {
    for (let x = 0; x < dimension; x++) {
      const coordKey = `${x},${y}`;
      const nodeId = nodePositionMap.get(coordKey) ?? null;

      // Terreno defensivo: los nodos y bordes tienen mayor cobertura (2★-4★)
      let stars = 1;
      if (nodeId) stars = 4; // Búnker / HQ estratégico
      else if (x === 0 || y === 0 || x === dimension - 1 || y === dimension - 1) stars = 2; // Colinas fronterizas
      else if ((x + y) % 3 === 0) stars = 3; // Bosques tácticos

      cells.push({
        x,
        y,
        clanId: initialOwnerClanId,
        controlStrength: initialOwnerClanId ? 100 : 0,
        strategicNodeId: nodeId,
        terrainDefenseStar: stars,
      });
    }
  }

  const grid: RegionGridMap = {
    regionId,
    dimension,
    cells,
    controllingClanId: initialOwnerClanId,
    sovereigntyPercent: {},
  };

  recalculateSovereignty(grid);
  return grid;
}

// ============================================================================
// 2. RECÁLCULO DE SOBERANÍA Y PORCENTAJE DE PINTADO
// ============================================================================

export function recalculateSovereignty(grid: RegionGridMap): void {
  const totalCells = grid.cells.length;
  if (totalCells === 0) return;

  const clanCounts: Record<string, number> = {};

  for (const cell of grid.cells) {
    if (cell.clanId) {
      clanCounts[cell.clanId] = (clanCounts[cell.clanId] || 0) + (cell.controlStrength / 100);
    }
  }

  const percentages: Record<string, number> = {};
  let dominantClan: string | null = null;
  let maxPercent = 0;

  for (const [clanId, count] of Object.entries(clanCounts)) {
    const percent = Number(((count / totalCells) * 100).toFixed(1));
    percentages[clanId] = percent;
    if (percent > maxPercent) {
      maxPercent = percent;
      dominantClan = clanId;
    }
  }

  grid.sovereigntyPercent = percentages;
  // Soberanía de facto consolidada al superar el 50%
  grid.controllingClanId = maxPercent >= 50 ? dominantClan : null;
}

// ============================================================================
// 3. ALGORITMO DE AVANCE Y PINTADO DE ZONA (TERRITORIAL.IO CORE)
// ============================================================================

/**
 * Ejecuta un pulso de expansión de frontera estilo Territorial.io.
 * Avanza célula a célula en 4 direcciones ortogonales a partir de la frontera actual.
 */
export function executeTerritorialExpansion(
  grid: RegionGridMap,
  order: ExpansionOrder,
  strategicNodesCatalog: StrategicNode[] = []
): ExpansionResult {
  const { clanId, expansionBudgetFunds, bridgeheadOrigin } = order;
  let currentBudget = expansionBudgetFunds;
  let conqueredCount = 0;
  let contestedCount = 0;
  const capturedNodes: string[] = [];

  const dim = grid.dimension;
  const getCell = (x: number, y: number) => grid.cells[y * dim + x];

  // 1. Encontrar celdas aliadas actuales
  const alliedCells = grid.cells.filter((c) => c.clanId === clanId && c.controlStrength >= 50);

  // Si el clan no tiene celdas, necesita una cabeza de puente inicial
  if (alliedCells.length === 0) {
    const originX = bridgeheadOrigin ? Math.min(dim - 1, Math.max(0, bridgeheadOrigin.x)) : 0;
    const originY = bridgeheadOrigin ? Math.min(dim - 1, Math.max(0, bridgeheadOrigin.y)) : 0;
    const bridgehead = getCell(originX, originY);

    if (currentBudget >= 500) {
      currentBudget -= 500;
      bridgehead.clanId = clanId;
      bridgehead.controlStrength = 100;
      conqueredCount++;

      if (bridgehead.strategicNodeId) {
        capturedNodes.push(bridgehead.strategicNodeId);
      }
    }
  }

  // 2. Bucle de Avance por Olas mientras haya presupuesto suficiente (mínimo 150 $G)
  const directions = [
    { dx: 0, dy: -1 }, // Norte
    { dx: 0, dy: 1 },  // Sur
    { dx: -1, dy: 0 }, // Oeste
    { dx: 1, dy: 0 },  // Este
  ];

  let progressMadeInWave = true;
  let waveLimit = 50; // Salvaguarda anti-bucle infinito

  while (currentBudget >= 150 && progressMadeInWave && waveLimit > 0) {
    waveLimit--;
    progressMadeInWave = false;

    // Identificar frontera activa
    const currentAllied = grid.cells.filter((c) => c.clanId === clanId && c.controlStrength >= 50);
    const frontierCandidates: TerritorialCell[] = [];
    const visited = new Set<string>();

    for (const allied of currentAllied) {
      for (const d of directions) {
        const nx = allied.x + d.dx;
        const ny = allied.y + d.dy;

        if (nx >= 0 && nx < dim && ny >= 0 && ny < dim) {
          const neighbor = getCell(nx, ny);
          const key = `${nx},${ny}`;

          if (!visited.has(key) && (neighbor.clanId !== clanId || neighbor.controlStrength < 100)) {
            visited.add(key);
            frontierCandidates.push(neighbor);
          }
        }
      }
    }

    if (frontierCandidates.length === 0) break;

    // Priorizar celdas con menor resistencia de terreno
    frontierCandidates.sort((a, b) => a.terrainDefenseStar - b.terrainDefenseStar);

    for (const target of frontierCandidates) {
      const cellCost = 150 * Math.max(1, target.terrainDefenseStar);
      if (currentBudget < cellCost) continue;

      currentBudget -= cellCost;
      progressMadeInWave = true;

      if (target.clanId === null) {
        target.clanId = clanId;
        target.controlStrength = 100;
        conqueredCount++;
      } else {
        contestedCount++;
        const resistancePenalty = target.terrainDefenseStar * 20;
        const netDamage = 60 - resistancePenalty;

        target.controlStrength -= netDamage;
        if (target.controlStrength <= 0) {
          target.clanId = clanId;
          target.controlStrength = Math.abs(target.controlStrength) + 50;
          conqueredCount++;
        }
      }

      if (target.strategicNodeId && target.clanId === clanId && target.controlStrength >= 50) {
        if (!capturedNodes.includes(target.strategicNodeId)) {
          capturedNodes.push(target.strategicNodeId);
        }
        const nodeObj = strategicNodesCatalog.find((n) => n.id === target.strategicNodeId);
        if (nodeObj) {
          nodeObj.controllingClanId = clanId;
        }
      }
    }
  }

  // 3. Actualizar porcentajes totales de soberanía
  recalculateSovereignty(grid);

  return {
    regionId: grid.regionId,
    clanId,
    cellsConquered: conqueredCount,
    cellsContested: contestedCount,
    newSovereigntyPercent: grid.sovereigntyPercent[clanId] ?? 0,
    capturedStrategicNodeIds: capturedNodes,
    remainingBudget: currentBudget,
  };
}

// ============================================================================
// 4. MULTIPLICADOR INDUSTRIAL Y LOGÍSTICO POR NODOS CAPTURADOS
// ============================================================================

export interface IndustrialNodeBuffs {
  rawExtractionMultiplier: number;
  refinerySpeedMultiplier: number;
  tollRevenueMultiplier: number;
  activeHegemonicBuff: boolean;
}

export function calculateIndustrialYieldWithNodes(
  baseYield: number,
  clanId: string,
  nodes: StrategicNode[]
): { finalYield: number; buffs: IndustrialNodeBuffs } {
  let extractionMult = 1.0;
  let refinerySpeed = 1.0;
  let tollMult = 1.0;
  let hegemonic = false;

  for (const node of nodes) {
    if (node.controllingClanId === clanId) {
      if (node.nodeType === 'capital_hq') {
        hegemonic = true;
        refinerySpeed += 0.10; // +10% velocidad de forja
        extractionMult += 0.15; // +15% producción energética nacional
      }
      if (node.nodeType === 'refinery_hub') {
        extractionMult += (node.buffValue - 1.0); // e.g. +25% en CRP Amuay o +30% Guri
      }
      if (node.nodeType === 'strait_canal') {
        tollMult += (node.buffValue / 100); // e.g. +5% peaje
      }
    }
  }

  const finalYield = Math.round(baseYield * extractionMult);

  return {
    finalYield,
    buffs: {
      rawExtractionMultiplier: Number(extractionMult.toFixed(2)),
      refinerySpeedMultiplier: Number(refinerySpeed.toFixed(2)),
      tollRevenueMultiplier: Number(tollMult.toFixed(2)),
      activeHegemonicBuff: hegemonic,
    },
  };
}

// ============================================================================
// 5. MALLA MUNICIPAL DE ~500 MICRO-CELDAS (100x100m) Y CAPTURA POR SEÑAL
// ============================================================================

const EXCLUSIVE_NODES_ROTATION: ExclusiveResourceNodeType[] = [
  'oil_energy',
  'silicon',
  'lithium',
  'alloys',
  'fuel',
];

const PUBLIC_INFRASTRUCTURE_SLOTS: Array<{
  cellIndex: number;
  type: MunicipalPublicInfrastructureType;
}> = [
  { cellIndex: 132, type: 'early_warning_radar' },
  { cellIndex: 262, type: 'rapid_repair_workshop' },
  { cellIndex: 387, type: 'sam_battery' },
];

export interface SignalCaptureTickResult {
  grid: MunicipalMicroGrid;
  cellsConverted: number;
  previousControllingClanId: string | null;
  newControllingClanId: string | null;
  sovereigntyFlipped: boolean;
  publicSlotsUnlocked: boolean;
}

/**
 * Inicializa una malla municipal determinista de 500 micro-celdas de 100x100m (25x20)
 * anclada al motor analítico O(1) a ZOOM_TACTICO = 15.0.
 */
export function initializeMunicipalMicroGrid(
  municipalityId: string,
  stateId: string = 'REG_VE_02',
  centerLngLat: [number, number] = [-71.4539, 10.3994],
  initialControllingClanId: string | null = null
): MunicipalMicroGrid {
  const cols = MUNICIPAL_GRID_COLS;
  const rows = MUNICIPAL_GRID_ROWS;
  const totalCells = MUNICIPAL_TOTAL_MICRO_CELLS;
  const centerLatRad = (centerLngLat[1] * Math.PI) / 180;
  const metersPerDegLng = 111_320 * Math.max(0.1, Math.cos(centerLatRad));
  const metersPerDegLat = 110_574;

  const cells: MunicipalMicroCell[] = [];
  const infraMap = new Map<number, MunicipalPublicInfrastructureType>(
    PUBLIC_INFRASTRUCTURE_SLOTS.map((s) => [s.cellIndex, s.type])
  );

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cellIndex = y * cols + x;
      const offsetX = (x + 0.5 - cols / 2) * MICRO_CELL_SIZE_METERS;
      const offsetY = (rows / 2 - (y + 0.5)) * MICRO_CELL_SIZE_METERS;
      const cellLngLat: [number, number] = [
        Number((centerLngLat[0] + offsetX / metersPerDegLng).toFixed(6)),
        Number((centerLngLat[1] + offsetY / metersPerDegLat).toFixed(6)),
      ];
      const { sector } = lngLatToGridCoords(cellLngLat, 20, ZOOM_TACTICO);

      const exclusiveResourceNode =
        cellIndex % 25 === 12
          ? EXCLUSIVE_NODES_ROTATION[Math.floor(cellIndex / 25) % EXCLUSIVE_NODES_ROTATION.length]!
          : null;

      cells.push({
        cellIndex,
        x,
        y,
        sector,
        lngLat: cellLngLat,
        controllingClanId: initialControllingClanId,
        signalInfluenceByClan: initialControllingClanId ? { [initialControllingClanId]: 100 } : {},
        exclusiveResourceNode,
        privateBuildingId: null,
        publicInfrastructureType: infraMap.get(cellIndex) ?? null,
        isSabotaged: false,
      });
    }
  }

  const grid: MunicipalMicroGrid = {
    municipalityId,
    stateId,
    totalCells,
    gridColumns: cols,
    gridRows: rows,
    cellSizeMeters: MICRO_CELL_SIZE_METERS,
    cells,
    controllingClanId: initialControllingClanId,
    majorityThreshold: MASTER_METAGAME_CONSTANTS.MUNICIPAL_MAJORITY_THRESHOLD,
    sovereigntyRatioByClan: initialControllingClanId ? { [initialControllingClanId]: 1.0 } : {},
    publicSlotsUnlocked: Boolean(initialControllingClanId),
    updatedAt: new Date().toISOString(),
  };

  return grid;
}

/**
 * Recalcula ratios de soberanía municipal y determina mayoría simple (>50%).
 */
export function recalculateMunicipalGridSovereignty(grid: MunicipalMicroGrid): void {
  const total = Math.max(1, grid.cells.length);
  const counts: Record<string, number> = {};

  for (const cell of grid.cells) {
    if (cell.controllingClanId) {
      counts[cell.controllingClanId] = (counts[cell.controllingClanId] || 0) + 1;
    }
  }

  const ratios: Record<string, number> = {};
  let winnerClanId: string | null = null;
  let bestRatio = 0;

  for (const [clanId, count] of Object.entries(counts)) {
    const ratio = Number((count / total).toFixed(4));
    ratios[clanId] = ratio;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      winnerClanId = clanId;
    }
  }

  grid.sovereigntyRatioByClan = ratios;
  // Regla canónica: Mayoría simple estricta (> 50%)
  if (bestRatio > grid.majorityThreshold) {
    grid.controllingClanId = winnerClanId;
    grid.publicSlotsUnlocked = true;
  } else {
    grid.controllingClanId = null;
    grid.publicSlotsUnlocked = false;
  }
  grid.updatedAt = new Date().toISOString();
}

/**
 * Evalúa un tick periódico de proyección de señal (cada 10 minutos por defecto)
 * para los drones desplegados sobre la malla de micro-celdas del municipio.
 */
export function evaluateSignalCaptureTick(
  grid: MunicipalMicroGrid,
  deployedDrones: DroneSignalProjection[],
  tickMinutes: number = MASTER_METAGAME_CONSTANTS.SIGNAL_TICK_MINUTES,
  stateConquestSpeedMultiplier: number = 1.0
): SignalCaptureTickResult {
  const previousControllingClanId = grid.controllingClanId;
  const centerCell = grid.cells[Math.floor(grid.cells.length / 2)];
  const municipalityCenter: [number, number] = centerCell ? centerCell.lngLat : [-71.4539, 10.3994];
  const tickFactor = Math.max(0.1, tickMinutes / MASTER_METAGAME_CONSTANTS.SIGNAL_TICK_MINUTES);
  const speedMult = Math.max(0.5, stateConquestSpeedMultiplier);

  let cellsConverted = 0;

  for (const drone of deployedDrones) {
    if (drone.hp <= 0 || drone.captureRatePerTick <= 0 || drone.signalRadiusCells < 0) continue;

    let originX: number;
    let originY: number;

    if (
      drone.centerCellIndex !== undefined &&
      drone.centerCellIndex >= 0 &&
      drone.centerCellIndex < grid.cells.length
    ) {
      const targetCell = grid.cells[drone.centerCellIndex]!;
      originX = targetCell.x;
      originY = targetCell.y;
    } else {
      const projected = lngLatToMunicipalMicroCell(drone.coordinates, municipalityCenter);
      originX = projected.x;
      originY = projected.y;
    }

    const radius = Math.ceil(drone.signalRadiusCells);
    const baseInfluence = drone.captureRatePerTick * (Math.max(1, drone.hp) / 100) * tickFactor * speedMult;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const cx = originX + dx;
        const cy = originY + dy;
        if (cx < 0 || cx >= grid.gridColumns || cy < 0 || cy >= grid.gridRows) continue;

        const dist = Math.hypot(dx, dy);
        if (dist > drone.signalRadiusCells) continue;

        const cell = grid.cells[cy * grid.gridColumns + cx];
        if (!cell) continue;

        const falloff = Math.max(0.4, 1 - dist / (drone.signalRadiusCells + 1.5));
        const delta = Math.max(1, Math.round(baseInfluence * falloff));

        if (cell.controllingClanId === drone.clanId) {
          cell.signalInfluenceByClan[drone.clanId] = Math.min(
            100,
            (cell.signalInfluenceByClan[drone.clanId] ?? 100) + delta
          );
          continue;
        }

        if (cell.controllingClanId !== null) {
          const rivalId = cell.controllingClanId;
          const rivalStrength = cell.signalInfluenceByClan[rivalId] ?? 100;
          const remainingRival = rivalStrength - delta;
          if (remainingRival > 0) {
            cell.signalInfluenceByClan[rivalId] = remainingRival;
          } else {
            delete cell.signalInfluenceByClan[rivalId];
            cell.controllingClanId = null;
            const spillover = Math.abs(remainingRival);
            if (spillover > 0) {
              cell.signalInfluenceByClan[drone.clanId] = Math.min(
                100,
                (cell.signalInfluenceByClan[drone.clanId] ?? 0) + spillover
              );
              if (cell.signalInfluenceByClan[drone.clanId]! >= 100) {
                cell.controllingClanId = drone.clanId;
                cellsConverted++;
              }
            }
          }
          continue;
        }

        // Celda neutral
        const nextInf = Math.min(100, (cell.signalInfluenceByClan[drone.clanId] ?? 0) + delta);
        cell.signalInfluenceByClan[drone.clanId] = nextInf;
        if (nextInf >= 100) {
          cell.controllingClanId = drone.clanId;
          cellsConverted++;
        }
      }
    }
  }

  recalculateMunicipalGridSovereignty(grid);

  return {
    grid,
    cellsConverted,
    previousControllingClanId,
    newControllingClanId: grid.controllingClanId,
    sovereigntyFlipped: previousControllingClanId !== grid.controllingClanId,
    publicSlotsUnlocked: grid.publicSlotsUnlocked,
  };
}

// ==============================================================================
// 6. ORQUESTADOR DE TICKS CADA 15 MINUTOS (PIPELINE SECUENCIAL DE 5 FASES H3)
// ==============================================================================

export interface H3PersistentDroneState {
  id: string;
  ownerUserId: string;
  corpId: string;
  unitType: DroneArchetypeId;
  tier?: number;
  currentH3: bigint;
  hp10: number; // Escala 1-10 UI (equivale a hp10 * 10 en 1-100)
  fuel: number;
  maxFuel: number;
  waypoints: bigint[];
  currentWpIndex: number;
  patrolDirection?: 1 | -1;
  ticksOnBuilding: number;
  ticksDeployed: number;
  aiRules: GambitSlotRule[];
}

export interface H3PersistentBuildingState {
  id: string;
  h3Index: bigint;
  municipalityId: string;
  ownerUserId: string;
  corpId: string | null;
  buildingType: MunicipalBuildingType | 'PRIVATE_FACTORY';
  hp10: number;
  isDisabled: boolean;
  grossOutputPerTick?: ResourceTriad;
  alliedTaxRate?: number;
}

export interface H3MunicipalityContext {
  municipalityId: string;
  stateId: string;
  totalHexes: number;
  ownerCorpId: string | null;
}

export interface H3TickCorporationContext {
  corpId: string;
  controlledStatesCount: number;
  activeStatePerks: StatePerkId[];
}

export interface FifteenMinuteTickInput {
  tickNumber: number;
  drones: H3PersistentDroneState[];
  buildings: H3PersistentBuildingState[];
  sparseHexes: Map<string, SparseMapHexRecord>;
  municipalities: H3MunicipalityContext[];
  corporations: Record<string, H3TickCorporationContext>;
  terrainResolver?: (h3: bigint) => { terrain: OsmHexTerrainType; hasBridge?: boolean };
}

export interface FifteenMinuteTickOutput {
  tickNumber: number;
  survivingDrones: H3PersistentDroneState[];
  destroyedDrones: Array<{
    droneId: string;
    ownerUserId: string;
    corpId: string;
    reason: 'fuel_starvation' | 'combat' | 'aa_battery';
    techScrapRecovered: number;
  }>;
  updatedBuildings: H3PersistentBuildingState[];
  combatEventsCount: number;
  aaInterceptionsCount: number;
  buildingsCapturedOrSabotaged: string[];
  playerResourceSettlements: Record<string, ResourceTriad>;
  corpVaultTaxCredits: Record<string, ResourceTriad>;
  municipalityUpdates: Array<{
    municipalityId: string;
    ownerCorpId: string | null;
    controlPercentage: number;
    flipped: boolean;
  }>;
  sparseHexCount: number;
}

/**
 * Ejecuta las 5 fases secuenciales del tick de 15 minutos del Cerebro Geotáctico Persistente H3.
 */
export function executeFifteenMinuteTickPipeline(
  input: FifteenMinuteTickInput
): FifteenMinuteTickOutput {
  const terrainAt =
    input.terrainResolver ??
    (() => ({ terrain: 'PLAIN' as OsmHexTerrainType, hasBridge: false }));

  const drones = input.drones.map((d) => ({ ...d }));
  const buildings = input.buildings.map((b) => ({ ...b }));
  const destroyedDrones: FifteenMinuteTickOutput['destroyedDrones'] = [];
  const playerResourceSettlements: Record<string, ResourceTriad> = {};
  const corpVaultTaxCredits: Record<string, ResourceTriad> = {};
  const buildingsCapturedOrSabotaged: string[] = [];

  const ensureTriad = (map: Record<string, ResourceTriad>, key: string) => {
    if (!map[key]) map[key] = { alloys: 0, fuel: 0, microchips: 0 };
    return map[key]!;
  };

  // ============================================================================
  // FASE 1: MANTENIMIENTO, COMBUSTIBLE, REPARACIÓN Y LIQUIDACIÓN DE FÁBRICAS
  // ============================================================================
  const activeWorkshops = buildings.filter(
    (b) => b.buildingType === 'RAPID_REPAIR_WORKSHOP' && !b.isDisabled && b.hp10 > 0
  );
  const activeApcs = drones.filter((d) => d.unitType === 'logistics_apc' && d.hp10 > 0);

  for (const drone of drones) {
    const spec = CANONICAL_H3_DRONE_CATALOG[drone.unitType];
    const corpCtx = input.corporations[drone.corpId];
    const perks = corpCtx?.activeStatePerks ?? [];
    const overload = calculateAdministrativeOverloadFuelMultiplier({
      controlledStatesCount: corpCtx?.controlledStatesCount ?? 1,
      hasVanguardLogisticsInBorderState: perks.includes('VANGUARD_LOGISTICS'),
    });

    const burn = Number(((spec.fuelPerHour / 4) * overload.netFuelMultiplier).toFixed(2));
    drone.fuel = Math.max(0, Number((drone.fuel - burn).toFixed(2)));
    drone.ticksDeployed += 1;

    // Recarga y reparación por APC adyacente (h3GridDistance <= 1) o Taller de Reparación (<= 3)
    const nearApc = activeApcs.find(
      (apc) => apc.corpId === drone.corpId && h3GridDistance(apc.currentH3, drone.currentH3) <= 1
    );
    const nearWorkshop = activeWorkshops.find(
      (w) => w.corpId === drone.corpId && h3GridDistance(w.h3Index, drone.currentH3) <= 3
    );

    if (nearWorkshop) {
      drone.fuel = drone.maxFuel;
      drone.hp10 = Math.min(10, Number((drone.hp10 + 0.75).toFixed(2))); // +3 HP/h
    } else if (nearApc) {
      drone.fuel = drone.maxFuel;
      const apcCorpPerks = input.corporations[nearApc.corpId]?.activeStatePerks ?? [];
      const repairPerTick = apcCorpPerks.includes('CENTRALIZED_SUPPLY') ? 0.625 : 0.375; // +25%/h o +15%/h
      drone.hp10 = Math.min(10, Number((drone.hp10 + repairPerTick).toFixed(2)));
    } else if (drone.fuel <= 0) {
      // Desgaste mecánico sin combustible: -2 HP/h = -0.5 HP/tick
      drone.hp10 = Math.max(0, Number((drone.hp10 - 0.5).toFixed(2)));
      if (drone.hp10 <= 0) {
        destroyedDrones.push({
          droneId: drone.id,
          ownerUserId: drone.ownerUserId,
          corpId: drone.corpId,
          reason: 'fuel_starvation',
          techScrapRecovered: calculateLossScrapRecovery(drone.tier ?? 1, 1),
        });
      }
    }
  }

  for (const bld of buildings) {
    if (bld.buildingType !== 'PRIVATE_FACTORY' || bld.isDisabled || bld.hp10 <= 0 || !bld.grossOutputPerTick) {
      continue;
    }
    const mun = input.municipalities.find((m) => m.municipalityId === bld.municipalityId);
    const munOwnerCorpId = mun?.ownerCorpId ?? null;
    const isAllied = munOwnerCorpId === null || munOwnerCorpId === bld.corpId;
    const hasCustoms = buildings.some(
      (other) =>
        other.municipalityId === bld.municipalityId &&
        other.buildingType === 'CUSTOMS_REFINERY' &&
        !other.isDisabled &&
        other.hp10 > 0
    );
    const ownerPerks = bld.corpId ? (input.corporations[bld.corpId]?.activeStatePerks ?? []) : [];
    const settled = settleResourceTriadExtraction({
      gross: bld.grossOutputPerTick,
      isAlliedMunicipality: isAllied,
      alliedTaxRate: bld.alliedTaxRate ?? 0.1,
      hasCorporateFreeZonePerk: ownerPerks.includes('CORPORATE_FREE_ZONE'),
      hasCustomsRefineryBuilding: hasCustoms,
    });

    const pAcc = ensureTriad(playerResourceSettlements, bld.ownerUserId);
    pAcc.alloys += settled.netPlayer.alloys;
    pAcc.fuel += settled.netPlayer.fuel;
    pAcc.microchips += settled.netPlayer.microchips;

    if (munOwnerCorpId) {
      const cAcc = ensureTriad(corpVaultTaxCredits, munOwnerCorpId);
      cAcc.alloys += settled.retainedCorpVault.alloys;
      cAcc.fuel += settled.retainedCorpVault.fuel;
      cAcc.microchips += settled.retainedCorpVault.microchips;
    }
  }

  // ============================================================================
  // FASE 2: EVALUACIÓN DE SENSORES (H3 RES 4) E IA DE CARTUCHOS GAMBITS
  // ============================================================================
  const activeRadars = buildings.filter(
    (b) => b.buildingType === 'EARLY_WARNING_RADAR' && !b.isDisabled && b.hp10 > 0
  );
  const aliveDrones = drones.filter((d) => d.hp10 > 0);
  const dronesByRes4 = new Map<bigint, H3PersistentDroneState[]>();
  for (const d of aliveDrones) {
    const parent4 = h3Res9ToParentRes4(d.currentH3);
    const list = dronesByRes4.get(parent4) ?? [];
    list.push(d);
    dronesByRes4.set(parent4, list);
  }

  const droneActionMap = new Map<
    string,
    { action: string; targetDroneId?: string; targetBuildingId?: string }
  >();

  for (const drone of aliveDrones) {
    const spec = CANONICAL_H3_DRONE_CATALOG[drone.unitType];
    const observerTerrain = terrainAt(drone.currentH3).terrain;
    const extraVision =
      drone.unitType === 'infantry_swarm'
        ? OSM_HEX_TERRAIN_CATALOG[observerTerrain].infantryVisionBonus
        : 0;
    const visionRange = spec.visionRangeHexes + extraVision;
    const parent4 = h3Res9ToParentRes4(drone.currentH3);
    const localPool = dronesByRes4.get(parent4) ?? aliveDrones;

    const visibleEnemies = localPool.filter((other) => {
      if (other.corpId === drone.corpId || other.hp10 <= 0) return false;
      const dist = h3GridDistance(drone.currentH3, other.currentH3);
      if (dist > visionRange) return false;

      const otherTerrain = terrainAt(other.currentH3).terrain;
      const concealed = OSM_HEX_TERRAIN_CATALOG[otherTerrain].concealsGroundUnits;
      if (!concealed) return true;

      // Revelado solo por adyacencia (dist <= 1) de Recon/Infantería o Torre de Radar activa (radio 15)
      const revealedByScoutOrInfantry =
        dist <= 1 && (drone.unitType === 'recon_explorer' || drone.unitType === 'infantry_swarm');
      const revealedByRadar = activeRadars.some(
        (r) => r.corpId === drone.corpId && h3GridDistance(r.h3Index, other.currentH3) <= 15
      );
      return revealedByScoutOrInfantry || revealedByRadar;
    });

    const perks = input.corporations[drone.corpId]?.activeStatePerks ?? [];
    const maxAttackRange =
      spec.maxAttackRange +
      (perks.includes('INTEGRATED_DEFENSE_NET') &&
      (drone.unitType === 'light_artillery' || drone.unitType === 'tactical_missile')
        ? 1
        : 0);

    const enemiesInAttackRange = visibleEnemies.filter((e) => {
      const dist = h3GridDistance(drone.currentH3, e.currentH3);
      return dist >= spec.minAttackRange && dist <= maxAttackRange;
    });

    const weakEnemy = enemiesInAttackRange.find((e) => {
      const myCombat = resolveDeterministicH3Combat({
        attackerType: drone.unitType,
        defenderType: e.unitType,
        attackerHp10: drone.hp10,
        defenderHp10: e.hp10,
        defenderTerrain: terrainAt(e.currentH3).terrain,
        distanceHexes: h3GridDistance(drone.currentH3, e.currentH3),
      });
      return myCombat.baseDamageRatio >= 0.7;
    });

    const superiorEnemy = visibleEnemies.find((e) => {
      const enemyCombat = resolveDeterministicH3Combat({
        attackerType: e.unitType,
        defenderType: drone.unitType,
        attackerHp10: e.hp10,
        defenderHp10: drone.hp10,
        defenderTerrain: observerTerrain,
        distanceHexes: 1,
      });
      return enemyCombat.baseDamageRatio >= 0.75;
    });

    const currentHex = input.sparseHexes.get(drone.currentH3.toString());
    const enemyBuildingOnHex = buildings.find(
      (b) => b.h3Index === drone.currentH3 && b.corpId !== drone.corpId && b.hp10 > 0
    );

    const evaluated = evaluateCartridgeGambitRules(drone.aiRules, {
      hpPercent: drone.hp10 * 10,
      fuelPercent: (drone.fuel / Math.max(1, drone.maxFuel)) * 100,
      enemyInRange: enemiesInAttackRange.length > 0,
      weakEnemyInRange: Boolean(weakEnemy),
      superiorEnemyInRange: Boolean(superiorEnemy),
      enemyNearAllyFactory2: visibleEnemies.some((e) =>
        buildings.some(
          (b) => b.corpId === drone.corpId && h3GridDistance(b.h3Index, e.currentH3) <= 2
        )
      ),
      hexState: !currentHex?.ownerCorpId
        ? 'NEUTRAL'
        : currentHex.ownerCorpId === drone.corpId
        ? 'ALLIED'
        : 'ENEMY',
      hexHasEnemyFactory: Boolean(enemyBuildingOnHex),
      municipalityEnemyControlPercent: 0,
    });

    const chosenTarget = weakEnemy ?? enemiesInAttackRange[0];
    droneActionMap.set(drone.id, {
      action: evaluated.action,
      targetDroneId: chosenTarget?.id,
      targetBuildingId: enemyBuildingOnHex?.id,
    });
  }

  // ============================================================================
  // FASE 3: RESOLUCIÓN DE COMBATE SIMULTÁNEA + BATERÍAS ANTIAÉREAS FIJAS
  // ============================================================================
  let aaInterceptionsCount = 0;
  let combatEventsCount = 0;

  // 3A. Baterías Antiaéreas Fijas atacan Bombarderos en radio 4 (o 5 con Red Defensa Integrada)
  const activeAaBatteries = buildings.filter(
    (b) => b.buildingType === 'FIXED_AA_BATTERY' && !b.isDisabled && b.hp10 > 0
  );
  for (const aa of activeAaBatteries) {
    const aaPerks = aa.corpId ? (input.corporations[aa.corpId]?.activeStatePerks ?? []) : [];
    const aaRadius = aaPerks.includes('INTEGRATED_DEFENSE_NET') ? 5 : 4;
    for (const drone of aliveDrones) {
      if (drone.unitType !== 'bomber_drone' || drone.corpId === aa.corpId || drone.hp10 <= 0) continue;
      if (h3GridDistance(aa.h3Index, drone.currentH3) <= aaRadius) {
        const aaStrike = resolveDeterministicH3Combat({
          attackerType: 'anti_air',
          defenderType: 'bomber_drone',
          attackerHp10: 10,
          defenderHp10: drone.hp10,
          defenderTerrain: 'PLAIN',
          distanceHexes: 1,
        });
        drone.hp10 = aaStrike.defenderHp10After;
        aaInterceptionsCount++;
        if (drone.hp10 <= 0) {
          destroyedDrones.push({
            droneId: drone.id,
            ownerUserId: drone.ownerUserId,
            corpId: drone.corpId,
            reason: 'aa_battery',
            techScrapRecovered: calculateLossScrapRecovery(drone.tier ?? 1, 1),
          });
        }
      }
    }
  }

  // 3B. Combate entre drones y asedio de lanzamisiles sobre estructuras
  const firedArtilleryIds = new Set<string>();
  for (const attacker of aliveDrones) {
    if (attacker.hp10 <= 0) continue;
    const decision = droneActionMap.get(attacker.id);
    if (!decision) continue;

    const isAttackAction =
      decision.action === 'ATTACK_WEAKEST' ||
      decision.action === 'INTERCEPT_AND_ATTACK' ||
      decision.action === 'KEEP_DISTANCE_AND_FIRE';
    if (!isAttackAction || !decision.targetDroneId) continue;

    const defender = aliveDrones.find((d) => d.id === decision.targetDroneId);
    if (!defender || defender.hp10 <= 0) continue;

    const dist = h3GridDistance(attacker.currentH3, defender.currentH3);
    const spec = CANONICAL_H3_DRONE_CATALOG[attacker.unitType];
    if (!spec.canMoveAndFireSameTick) {
      firedArtilleryIds.add(attacker.id);
    }

    const res = resolveDeterministicH3Combat({
      attackerType: attacker.unitType,
      defenderType: defender.unitType,
      attackerHp10: attacker.hp10,
      defenderHp10: defender.hp10,
      attackerTerrain: terrainAt(attacker.currentH3).terrain,
      defenderTerrain: terrainAt(defender.currentH3).terrain,
      distanceHexes: dist,
    });

    if (res.canAttack) {
      combatEventsCount++;
      defender.hp10 = res.defenderHp10After;
      attacker.hp10 = res.attackerHp10After;

      if (defender.hp10 <= 0) {
        destroyedDrones.push({
          droneId: defender.id,
          ownerUserId: defender.ownerUserId,
          corpId: defender.corpId,
          reason: 'combat',
          techScrapRecovered: calculateLossScrapRecovery(defender.tier ?? 1, 1),
        });
      }
      if (attacker.hp10 <= 0) {
        destroyedDrones.push({
          droneId: attacker.id,
          ownerUserId: attacker.ownerUserId,
          corpId: attacker.corpId,
          reason: 'combat',
          techScrapRecovered: calculateLossScrapRecovery(attacker.tier ?? 1, 1),
        });
      }
    }
  }

  // ============================================================================
  // FASE 4: MOVIMIENTO H3, CONQUISTA EN SPARSE MAP Y SABOTAJE (2H / 1H)
  // ============================================================================
  const activeJammers = buildings.filter(
    (b) => b.buildingType === 'JAMMER_CENTER' && !b.isDisabled && b.hp10 > 0
  );
  const activeBunkers = buildings.filter(
    (b) => b.buildingType === 'COMMAND_BUNKER' && !b.isDisabled && b.hp10 > 0
  );
  const fallenBunkerMunicipalities = new Set<string>();

  for (const drone of aliveDrones) {
    if (drone.hp10 <= 0) continue;
    const spec = CANONICAL_H3_DRONE_CATALOG[drone.unitType];
    const decision = droneActionMap.get(drone.id);
    const perks = input.corporations[drone.corpId]?.activeStatePerks ?? [];

    // Movimiento H3 (Artillería y Lanzamisiles no mueven y disparan en el mismo tick)
    const shouldHold =
      firedArtilleryIds.has(drone.id) ||
      decision?.action === 'HOLD_POSITION_ANCHOR' ||
      decision?.action === 'SABOTAGE_OR_CAPTURE_BUILDING';

    if (!shouldHold && drone.waypoints.length > 0 && drone.fuel > 0) {
      const targetWp = drone.waypoints[drone.currentWpIndex % drone.waypoints.length]!;
      const path = h3GridPathCells(drone.currentH3, targetWp);
      const extraBlitzSteps =
        perks.includes('BLITZKRIEG_DOCTRINE') &&
        drone.ticksDeployed <= 24 &&
        (drone.unitType === 'recon_explorer' || drone.unitType === 'medium_tank')
          ? 1
          : 0;
      const steps = Math.min(path.length - 1, 1 + extraBlitzSteps);
      if (steps >= 1) {
        const candidateH3 = path[steps]!;
        const tInfo = terrainAt(candidateH3);
        if (canUnitTraverseOsmHex(drone.unitType, tInfo.terrain, tInfo.hasBridge)) {
          drone.currentH3 = candidateH3;
        }
      }
      if (drone.currentH3 === targetWp && drone.waypoints.length > 1) {
        drone.currentWpIndex = (drone.currentWpIndex + 1) % drone.waypoints.length;
      }
    }

    // Conquista de hexágono H3 en Sparse Map
    if (spec.conquestProgressPerTick15m > 0) {
      const hexKey = drone.currentH3.toString();
      const existingHex = input.sparseHexes.get(hexKey);
      const munId = existingHex?.municipalityId ?? input.municipalities[0]?.municipalityId ?? 'MUN_ZULIA_CABIMAS';
      const tInfo = terrainAt(drone.currentH3);

      let progressGain = spec.conquestProgressPerTick15m;
      const jammed = activeJammers.some(
        (j) => j.corpId !== drone.corpId && h3GridDistance(j.h3Index, drone.currentH3) <= 6
      );
      if (jammed) progressGain *= 0.5;
      const bunkerProtected = activeBunkers.some(
        (bk) => bk.municipalityId === munId && bk.corpId !== drone.corpId
      );
      if (bunkerProtected) progressGain *= 0.75;

      const currentProgress = existingHex?.captureProgress ?? 0;
      const nextProgress = Math.min(100, Number((currentProgress + progressGain).toFixed(2)));
      const ownerCorpId =
        nextProgress >= 100 ? drone.corpId : (existingHex?.ownerCorpId ?? null);

      input.sparseHexes.set(hexKey, {
        h3Index: hexKey,
        municipalityId: munId,
        terrainType: tInfo.terrain,
        hasBridge: tInfo.hasBridge,
        ownerCorpId,
        captureProgress: ownerCorpId === drone.corpId ? 100 : nextProgress,
        contestingCorpId: ownerCorpId === drone.corpId ? null : drone.corpId,
        lastUpdatedTick: input.tickNumber,
        lastActiveTimestampMs: Date.now(),
      });
    }

    // Captura o sabotaje de edificio por Dron Infantería (2h = 8 ticks, o 1h = 4 ticks con Guerra Asimétrica)
    if (spec.canCaptureBuildings) {
      const targetBuilding = buildings.find(
        (b) => b.h3Index === drone.currentH3 && b.corpId !== drone.corpId && b.hp10 > 0
      );
      if (targetBuilding) {
        drone.ticksOnBuilding += 1;
        const requiredTicks = perks.includes('ASYMMETRIC_WARFARE') ? 4 : 8;
        if (drone.ticksOnBuilding >= requiredTicks) {
          targetBuilding.corpId = drone.corpId;
          drone.ticksOnBuilding = 0;
          buildingsCapturedOrSabotaged.push(targetBuilding.id);
          if (targetBuilding.buildingType === 'COMMAND_BUNKER') {
            fallenBunkerMunicipalities.add(targetBuilding.municipalityId);
          }
        }
      } else {
        drone.ticksOnBuilding = 0;
      }
    }
  }

  // ============================================================================
  // FASE 5: RECÁLCULO GEOPOLÍTICO MACRO (>50% MUNICIPIO, BÚNKER Y PERKS >60%/>85%)
  // ============================================================================
  const municipalityUpdates: FifteenMinuteTickOutput['municipalityUpdates'] = [];

  for (const mun of input.municipalities) {
    const corpHexCounts: Record<string, number> = {};
    for (const hex of input.sparseHexes.values()) {
      if (hex.municipalityId !== mun.municipalityId) continue;

      // Perk Movilización Civil: +5%/h = +1.25%/tick si no hay drones enemigos en el hexágono
      if (mun.ownerCorpId && hex.ownerCorpId === mun.ownerCorpId && hex.captureProgress < 100) {
        const ownerPerks = input.corporations[mun.ownerCorpId]?.activeStatePerks ?? [];
        const hasEnemyOnHex = aliveDrones.some(
          (d) => d.hp10 > 0 && d.corpId !== mun.ownerCorpId && d.currentH3.toString() === hex.h3Index
        );
        if (ownerPerks.includes('CIVIL_MOBILIZATION') && !hasEnemyOnHex) {
          hex.captureProgress = Math.min(100, Number((hex.captureProgress + 1.25).toFixed(2)));
        }
      }

      if (hex.ownerCorpId) {
        corpHexCounts[hex.ownerCorpId] = (corpHexCounts[hex.ownerCorpId] || 0) + 1;
      }
    }

    let nextOwner = mun.ownerCorpId;
    let bestPct = 0;

    if (fallenBunkerMunicipalities.has(mun.municipalityId)) {
      const bunker = buildings.find(
        (b) => b.municipalityId === mun.municipalityId && b.buildingType === 'COMMAND_BUNKER'
      );
      if (bunker?.corpId) {
        nextOwner = bunker.corpId;
        bestPct = 100;
      }
    } else {
      for (const [corpId, count] of Object.entries(corpHexCounts)) {
        const pct = Number(((count / Math.max(1, mun.totalHexes)) * 100).toFixed(2));
        if (pct > bestPct) {
          bestPct = pct;
          if (pct > 50) {
            nextOwner = corpId;
          }
        }
      }
    }

    municipalityUpdates.push({
      municipalityId: mun.municipalityId,
      ownerCorpId: nextOwner,
      controlPercentage: bestPct,
      flipped: nextOwner !== mun.ownerCorpId,
    });
  }

  return {
    tickNumber: input.tickNumber,
    survivingDrones: aliveDrones.filter((d) => d.hp10 > 0),
    destroyedDrones,
    updatedBuildings: buildings,
    combatEventsCount,
    aaInterceptionsCount,
    buildingsCapturedOrSabotaged,
    playerResourceSettlements,
    corpVaultTaxCredits,
    municipalityUpdates,
    sparseHexCount: input.sparseHexes.size,
  };
}