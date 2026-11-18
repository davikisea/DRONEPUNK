import type { Map as MapLibreMap } from 'maplibre-gl';
import { assetLoader, UNIT_GREEN_SPRITE_PATHS } from '@shared';
import { SPRITE_GPU_SIZE } from './tacticalMapStyle';

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
  for (const [bType, frame] of Object.entries(GBA_BUILDING_FRAME_MAP)) {
    if (bType !== 'hq') {
      list.push({ key: `tile_neutral_${bType}`, sheet: 'neutral', frame });
    }
    for (const faction of GBA_FACTION_SHEETS) {
      list.push({ key: `tile_${faction.owner}_${bType}`, sheet: faction.sheet, frame });
    }
  }
  return list;
}

export const SYNTHETIC_TERRAIN_CANVASES = new Map<string, HTMLCanvasElement>();
let terrainSheetsLoaded = false;

export function isTerrainSheetsLoaded(): boolean {
  return terrainSheetsLoaded;
}

export function markTerrainSheetsLoaded(): void {
  terrainSheetsLoaded = true;
}

export function ensureSyntheticCoastalCanvases16(): void {
  if (SYNTHETIC_TERRAIN_CANVASES.size > 0) return;
  const seaRaw = assetLoader.getRawSheetSprite('neutral', 'sea.png');
  if (seaRaw) {
    const rimW = 2;
    const innerW = 1;
    const foamW = 1;
    for (let mask = 1; mask < 256; mask++) {
      const card = mask & 15;
      const diag = mask & 240;
      if (card === 0 && diag === 0) continue;
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(seaRaw, 0, 0, 16, 16);

      const foamOff = rimW + innerW;
      ctx.fillStyle = '#93C5FD';
      if (card & 1) ctx.fillRect(0, foamOff, 16, foamW);
      if (card & 2) ctx.fillRect(16 - foamOff - foamW, 0, foamW, 16);
      if (card & 4) ctx.fillRect(0, 16 - foamOff - foamW, 16, foamW);
      if (card & 8) ctx.fillRect(foamOff, 0, foamW, 16);

      ctx.fillStyle = '#8B6E3A';
      if (card & 1) ctx.fillRect(0, rimW, 16, innerW);
      if (card & 2) ctx.fillRect(16 - rimW - innerW, 0, innerW, 16);
      if (card & 4) ctx.fillRect(0, 16 - rimW - innerW, 16, innerW);
      if (card & 8) ctx.fillRect(rimW, 0, innerW, 16);

      ctx.fillStyle = '#E8D59E';
      if (card & 1) ctx.fillRect(0, 0, 16, rimW);
      if (card & 2) ctx.fillRect(16 - rimW, 0, rimW, 16);
      if (card & 4) ctx.fillRect(0, 16 - rimW, 16, rimW);
      if (card & 8) ctx.fillRect(0, 0, rimW, 16);

      if ((diag & 16) && !(card & 1) && !(card & 2)) {
        ctx.fillStyle = '#93C5FD'; ctx.fillRect(12, 0, 4, 4);
        ctx.fillStyle = '#8B6E3A'; ctx.fillRect(13, 0, 3, 3);
        ctx.fillStyle = '#E8D59E'; ctx.fillRect(14, 0, 2, 2);
      }
      if ((diag & 32) && !(card & 4) && !(card & 2)) {
        ctx.fillStyle = '#93C5FD'; ctx.fillRect(12, 12, 4, 4);
        ctx.fillStyle = '#8B6E3A'; ctx.fillRect(13, 13, 3, 3);
        ctx.fillStyle = '#E8D59E'; ctx.fillRect(14, 14, 2, 2);
      }
      if ((diag & 64) && !(card & 4) && !(card & 8)) {
        ctx.fillStyle = '#93C5FD'; ctx.fillRect(0, 12, 4, 4);
        ctx.fillStyle = '#8B6E3A'; ctx.fillRect(0, 13, 3, 3);
        ctx.fillStyle = '#E8D59E'; ctx.fillRect(0, 14, 2, 2);
      }
      if ((diag & 128) && !(card & 1) && !(card & 8)) {
        ctx.fillStyle = '#93C5FD'; ctx.fillRect(0, 0, 4, 4);
        ctx.fillStyle = '#8B6E3A'; ctx.fillRect(0, 0, 3, 3);
        ctx.fillStyle = '#E8D59E'; ctx.fillRect(0, 0, 2, 2);
      }
      SYNTHETIC_TERRAIN_CANVASES.set(`tile_sea_edge_${mask}`, c);
    }
  }
  const shoalRaw = assetLoader.getRawSheetSprite('neutral', 'shoal.png');
  if (shoalRaw) {
    const rimW = 2;
    const innerW = 1;
    for (let mask = 1; mask < 16; mask++) {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(shoalRaw, 0, 0, 16, 16);
      ctx.fillStyle = '#8B6E3A';
      if (mask & 1) ctx.fillRect(0, rimW, 16, innerW);
      if (mask & 2) ctx.fillRect(16 - rimW - innerW, 0, innerW, 16);
      if (mask & 4) ctx.fillRect(0, 16 - rimW - innerW, 16, innerW);
      if (mask & 8) ctx.fillRect(rimW, 0, innerW, 16);
      ctx.fillStyle = '#E8D59E';
      if (mask & 1) ctx.fillRect(0, 0, 16, rimW);
      if (mask & 2) ctx.fillRect(16 - rimW, 0, rimW, 16);
      if (mask & 4) ctx.fillRect(0, 16 - rimW, 16, rimW);
      if (mask & 8) ctx.fillRect(0, 0, rimW, 16);
      SYNTHETIC_TERRAIN_CANVASES.set(`tile_shoal_edge_${mask}`, c);
    }
  }
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

export function registerTerrainTileSprites(map: MapLibreMap): void {
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

  const catalog = getAllTerrainSpriteCatalog();
  for (const item of catalog) {
    if (!map.hasImage(item.key)) {
      map.addImage(item.key, emptyImageData, { pixelRatio: 1 });
    }
  }
  for (let mask = 1; mask < 256; mask++) {
    if (
      ((mask & 16) && ((mask & 1) || (mask & 2))) ||
      ((mask & 32) && ((mask & 2) || (mask & 4))) ||
      ((mask & 64) && ((mask & 4) || (mask & 8))) ||
      ((mask & 128) && ((mask & 8) || (mask & 1)))
    ) {
      continue;
    }
    const edgeKey = `tile_sea_edge_${mask}`;
    if (!map.hasImage(edgeKey)) {
      map.addImage(edgeKey, emptyImageData, { pixelRatio: 1 });
    }
  }
  for (let mask = 1; mask < 16; mask++) {
    const shoalEdgeKey = `tile_shoal_edge_${mask}`;
    if (!map.hasImage(shoalEdgeKey)) {
      map.addImage(shoalEdgeKey, emptyImageData, { pixelRatio: 1 });
    }
  }

  void Promise.all([
    assetLoader.loadSheet('neutral'),
    ...GBA_FACTION_SHEETS.map((f) => assetLoader.loadSheet(f.sheet)),
  ]).then(() => {
    const plainRaw = assetLoader.getRawSheetSprite('neutral', 'plain-normal.png');
    for (const item of catalog) {
      const raw = assetLoader.getRawSheetSprite(item.sheet, item.frame);
      if (!raw) continue;
      const isTall = raw.height > raw.width && raw.width > 0;
      const targetH = isTall
        ? Math.round(SPRITE_GPU_SIZE * (raw.height / raw.width))
        : SPRITE_GPU_SIZE;
      const canvas = document.createElement('canvas');
      canvas.width = SPRITE_GPU_SIZE;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, SPRITE_GPU_SIZE, targetH);
      if (isTall && plainRaw) {
        ctx.drawImage(plainRaw, 0, targetH - SPRITE_GPU_SIZE, SPRITE_GPU_SIZE, SPRITE_GPU_SIZE);
      }
      ctx.drawImage(raw, 0, 0, SPRITE_GPU_SIZE, targetH);
      const imgData = ctx.getImageData(0, 0, SPRITE_GPU_SIZE, targetH);
      if (map.hasImage(item.key)) {
        if (targetH === SPRITE_GPU_SIZE) {
          map.updateImage(item.key, imgData);
        } else {
          map.removeImage(item.key);
          map.addImage(item.key, imgData, { pixelRatio: 1 });
        }
      } else {
        map.addImage(item.key, imgData, { pixelRatio: 1 });
      }
    }

    const seaRaw = assetLoader.getRawSheetSprite('neutral', 'sea.png');
    const rimWidth = 6;
    const innerWidth = 3;
    const foamWidth = 2;
    const cornerSize = rimWidth + innerWidth;
    const foamCornerSize = cornerSize + foamWidth;
    if (seaRaw) {
      for (let mask = 1; mask < 256; mask++) {
        if (
          ((mask & 16) && ((mask & 1) || (mask & 2))) ||
          ((mask & 32) && ((mask & 2) || (mask & 4))) ||
          ((mask & 64) && ((mask & 4) || (mask & 8))) ||
          ((mask & 128) && ((mask & 8) || (mask & 1)))
        ) {
          continue;
        }
        const edgeKey = `tile_sea_edge_${mask}`;
        const canvas = document.createElement('canvas');
        canvas.width = SPRITE_GPU_SIZE;
        canvas.height = SPRITE_GPU_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(seaRaw, 0, 0, SPRITE_GPU_SIZE, SPRITE_GPU_SIZE);

        const foamOffset = rimWidth + innerWidth;
        ctx.fillStyle = '#93C5FD';
        if (mask & 1) ctx.fillRect(0, foamOffset, SPRITE_GPU_SIZE, foamWidth);
        if (mask & 2) ctx.fillRect(SPRITE_GPU_SIZE - foamOffset - foamWidth, 0, foamWidth, SPRITE_GPU_SIZE);
        if (mask & 4) ctx.fillRect(0, SPRITE_GPU_SIZE - foamOffset - foamWidth, SPRITE_GPU_SIZE, foamWidth);
        if (mask & 8) ctx.fillRect(foamOffset, 0, foamWidth, SPRITE_GPU_SIZE);
        if (mask & 16) ctx.fillRect(SPRITE_GPU_SIZE - foamCornerSize, 0, foamCornerSize, foamCornerSize);
        if (mask & 32) ctx.fillRect(SPRITE_GPU_SIZE - foamCornerSize, SPRITE_GPU_SIZE - foamCornerSize, foamCornerSize, foamCornerSize);
        if (mask & 64) ctx.fillRect(0, SPRITE_GPU_SIZE - foamCornerSize, foamCornerSize, foamCornerSize);
        if (mask & 128) ctx.fillRect(0, 0, foamCornerSize, foamCornerSize);

        ctx.fillStyle = '#8B6E3A';
        if (mask & 1) ctx.fillRect(0, rimWidth, SPRITE_GPU_SIZE, innerWidth);
        if (mask & 2) ctx.fillRect(SPRITE_GPU_SIZE - rimWidth - innerWidth, 0, innerWidth, SPRITE_GPU_SIZE);
        if (mask & 4) ctx.fillRect(0, SPRITE_GPU_SIZE - rimWidth - innerWidth, SPRITE_GPU_SIZE, innerWidth);
        if (mask & 8) ctx.fillRect(rimWidth, 0, innerWidth, SPRITE_GPU_SIZE);
        if (mask & 16) ctx.fillRect(SPRITE_GPU_SIZE - cornerSize, 0, cornerSize, cornerSize);
        if (mask & 32) ctx.fillRect(SPRITE_GPU_SIZE - cornerSize, SPRITE_GPU_SIZE - cornerSize, cornerSize, cornerSize);
        if (mask & 64) ctx.fillRect(0, SPRITE_GPU_SIZE - cornerSize, cornerSize, cornerSize);
        if (mask & 128) ctx.fillRect(0, 0, cornerSize, cornerSize);

        ctx.fillStyle = '#E8D59E';
        if (mask & 1) ctx.fillRect(0, 0, SPRITE_GPU_SIZE, rimWidth);
        if (mask & 2) ctx.fillRect(SPRITE_GPU_SIZE - rimWidth, 0, rimWidth, SPRITE_GPU_SIZE);
        if (mask & 4) ctx.fillRect(0, SPRITE_GPU_SIZE - rimWidth, SPRITE_GPU_SIZE, rimWidth);
        if (mask & 8) ctx.fillRect(0, 0, rimWidth, SPRITE_GPU_SIZE);
        if (mask & 16) ctx.fillRect(SPRITE_GPU_SIZE - rimWidth, 0, rimWidth, rimWidth);
        if (mask & 32) ctx.fillRect(SPRITE_GPU_SIZE - rimWidth, SPRITE_GPU_SIZE - rimWidth, rimWidth, rimWidth);
        if (mask & 64) ctx.fillRect(0, SPRITE_GPU_SIZE - rimWidth, rimWidth, rimWidth);
        if (mask & 128) ctx.fillRect(0, 0, rimWidth, rimWidth);

        const imgData = ctx.getImageData(0, 0, SPRITE_GPU_SIZE, SPRITE_GPU_SIZE);
        if (map.hasImage(edgeKey)) {
          map.updateImage(edgeKey, imgData);
        } else {
          map.addImage(edgeKey, imgData, { pixelRatio: 1 });
        }
      }
    }

    const shoalRaw = assetLoader.getRawSheetSprite('neutral', 'shoal.png');
    if (shoalRaw) {
      for (let mask = 1; mask < 16; mask++) {
        const shoalEdgeKey = `tile_shoal_edge_${mask}`;
        const canvas = document.createElement('canvas');
        canvas.width = SPRITE_GPU_SIZE;
        canvas.height = SPRITE_GPU_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(shoalRaw, 0, 0, SPRITE_GPU_SIZE, SPRITE_GPU_SIZE);

        ctx.fillStyle = '#8B6E3A';
        if (mask & 1) ctx.fillRect(0, rimWidth, SPRITE_GPU_SIZE, innerWidth);
        if (mask & 2) ctx.fillRect(SPRITE_GPU_SIZE - rimWidth - innerWidth, 0, innerWidth, SPRITE_GPU_SIZE);
        if (mask & 4) ctx.fillRect(0, SPRITE_GPU_SIZE - rimWidth - innerWidth, SPRITE_GPU_SIZE, innerWidth);
        if (mask & 8) ctx.fillRect(rimWidth, 0, innerWidth, SPRITE_GPU_SIZE);

        ctx.fillStyle = '#E8D59E';
        if (mask & 1) ctx.fillRect(0, 0, SPRITE_GPU_SIZE, rimWidth);
        if (mask & 2) ctx.fillRect(SPRITE_GPU_SIZE - rimWidth, 0, rimWidth, SPRITE_GPU_SIZE);
        if (mask & 4) ctx.fillRect(0, SPRITE_GPU_SIZE - rimWidth, SPRITE_GPU_SIZE, rimWidth);
        if (mask & 8) ctx.fillRect(0, 0, rimWidth, SPRITE_GPU_SIZE);

        const imgData = ctx.getImageData(0, 0, SPRITE_GPU_SIZE, SPRITE_GPU_SIZE);
        if (map.hasImage(shoalEdgeKey)) {
          map.updateImage(shoalEdgeKey, imgData);
        } else {
          map.addImage(shoalEdgeKey, imgData, { pixelRatio: 1 });
        }
      }
    }
    map.triggerRepaint();
  });
}
