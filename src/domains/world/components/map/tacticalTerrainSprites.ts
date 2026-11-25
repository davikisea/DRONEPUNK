import type { Map as MapLibreMap } from 'maplibre-gl';
import { UNIT_GREEN_SPRITE_PATHS } from '@shared';
import { SPRITE_GPU_SIZE } from './tacticalMapStyle';

export type AwbwDir8 = 'NW' | 'N' | 'NE' | 'W' | 'E' | 'SW' | 'S' | 'SE';

export const GBA_ROAD_VARIANTS = [
  'road-right-left',
  'road-top-bottom',
  'road-top-right',
  'road-top-left',
  'road-right-bottom',
  'road-bottom-left',
  'road-top-right-bottom',
  'road-top-bottom-left',
  'road-top-right-left',
  'road-right-bottom-left',
  'road-top-right-bottom-left',
] as const;

export const GBA_RIVER_VARIANTS = [
  'river-right-left',
  'river-top-bottom',
  'river-top-right',
  'river-top-left',
  'river-right-bottom',
  'river-bottom-left',
  'river-top-right-bottom',
  'river-top-bottom-left',
  'river-top-right-left',
  'river-right-bottom-left',
  'river-top-right-bottom-left',
] as const;

export const GBA_PIPE_VARIANTS = [
  'pipe-top',
  'pipe-right',
  'pipe-bottom',
  'pipe-left',
  'pipe-right-left',
  'pipe-top-bottom',
  'pipe-top-right',
  'pipe-top-left',
  'pipe-right-bottom',
  'pipe-bottom-left',
] as const;

/**
 * 46 combinaciones oficiales de borde terrestre de Sea/* en orden de precedencia exacto
 * (port 1:1 de SEA_OUTCOMES en SPRITE-FORGE-STUDIO/src/09_city_world_engine.py:222-281) + 'Sea' = 47 stems.
 */
export const AWBW_SEA_OUTCOMES: ReadonlyArray<readonly [readonly AwbwDir8[], string]> = [
  [['N', 'E', 'S', 'W'], 'N-E-S-W'],
  [['E', 'S', 'W'], 'E-S-W'],
  [['N', 'S', 'W'], 'N-S-W'],
  [['N', 'E', 'W'], 'N-E-W'],
  [['N', 'E', 'S'], 'N-E-S'],
  [['N', 'S'], 'N-S'],
  [['E', 'W'], 'E-W'],
  [['N', 'E', 'SW'], 'N-E-SW'],
  [['N', 'E'], 'N-E'],
  [['E', 'S', 'NW'], 'E-S-NW'],
  [['E', 'S'], 'E-S'],
  [['S', 'W', 'NE'], 'S-W-NE'],
  [['S', 'W'], 'S-W'],
  [['N', 'W', 'SE'], 'N-W-SE'],
  [['N', 'W'], 'N-W'],
  [['N', 'SE', 'SW'], 'N-SE-SW'],
  [['N', 'SE'], 'N-SE'],
  [['N', 'SW'], 'N-SW'],
  [['N'], 'N'],
  [['E', 'NW', 'SW'], 'E-NW-SW'],
  [['E', 'NW'], 'E-NW'],
  [['E', 'SW'], 'E-SW'],
  [['E'], 'E'],
  [['S', 'NW', 'NE'], 'S-NW-NE'],
  [['S', 'NW'], 'S-NW'],
  [['S', 'NE'], 'S-NE'],
  [['S'], 'S'],
  [['W', 'NE', 'SE'], 'W-NE-SE'],
  [['W', 'NE'], 'W-NE'],
  [['W', 'SE'], 'W-SE'],
  [['W'], 'W'],
  [['NW', 'NE', 'SE', 'SW'], 'NW-NE-SE-SW'],
  [['NE', 'SE', 'SW'], 'NE-SE-SW'],
  [['NW', 'SE', 'SW'], 'NW-SE-SW'],
  [['NW', 'NE', 'SW'], 'NW-NE-SW'],
  [['NW', 'NE', 'SE'], 'NW-NE-SE'],
  [['SE', 'SW'], 'SE-SW'],
  [['NW', 'SW'], 'NW-SW'],
  [['NW', 'NE'], 'NW-NE'],
  [['NE', 'SE'], 'NE-SE'],
  [['NW', 'SE'], 'NW-SE'],
  [['NE', 'SW'], 'NE-SW'],
  [['NW'], 'NW'],
  [['NE'], 'NE'],
  [['SE'], 'SE'],
  [['SW'], 'SW'],
];

export const AWBW_SEA_STEMS: readonly string[] = [
  'Sea',
  ...AWBW_SEA_OUTCOMES.map(([, stem]) => stem),
];

/**
 * 81 stems oficiales de Shoal/* (3^4 sobre N, E, S, W: '', dir, 'A' + dir, o 'C' si vacío).
 */
export const AWBW_SHOAL_STEMS: readonly string[] = (() => {
  const dirs = ['N', 'E', 'S', 'W'] as const;
  const opts = dirs.map((d) => ['', d, `A${d}`]);
  const stems: string[] = [];
  for (const n of opts[0]) {
    for (const e of opts[1]) {
      for (const s of opts[2]) {
        for (const w of opts[3]) {
          const parts = [n, e, s, w].filter(Boolean);
          stems.push(parts.length > 0 ? parts.join('-') : 'C');
        }
      }
    }
  }
  return stems;
})();

export const GBA_STATIC_SPRITES: Record<string, { sheet: 'neutral'; frame: string }> = {
  tile_plains: { sheet: 'neutral', frame: 'plain-normal.png' },
  tile_plain_alt: { sheet: 'neutral', frame: 'plain.png' },
  tile_plains_rain: { sheet: 'neutral', frame: 'plain-rain.png' },
  tile_plains_snow: { sheet: 'neutral', frame: 'plain-snow.png' },
  tile_sea: { sheet: 'neutral', frame: 'sea.png' },
  tile_shoal: { sheet: 'neutral', frame: 'shoal.png' },
  tile_reef: { sheet: 'neutral', frame: 'reef.png' },
  tile_forest: { sheet: 'neutral', frame: 'forest.png' },
  tile_forest_snow: { sheet: 'neutral', frame: 'forest-snow.png' },
  tile_wood: { sheet: 'neutral', frame: 'wood.png' },
  tile_mountain: { sheet: 'neutral', frame: 'mountain.png' },
  tile_mountain_rain: { sheet: 'neutral', frame: 'mountain-rain.png' },
  tile_mountain_snow: { sheet: 'neutral', frame: 'mountain-snow.png' },
  tile_silo: { sheet: 'neutral', frame: 'unusedSilo.png' },
  tile_usedSilo: { sheet: 'neutral', frame: 'usedSilo.png' },
  tile_bridge_h: { sheet: 'neutral', frame: 'bridge-right-left.png' },
  tile_bridge_v: { sheet: 'neutral', frame: 'bridge-top-bottom.png' },
  tile_pipe_h: { sheet: 'neutral', frame: 'pipe-right-left.png' },
  tile_pipe_v: { sheet: 'neutral', frame: 'pipe-top-bottom.png' },
  tile_pipeSeam_h: { sheet: 'neutral', frame: 'pipeseam-right-left.png' },
  tile_pipeSeam_v: { sheet: 'neutral', frame: 'pipeseam-top-bottom.png' },
  tile_rubble_h: { sheet: 'neutral', frame: 'hrubble-0.png' },
  tile_rubble_v: { sheet: 'neutral', frame: 'vrubble-0.png' },
};

export const GBA_FACTION_SHEETS = [
  { owner: 'p1', sheet: 'orange-star' },
  { owner: 'p2', sheet: 'blue-moon' },
  { owner: 'p3', sheet: 'yellow-comet' },
  { owner: 'p4', sheet: 'green-earth' },
  { owner: 'p5', sheet: 'black-hole' },
] as const;

export const GBA_BUILDING_FRAME_MAP: Record<string, string> = {
  city: 'city-0.png',
  factory: 'base-0.png',
  airport: 'airport-0.png',
  port: 'port-0.png',
  hq: 'hq-0.png',
  commtower: 'commtower-0.png',
  lab: 'lab-0.png',
};

export const TERRAIN_FILL_COLORS: Record<string, string> = {
  sea: '#0E3A6E',
  shoal: '#2E6F73',
  reef: '#144E6B',
  river: '#1E488F',
  road: '#4B5563',
  bridge: '#92400E',
};

export function getAllTerrainSpriteCatalog(): Array<{ key: string; sheet: string; frame: string }> {
  const list: Array<{ key: string; sheet: string; frame: string }> = [];
  for (const [key, spec] of Object.entries(GBA_STATIC_SPRITES)) {
    list.push({ key, sheet: spec.sheet, frame: spec.frame });
  }
  for (const r of GBA_ROAD_VARIANTS) {
    list.push({ key: `tile_${r}`, sheet: 'neutral', frame: `${r}.png` });
  }
  for (const r of GBA_RIVER_VARIANTS) {
    list.push({ key: `tile_${r}`, sheet: 'neutral', frame: `${r}.png` });
  }
  for (const p of GBA_PIPE_VARIANTS) {
    list.push({ key: `tile_${p}`, sheet: 'neutral', frame: `${p}.png` });
  }
  // 47 sprites oficiales AWBW Sea/*
  for (const stem of AWBW_SEA_STEMS) {
    list.push({ key: `tile_sea_${stem}`, sheet: 'neutral', frame: `sea-${stem}.png` });
  }
  // 81 sprites oficiales AWBW Shoal/*
  for (const stem of AWBW_SHOAL_STEMS) {
    list.push({ key: `tile_shoal_${stem}`, sheet: 'neutral', frame: `shoal-${stem}.png` });
  }
  for (const [bType, frame] of Object.entries(GBA_BUILDING_FRAME_MAP)) {
    // Invariante de neutralidad gris: TODOS los edificios (incluido HQ) tienen sprite neutral gris
    list.push({ key: `tile_neutral_${bType}`, sheet: 'neutral', frame });
    for (const faction of GBA_FACTION_SHEETS) {
      list.push({ key: `tile_${faction.owner}_${bType}`, sheet: faction.sheet, frame });
    }
  }
  list.push({ key: 'tile_neutral_city_aw1', sheet: 'neutral', frame: 'city-aw1-0.png' });
  return list;
}

let terrainSheetsLoaded = false;

export function isTerrainSheetsLoaded(): boolean {
  return terrainSheetsLoaded;
}

export function markTerrainSheetsLoaded(): void {
  terrainSheetsLoaded = true;
}

export function registerGreenUnitSprites(map: MapLibreMap): void {
  const emptyCanvas = document.createElement('canvas');
  emptyCanvas.width = SPRITE_GPU_SIZE;
  emptyCanvas.height = SPRITE_GPU_SIZE;
  const emptyCtx = emptyCanvas.getContext('2d');
  const emptyImageData = emptyCtx
    ? emptyCtx.createImageData(SPRITE_GPU_SIZE, SPRITE_GPU_SIZE)
    : {
        width: SPRITE_GPU_SIZE,
        height: SPRITE_GPU_SIZE,
        data: new Uint8ClampedArray(SPRITE_GPU_SIZE * SPRITE_GPU_SIZE * 4),
      };

  for (const spriteKey of Object.keys(UNIT_GREEN_SPRITE_PATHS)) {
    if (!map.hasImage(spriteKey)) {
      map.addImage(spriteKey, emptyImageData);
    }
  }

  for (const [spriteKey, assetPath] of Object.entries(UNIT_GREEN_SPRITE_PATHS)) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SPRITE_GPU_SIZE;
        canvas.height = SPRITE_GPU_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, SPRITE_GPU_SIZE, SPRITE_GPU_SIZE);
        ctx.drawImage(img, 0, 0, SPRITE_GPU_SIZE, SPRITE_GPU_SIZE);
        const imgData = ctx.getImageData(0, 0, SPRITE_GPU_SIZE, SPRITE_GPU_SIZE);
        if (map.hasImage(spriteKey)) {
          map.updateImage(spriteKey, imgData);
        } else {
          map.addImage(spriteKey, imgData);
        }
        map.triggerRepaint();
      } catch (err) {
        console.warn(`[TacticalWorldMap] Error cargando sprite GPU ${spriteKey}:`, err);
      }
    };
    img.src = assetPath;
  }
}
