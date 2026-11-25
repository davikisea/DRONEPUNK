/**
 * ==============================================================================
 * MACRO-PUENTES RECTOS 1D Y CABECERAS MARÍTIMAS (@domains/world)
 * ==============================================================================
 * Garantiza que cruces icónicos de theatre_roads.json (como el Puente General
 * Rafael Urdaneta sobre el Estrecho del Lago de Maracaibo) jamás sean descartados
 * por límites de span A*:
 * - Traza una línea 100 % recta horizontal (HBridge, bridgeAxis = 1) de orilla a orilla.
 * - Calcula automáticamente las 2 cabeceras terrestres (Punta Piedras y Punta Iguana)
 *   para anclar sendos SATs marítimos (harbor_promenade_cove) con puertos sobre el Lago.
 * ==============================================================================
 */

import {
  globalTacticalCellToLngLat,
  lngLatToGlobalTacticalCell,
  ZOOM_TACTICO,
  type LngLat,
} from './coordinates';

const GRID_SIZE = 20;

export interface MacroBridgeDefinition {
  readonly id: string;
  readonly name: string;
  readonly stateId: string;
  readonly westCoord: LngLat;
  readonly eastCoord: LngLat;
  readonly westMunicipalityId: string | null;
  readonly eastMunicipalityId: string | null;
  readonly westSatId: string;
  readonly westSatName: string;
  readonly eastSatId: string;
  readonly eastSatName: string;
}

export interface ResolvedStraightMacroBridge {
  readonly def: MacroBridgeDefinition;
  readonly axis: 1 | 2;
  /** Fila global constante (para HBridge) */
  readonly fixedGy: number;
  /** Primera celda de tierra firme en la orilla occidental */
  readonly westLandfall: readonly [number, number];
  /** Primera celda de tierra firme en la orilla oriental */
  readonly eastLandfall: readonly [number, number];
  /** Tramo completo [gx, gy, bridgeAxis] (0 en cabezales de tierra, 1 en agua) */
  readonly tiles: ReadonlyArray<readonly [number, number, 0 | 1 | 2]>;
  /** Número exacto de tiles de puente sobre agua */
  readonly waterBridgeTiles: number;
  /** Centro sugerido para el SAT marítimo occidental */
  readonly westSatAnchor: readonly [number, number];
  /** Centro sugerido para el SAT marítimo oriental */
  readonly eastSatAnchor: readonly [number, number];
}

export const CANONICAL_MACRO_BRIDGES: readonly MacroBridgeDefinition[] = [
  {
    id: 'BRIDGE_RAFAEL_URDANETA',
    name: 'Puente General Rafael Urdaneta',
    stateId: 'REG_VE_02',
    // Coordenadas reales verificadas en public/map/theatre_roads.json (road_24631981)
    westCoord: [-71.612, 10.5738],
    eastCoord: [-71.5295, 10.5756],
    westMunicipalityId: 'MUN_ZULIA_SAN_FRANCISCO',
    eastMunicipalityId: 'MUN_ZULIA_SANTA_RITA',
    westSatId: 'SAT_URDANETA_WEST_PUNTA_PIEDRAS',
    westSatName: 'SAT: Punta Piedras [harbor_promenade_cove]',
    eastSatId: 'SAT_URDANETA_EAST_PUNTA_IGUANA',
    eastSatName: 'SAT: Punta Iguana [harbor_promenade_cove]',
  },
];

/**
 * Resuelve un macro-puente como una línea horizontal 100 % recta (gy constante)
 * escaneando desde el centro del estrecho hacia ambas orillas hasta tocar tierra firme real.
 */
export function resolveStraightMacroBridge(
  def: MacroBridgeDefinition,
  landPredicate: (lng: number, lat: number) => boolean
): ResolvedStraightMacroBridge {
  const wCell = lngLatToGlobalTacticalCell(def.westCoord, GRID_SIZE, ZOOM_TACTICO);
  const eCell = lngLatToGlobalTacticalCell(def.eastCoord, GRID_SIZE, ZOOM_TACTICO);
  const fixedGy = Math.round((wCell.globalY + eCell.globalY) / 2);
  const midGx = Math.round((wCell.globalX + eCell.globalX) / 2);

  const isLand = (gx: number, gy: number): boolean => {
    const [lng, lat] = globalTacticalCellToLngLat(gx, gy, GRID_SIZE, ZOOM_TACTICO);
    return landPredicate(lng, lat);
  };

  // Escanear hacia el Oeste desde el centro del estrecho hasta encontrar tierra firme sólida
  let westLandGx = wCell.globalX;
  for (let gx = midGx; gx >= wCell.globalX - 45; gx--) {
    if (isLand(gx, fixedGy) && isLand(gx - 1, fixedGy)) {
      westLandGx = gx;
      break;
    }
  }

  // Escanear hacia el Este desde el centro del estrecho hasta encontrar tierra firme sólida
  let eastLandGx = eCell.globalX;
  for (let gx = midGx; gx <= eCell.globalX + 45; gx++) {
    if (isLand(gx, fixedGy) && isLand(gx + 1, fixedGy)) {
      eastLandGx = gx;
      break;
    }
  }

  // Extender 6 tiles tierra adentro en ambos extremos para conectar limpiamente con los SATs de cabecera
  const startGx = westLandGx - 6;
  const endGx = eastLandGx + 6;
  const tiles: Array<[number, number, 0 | 1 | 2]> = [];
  let waterBridgeTiles = 0;

  for (let gx = startGx; gx <= endGx; gx++) {
    const land = isLand(gx, fixedGy);
    if (!land) {
      tiles.push([gx, fixedGy, 1]);
      waterBridgeTiles++;
    } else {
      tiles.push([gx, fixedGy, 0]);
    }
  }

  // Anclas de los 2 SATs marítimos de cabecera (tocando la costa, desplazados ~11 tiles tierra adentro)
  const westSatAnchor: [number, number] = [westLandGx - 10, fixedGy];
  const eastSatAnchor: [number, number] = [eastLandGx + 10, fixedGy];

  return {
    def,
    axis: 1,
    fixedGy,
    westLandfall: [westLandGx, fixedGy],
    eastLandfall: [eastLandGx, fixedGy],
    tiles,
    waterBridgeTiles,
    westSatAnchor,
    eastSatAnchor,
  };
}

let cachedMacroBridges: ResolvedStraightMacroBridge[] | null = null;

export function getResolvedMacroBridges(
  landPredicate: (lng: number, lat: number) => boolean
): readonly ResolvedStraightMacroBridge[] {
  if (cachedMacroBridges) return cachedMacroBridges;
  cachedMacroBridges = CANONICAL_MACRO_BRIDGES.map((def) =>
    resolveStraightMacroBridge(def, landPredicate)
  );
  return cachedMacroBridges;
}

export function resetMacroBridgesCache(): void {
  cachedMacroBridges = null;
}
