/**
 * ==============================================================================
 * RENDERIZADOR CARTOGRÁFICO WEBGL C4ISR - TACTICAL WORLD MAP (OPENPLACE BRIDGE)
 * ==============================================================================
 * Especificación Canónica: docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md §3.2
 * Motor: MapLibre GL (WebGL 2.0) + Cuadrícula Vectorial GPU Continua.
 * - Semantic LOD: Macro-Globo (LOD 1) -> Operacional (LOD 2) -> Combate Táctico (LOD 3).
 * - Zero-SSR: Importación dinámica en useEffect para compatibilidad con Vite/SSR.
 * - Cuadrícula 100% Vectorial GPU: Cobertura continua del viewport sin CanvasSource.
 * - Inactividad / Blur: Congelación automática tras 5 min sin actividad.
 * ==============================================================================
 */

import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type {
  Map as MapLibreMap,
  GeoJSONSource,
  MapMouseEvent,
  StyleSpecification,
  CustomLayerInterface,
} from 'maplibre-gl';
// WebGL MapLibre Styles loaded globally in main.tsx
import * as worldDomain from '@domains/world';
import {
  ZOOM_GLOBAL,
  ZOOM_OPERACIONAL,
  ZOOM_TACTICO,
  TACTICAL_SPRITE_MAX_ZOOM,
  lngLatToGridCoords,
  tileFractionToLngLat,
  gridCoordsToLngLat,
  stateSovereigntyService,
  spatialDeploymentService,
} from '@domains/world';
import { useTerritoryMap } from '../hooks/useTerritoryMap';
import {
  type TacticalUnit,
  assetLoader,
  UNIT_GREEN_SPRITE_PATHS,
  resolveUnitSpriteKey,
} from '@shared';
import {
  MicroTacticalDeckHUD,
  TacticalUnitDeployModal,
  TacticalRtsEngine,
  operationalUnitsService,
} from '@domains/tactics';
import { TacticalConstructionDrawer } from '@domains/economy';
import { audioManager } from '@domains/game-feel';

export interface TacticalWorldMapProps {
  userClanId?: string | null;
  activeProvinceId?: string | null;
  activeBattleUnits?: TacticalUnit[];
  fogOfWarBase64?: string | null;
  onSelectCountry?: (countryId: string) => void;
  onSelectProvince?: (provinceId: string) => void;
  onSelectMunicipality?: (
    municipalityId: string,
    meta?: { name?: string; cityName?: string; stateId?: string }
  ) => void;
  onSelectTacticalCell?: (
    sector: [number, number],
    cell: [number, number],
    lngLat?: [number, number]
  ) => void;
  onZoomChange?: (zoom: number) => void;
  hideLegacyMicroDeck?: boolean;
  externalDeployTrigger?: number;
  externalBuildTrigger?: number;
  className?: string;
}

type RtsUnitView = TacticalUnit & {
  owner?: string;
  isDestroyed?: boolean;
};

interface TacticalLineStringGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

interface TacticalPolygonGeometry {
  type: 'Polygon';
  coordinates: [number, number][][];
}

interface TacticalPointGeometry {
  type: 'Point';
  coordinates: [number, number];
}

interface TacticalGeoJSONFeature<G, P = Record<string, unknown>> {
  type: 'Feature';
  geometry: G;
  properties: P;
}

interface TacticalGeoJSONCollection<G, P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: TacticalGeoJSONFeature<G, P>[];
}

const C4ISR_HIDE_LAYERS_REGEX = /^poi_|^landuse|^building(-3d)?$|^road_label|^waterway_label|^transit_/;
const ACTIVITY_TIMEOUT_MS = 300_000; // 5 minutos para standby automático (0% CPU)
const TACTICAL_GRID_DIMENSION = 20;  // Cuadrícula de 20x20 celdas por sector
const MAX_GRID_SECTORS_PER_AXIS = 5;
const SPRITE_GPU_SIZE = 48;

function registerGreenUnitSprites(map: MapLibreMap): void {
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

const GBA_ROAD_VARIANTS = [
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

const GBA_RIVER_VARIANTS = [
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

const GBA_PIPE_VARIANTS = [
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

const GBA_STATIC_SPRITES: Record<string, { sheet: 'neutral'; frame: string }> = {
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

const GBA_FACTION_SHEETS = [
  { owner: 'p1', sheet: 'orange-star' },
  { owner: 'p2', sheet: 'blue-moon' },
  { owner: 'p3', sheet: 'yellow-comet' },
  { owner: 'p4', sheet: 'green-earth' },
  { owner: 'p5', sheet: 'black-hole' },
] as const;

const GBA_BUILDING_FRAME_MAP: Record<string, string> = {
  city: 'city-0.png',
  factory: 'base-0.png',
  airport: 'airport-0.png',
  port: 'port-0.png',
  hq: 'hq-0.png',
  commtower: 'commtower-0.png',
  lab: 'lab-0.png',
};

const TERRAIN_FILL_COLORS: Record<string, string> = {
  sea: '#0E3A6E',
  shoal: '#2E6F73',
  reef: '#144E6B',
  river: '#1E488F',
  road: '#4B5563',
  bridge: '#92400E',
};

function getAllTerrainSpriteCatalog(): Array<{ key: string; sheet: string; frame: string }> {
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

const SYNTHETIC_TERRAIN_CANVASES = new Map<string, HTMLCanvasElement>();
let terrainSheetsLoaded = false;

function ensureSyntheticCoastalCanvases16(): void {
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

function createTacticalTerrainWebGLLayer(mapInstance: MapLibreMap): CustomLayerInterface {
  const catalogLookup = new Map<string, { sheet: string; frame: string }>();
  for (const item of getAllTerrainSpriteCatalog()) {
    catalogLookup.set(item.key, { sheet: item.sheet, frame: item.frame });
  }

  let program: WebGLProgram | null = null;
  let posBuffer: WebGLBuffer | null = null;
  let uvBuffer: WebGLBuffer | null = null;
  let aPosLoc = -1;
  let aUvLoc = -1;
  let uMatrixLoc: WebGLUniformLocation | null = null;
  let uRectLoc: WebGLUniformLocation | null = null;
  let uOpacityLoc: WebGLUniformLocation | null = null;
  let uTexLoc: WebGLUniformLocation | null = null;

  const sectorTextureCache = new Map<string, { tex: WebGLTexture; rev: number }>();
  let lastRev = -1;

  const buildSectorTexture = (gl: WebGL2RenderingContext, sx: number, sy: number, rev: number): WebGLTexture | null => {
    const dim = TACTICAL_GRID_DIMENSION;
    const cellPx = 16;
    const canvas = document.createElement('canvas');
    canvas.width = dim * cellPx; // 320px nativo
    canvas.height = dim * cellPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;

    const center = spatialDeploymentService.getSectorTerrainMatrix([sx, sy], dim);
    const north = spatialDeploymentService.getSectorTerrainMatrix([sx, sy - 1], dim);
    const east = spatialDeploymentService.getSectorTerrainMatrix([sx + 1, sy], dim);
    const south = spatialDeploymentService.getSectorTerrainMatrix([sx, sy + 1], dim);
    const west = spatialDeploymentService.getSectorTerrainMatrix([sx - 1, sy], dim);
    const plainRaw = assetLoader.getRawSheetSprite('neutral', 'plain-normal.png');

    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const spriteKey = resolveFastTileSpriteKey(sx, sy, x, y, center, north, east, south, west);
        const px = x * cellPx;
        const py = y * cellPx;
        const synth = SYNTHETIC_TERRAIN_CANVASES.get(spriteKey);
        if (synth) {
          ctx.drawImage(synth, px, py, cellPx, cellPx);
          continue;
        }
        const spec = catalogLookup.get(spriteKey);
        const raw = spec ? assetLoader.getRawSheetSprite(spec.sheet, spec.frame) : null;
        if (raw) {
          if (raw.height > raw.width && plainRaw) {
            ctx.drawImage(plainRaw, px, py, cellPx, cellPx);
          }
          ctx.drawImage(raw, px, py + cellPx - raw.height, raw.width, raw.height);
        } else if (plainRaw) {
          ctx.drawImage(plainRaw, px, py, cellPx, cellPx);
        }
      }
    }

    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    const key = `${sx}_${sy}`;
    if (sectorTextureCache.size >= 64) {
      const oldestKey = sectorTextureCache.keys().next().value;
      if (oldestKey) {
        const old = sectorTextureCache.get(oldestKey);
        if (old) gl.deleteTexture(old.tex);
        sectorTextureCache.delete(oldestKey);
      }
    }
    sectorTextureCache.set(key, { tex, rev });
    return tex;
  };

  return {
    id: 'tactical-sector-terrain-webgl',
    type: 'custom',
    renderingMode: '2d',
    onAdd(_map, gl) {
      const vsSource = `
        attribute vec2 a_pos;
        attribute vec2 a_uv;
        uniform mat4 u_matrix;
        uniform vec4 u_rect;
        varying vec2 v_uv;
        void main() {
          vec2 worldPos = vec2(u_rect.x + a_pos.x * u_rect.z, u_rect.y + a_pos.y * u_rect.w);
          gl_Position = u_matrix * vec4(worldPos, 0.0, 1.0);
          v_uv = a_uv;
        }
      `;
      const fsSource = `
        precision mediump float;
        uniform sampler2D u_tex;
        uniform float u_opacity;
        varying vec2 v_uv;
        void main() {
          vec4 c = texture2D(u_tex, v_uv);
          gl_FragColor = c * u_opacity;
        }
      `;
      const vs = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(vs, vsSource);
      gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(fs, fsSource);
      gl.compileShader(fs);
      program = gl.createProgram()!;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      aPosLoc = gl.getAttribLocation(program, 'a_pos');
      aUvLoc = gl.getAttribLocation(program, 'a_uv');
      uMatrixLoc = gl.getUniformLocation(program, 'u_matrix');
      uRectLoc = gl.getUniformLocation(program, 'u_rect');
      uOpacityLoc = gl.getUniformLocation(program, 'u_opacity');
      uTexLoc = gl.getUniformLocation(program, 'u_tex');

      posBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

      uvBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

      if (!terrainSheetsLoaded) {
        void Promise.all([
          assetLoader.loadSheet('neutral'),
          ...GBA_FACTION_SHEETS.map((f) => assetLoader.loadSheet(f.sheet)),
        ]).then(() => {
          terrainSheetsLoaded = true;
          ensureSyntheticCoastalCanvases16();
          mapInstance.triggerRepaint();
        });
      }
    },
    render(gl, options) {
      const z = mapInstance.getZoom();
      if (!terrainSheetsLoaded || !program || z < 14.45) return;

      const rev = spatialDeploymentService.getTerrainRevision();
      if (rev !== lastRev) {
        for (const entry of sectorTextureCache.values()) {
          gl.deleteTexture(entry.tex);
        }
        sectorTextureCache.clear();
        lastRev = rev;
      }

      const opacity = Math.min(1, Math.max(0, (z - 14.5) / 0.49));
      const range = computeViewportSectorRange(mapInstance, 14);
      const worldTiles = 32768; // 2^15 (ZOOM_TACTICO)

      if (typeof gl.bindVertexArray === 'function') {
        gl.bindVertexArray(null);
      }
      gl.useProgram(program);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
      gl.enableVertexAttribArray(aPosLoc);
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
      gl.enableVertexAttribArray(aUvLoc);
      gl.vertexAttribPointer(aUvLoc, 2, gl.FLOAT, false, 0, 0);

      const matrix = options.defaultProjectionData?.mainMatrix ?? options.modelViewProjectionMatrix;
      gl.uniformMatrix4fv(uMatrixLoc, false, matrix);
      gl.uniform1f(uOpacityLoc, opacity);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(uTexLoc, 0);

      for (let sy = range.minSY; sy <= range.maxSY; sy++) {
        for (let sx = range.minSX; sx <= range.maxSX; sx++) {
          const key = `${sx}_${sy}`;
          let entry = sectorTextureCache.get(key);
          if (!entry) {
            const tex = buildSectorTexture(gl, sx, sy, rev);
            if (!tex) continue;
            entry = { tex, rev };
          } else {
            sectorTextureCache.delete(key);
            sectorTextureCache.set(key, entry);
          }
          gl.bindTexture(gl.TEXTURE_2D, entry.tex);
          gl.uniform4f(uRectLoc, sx / worldTiles, sy / worldTiles, 1 / worldTiles, 1 / worldTiles);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }
    },
    onRemove(_map, gl) {
      for (const entry of sectorTextureCache.values()) {
        gl.deleteTexture(entry.tex);
      }
      sectorTextureCache.clear();
      if (program) gl.deleteProgram(program);
      if (posBuffer) gl.deleteBuffer(posBuffer);
      if (uvBuffer) gl.deleteBuffer(uvBuffer);
    },
  };
}

function registerTerrainTileSprites(map: MapLibreMap): void {
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

    // Síntesis GPU de bordes costeros GBA (N=1, E=2, S=4, W=8 + esquinas diagonales NE=16, SE=32, SW=64, NW=128) sobre sea.png
    const seaRaw = assetLoader.getRawSheetSprite('neutral', 'sea.png');
    const rimWidth = 6;
    const innerWidth = 3;
    const foamWidth = 2;
    const cornerSize = rimWidth + innerWidth; // 9px
    const foamCornerSize = cornerSize + foamWidth; // 11px
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

        // N=1 (top), E=2 (right), S=4 (bottom), W=8 (left), NE=16, SE=32, SW=64, NW=128
        // Línea de espuma interior (#93C5FD) -> sombra/acantilado (#8B6E3A) -> arena (#E8D59E)
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

    // Síntesis GPU de 15 bordes de arena (#E8D59E + #8B6E3A) sobre shoal.png
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

function resolveConnectedKey(
  prefix: 'road' | 'river',
  up: boolean,
  right: boolean,
  down: boolean,
  left: boolean
): string {
  if (up && down && left && right) return `tile_${prefix}-top-right-bottom-left`;
  if (up && right && down) return `tile_${prefix}-top-right-bottom`;
  if (up && down && left) return `tile_${prefix}-top-bottom-left`;
  if (up && right && left) return `tile_${prefix}-top-right-left`;
  if (right && down && left) return `tile_${prefix}-right-bottom-left`;
  if (up && right) return `tile_${prefix}-top-right`;
  if (up && left) return `tile_${prefix}-top-left`;
  if (down && right) return `tile_${prefix}-right-bottom`;
  if (down && left) return `tile_${prefix}-bottom-left`;
  if (up || down) return `tile_${prefix}-top-bottom`;
  return `tile_${prefix}-right-left`;
}

function getNeighborTerrainType(sx: number, sy: number, x: number, y: number): string {
  let targetSX = sx;
  let targetSY = sy;
  let targetX = x;
  let targetY = y;
  if (targetX < 0) {
    targetSX -= 1;
    targetX = TACTICAL_GRID_DIMENSION - 1;
  } else if (targetX >= TACTICAL_GRID_DIMENSION) {
    targetSX += 1;
    targetX = 0;
  }
  if (targetY < 0) {
    targetSY -= 1;
    targetY = TACTICAL_GRID_DIMENSION - 1;
  } else if (targetY >= TACTICAL_GRID_DIMENSION) {
    targetSY += 1;
    targetY = 0;
  }
  return spatialDeploymentService.resolveSectorCellTerrain([targetSX, targetSY], [targetX, targetY], TACTICAL_GRID_DIMENSION).type;
}

function resolveGbaTileSpriteKey(
  sx: number,
  sy: number,
  x: number,
  y: number,
  type: string,
  ownerId?: string | null
): string {
  if (type === 'road') {
    const isRoadConn = (t: string) => t === 'road' || t === 'bridge';
    const isBuilding = (t: string) =>
      t === 'city' ||
      t === 'factory' ||
      t === 'airport' ||
      t === 'port' ||
      t === 'hq' ||
      t === 'commtower' ||
      t === 'lab';
    const north = getNeighborTerrainType(sx, sy, x, y - 1);
    return resolveConnectedKey(
      'road',
      isRoadConn(north) || isBuilding(north),
      isRoadConn(getNeighborTerrainType(sx, sy, x + 1, y)),
      isRoadConn(getNeighborTerrainType(sx, sy, x, y + 1)),
      isRoadConn(getNeighborTerrainType(sx, sy, x - 1, y))
    );
  }
  if (type === 'river') {
    const isRiverConn = (t: string) => t === 'river' || t === 'bridge' || t === 'sea' || t === 'shoal';
    return resolveConnectedKey(
      'river',
      isRiverConn(getNeighborTerrainType(sx, sy, x, y - 1)),
      isRiverConn(getNeighborTerrainType(sx, sy, x + 1, y)),
      isRiverConn(getNeighborTerrainType(sx, sy, x, y + 1)),
      isRiverConn(getNeighborTerrainType(sx, sy, x - 1, y))
    );
  }
  if (type === 'bridge') {
    const l = getNeighborTerrainType(sx, sy, x - 1, y);
    const r = getNeighborTerrainType(sx, sy, x + 1, y);
    const isHoriz = l === 'road' || r === 'road' || l === 'city' || r === 'city';
    return isHoriz ? 'tile_bridge_h' : 'tile_bridge_v';
  }
  if (type === 'pipe') {
    const u = getNeighborTerrainType(sx, sy, x, y - 1) === 'pipe';
    const r = getNeighborTerrainType(sx, sy, x + 1, y) === 'pipe';
    const d = getNeighborTerrainType(sx, sy, x, y + 1) === 'pipe';
    const l = getNeighborTerrainType(sx, sy, x - 1, y) === 'pipe';
    if (u && d) return 'tile_pipe-top-bottom';
    if (l && r) return 'tile_pipe-right-left';
    if (u && r) return 'tile_pipe-top-right';
    if (u && l) return 'tile_pipe-top-left';
    if (r && d) return 'tile_pipe-right-bottom';
    if (d && l) return 'tile_pipe-bottom-left';
    if (u) return 'tile_pipe-bottom';
    if (r) return 'tile_pipe-left';
    if (d) return 'tile_pipe-top';
    if (l) return 'tile_pipe-right';
    return 'tile_pipe_h';
  }
  if (type in GBA_BUILDING_FRAME_MAP) {
    const factionKey =
      ownerId === 'p1' || ownerId === 'p2' || ownerId === 'p3' || ownerId === 'p4' || ownerId === 'p5'
        ? ownerId
        : type === 'hq'
        ? 'p2'
        : 'neutral';
    return `tile_${factionKey}_${type}`;
  }
  if (type === 'forest') {
    return ((sx * 31 + x * 17 + y * 13) & 3) === 0 ? 'tile_wood' : 'tile_forest';
  }
  if (type === 'mountain') return 'tile_mountain';
  if (type === 'sea') {
    const isLandBorder = (t: string) =>
      t !== 'sea' && t !== 'reef' && t !== 'shoal' && t !== 'river' && t !== 'bridge';
    let mask = 0;
    if (isLandBorder(getNeighborTerrainType(sx, sy, x, y - 1))) mask |= 1;
    if (isLandBorder(getNeighborTerrainType(sx, sy, x + 1, y))) mask |= 2;
    if (isLandBorder(getNeighborTerrainType(sx, sy, x, y + 1))) mask |= 4;
    if (isLandBorder(getNeighborTerrainType(sx, sy, x - 1, y))) mask |= 8;
    return mask > 0 ? `tile_sea_edge_${mask}` : 'tile_sea';
  }
  if (type === 'shoal') return 'tile_shoal';
  if (type === 'reef') return 'tile_reef';
  if (type === 'silo') return 'tile_silo';
  return ((sx * 29 + x * 11 + y * 7) & 3) === 0 ? 'tile_plain_alt' : 'tile_plains';
}

const sectorGeoJsonCache = new Map<string, GeoJSON.Feature[]>();
let cachedTerrainRevision = -1;

function resolveFastTileSpriteKey(
  sx: number,
  sy: number,
  x: number,
  y: number,
  center: any[][],
  north: any[][] | null,
  east: any[][] | null,
  south: any[][] | null,
  west: any[][] | null
): string {
  const tile = center[y][x];
  const type: string = tile.type;
  const getN = (nx: number, ny: number): string => {
    if (ny < 0) {
      if (nx < 0 || nx >= TACTICAL_GRID_DIMENSION) return type;
      return north ? north[TACTICAL_GRID_DIMENSION - 1][nx].type : 'plains';
    }
    if (ny >= TACTICAL_GRID_DIMENSION) {
      if (nx < 0 || nx >= TACTICAL_GRID_DIMENSION) return type;
      return south ? south[0][nx].type : 'plains';
    }
    if (nx < 0) return west ? west[ny][TACTICAL_GRID_DIMENSION - 1].type : 'plains';
    if (nx >= TACTICAL_GRID_DIMENSION) return east ? east[ny][0].type : 'plains';
    return center[ny][nx].type;
  };

  if (type === 'road') {
    const isRoadConn = (t: string) => t === 'road' || t === 'bridge';
    const isBuilding = (t: string) => t in GBA_BUILDING_FRAME_MAP;
    const n = getN(x, y - 1);
    return resolveConnectedKey(
      'road',
      isRoadConn(n) || isBuilding(n),
      isRoadConn(getN(x + 1, y)),
      isRoadConn(getN(x, y + 1)),
      isRoadConn(getN(x - 1, y))
    );
  }
  if (type === 'river') {
    const isRiverConn = (t: string) => t === 'river' || t === 'bridge' || t === 'sea' || t === 'shoal';
    return resolveConnectedKey(
      'river',
      isRiverConn(getN(x, y - 1)),
      isRiverConn(getN(x + 1, y)),
      isRiverConn(getN(x, y + 1)),
      isRiverConn(getN(x - 1, y))
    );
  }
  if (type === 'bridge') {
    const l = getN(x - 1, y);
    const r = getN(x + 1, y);
    return l === 'road' || r === 'road' || l === 'city' || r === 'city' ? 'tile_bridge_h' : 'tile_bridge_v';
  }
  if (type === 'pipe') {
    const isPipeConn = (t: string) => t === 'pipe' || t === 'pipeSeam';
    const u = isPipeConn(getN(x, y - 1));
    const r = isPipeConn(getN(x + 1, y));
    const d = isPipeConn(getN(x, y + 1));
    const l = isPipeConn(getN(x - 1, y));
    if (u && d) return 'tile_pipe-top-bottom';
    if (l && r) return 'tile_pipe-right-left';
    if (u && r) return 'tile_pipe-top-right';
    if (u && l) return 'tile_pipe-top-left';
    if (r && d) return 'tile_pipe-right-bottom';
    if (d && l) return 'tile_pipe-bottom-left';
    if (u) return 'tile_pipe-bottom';
    if (r) return 'tile_pipe-left';
    if (d) return 'tile_pipe-top';
    if (l) return 'tile_pipe-right';
    return 'tile_pipe_h';
  }
  if (type === 'pipeSeam') {
    const u = getN(x, y - 1);
    const d = getN(x, y + 1);
    return u === 'pipe' || d === 'pipe' ? 'tile_pipeSeam_v' : 'tile_pipeSeam_h';
  }
  if (type === 'rubble') {
    const l = getN(x - 1, y);
    const r = getN(x + 1, y);
    return l === 'pipe' || r === 'pipe' || l === 'pipeSeam' || r === 'pipeSeam'
      ? 'tile_rubble_h'
      : 'tile_rubble_v';
  }
  if (type in GBA_BUILDING_FRAME_MAP) {
    const ownerId = tile.ownerId;
    const factionKey =
      ownerId === 'p1' || ownerId === 'p2' || ownerId === 'p3' || ownerId === 'p4' || ownerId === 'p5'
        ? ownerId
        : type === 'hq'
        ? 'p2'
        : 'neutral';
    return `tile_${factionKey}_${type}`;
  }
  if (type === 'forest') return ((sx * 31 + x * 17 + y * 13) & 3) === 0 ? 'tile_wood' : 'tile_forest';
  if (type === 'mountain') return 'tile_mountain';
  if (type === 'sea') {
    const isLandBorder = (t: string) =>
      t !== 'sea' && t !== 'reef' && t !== 'shoal' && t !== 'river' && t !== 'bridge';
    let mask = 0;
    const hasN = isLandBorder(getN(x, y - 1));
    const hasE = isLandBorder(getN(x + 1, y));
    const hasS = isLandBorder(getN(x, y + 1));
    const hasW = isLandBorder(getN(x - 1, y));
    if (hasN) mask |= 1;
    if (hasE) mask |= 2;
    if (hasS) mask |= 4;
    if (hasW) mask |= 8;
    if (!hasN && !hasE && isLandBorder(getN(x + 1, y - 1))) mask |= 16;
    if (!hasS && !hasE && isLandBorder(getN(x + 1, y + 1))) mask |= 32;
    if (!hasS && !hasW && isLandBorder(getN(x - 1, y + 1))) mask |= 64;
    if (!hasN && !hasW && isLandBorder(getN(x - 1, y - 1))) mask |= 128;
    return mask > 0 ? `tile_sea_edge_${mask}` : 'tile_sea';
  }
  if (type === 'shoal') {
    const isLandBorder = (t: string) =>
      t !== 'sea' && t !== 'reef' && t !== 'shoal' && t !== 'river' && t !== 'bridge';
    let mask = 0;
    if (isLandBorder(getN(x, y - 1))) mask |= 1;
    if (isLandBorder(getN(x + 1, y))) mask |= 2;
    if (isLandBorder(getN(x, y + 1))) mask |= 4;
    if (isLandBorder(getN(x - 1, y))) mask |= 8;
    return mask > 0 ? `tile_shoal_edge_${mask}` : 'tile_shoal';
  }
  if (type === 'reef') return 'tile_reef';
  if (type === 'silo') return 'tile_silo';
  if (type === 'usedSilo') return 'tile_usedSilo';
  return ((sx * 29 + x * 11 + y * 7) & 3) === 0 ? 'tile_plain_alt' : 'tile_plains';
}

function buildViewportTerrainGeoJSON(range: {
  minSX: number;
  maxSX: number;
  minSY: number;
  maxSY: number;
}): GeoJSON.FeatureCollection {
  const rev = spatialDeploymentService.getTerrainRevision();
  if (rev !== cachedTerrainRevision) {
    sectorGeoJsonCache.clear();
    cachedTerrainRevision = rev;
  }

  const features: GeoJSON.Feature[] = [];

  for (let sy = range.minSY; sy <= range.maxSY; sy++) {
    for (let sx = range.minSX; sx <= range.maxSX; sx++) {
      const key = `${sx}_${sy}`;
      let sectorFeatures = sectorGeoJsonCache.get(key);
      if (!sectorFeatures) {
        sectorFeatures = [];
        const center = spatialDeploymentService.getSectorTerrainMatrix([sx, sy], TACTICAL_GRID_DIMENSION);
        const north = spatialDeploymentService.getSectorTerrainMatrix([sx, sy - 1], TACTICAL_GRID_DIMENSION);
        const east = spatialDeploymentService.getSectorTerrainMatrix([sx + 1, sy], TACTICAL_GRID_DIMENSION);
        const south = spatialDeploymentService.getSectorTerrainMatrix([sx, sy + 1], TACTICAL_GRID_DIMENSION);
        const west = spatialDeploymentService.getSectorTerrainMatrix([sx - 1, sy], TACTICAL_GRID_DIMENSION);

        // 1 solo polígono de respaldo por sector (0ms costo GPU, elimina cualquier micro-hueco)
        let waterCount = 0;
        const totalTiles = TACTICAL_GRID_DIMENSION * TACTICAL_GRID_DIMENSION;
        for (let ty = 0; ty < TACTICAL_GRID_DIMENSION; ty++) {
          for (let tx = 0; tx < TACTICAL_GRID_DIMENSION; tx++) {
            const t = center[ty][tx].type;
            if (t === 'sea' || t === 'reef' || t === 'shoal') waterCount++;
          }
        }
        const sectorFillColor = waterCount > totalTiles * 0.5 ? TERRAIN_FILL_COLORS.sea : '#5B7A2C';

        const snw = tileFractionToLngLat(sx, sy, ZOOM_TACTICO);
        const sne = tileFractionToLngLat(sx + 1, sy, ZOOM_TACTICO);
        const sse = tileFractionToLngLat(sx + 1, sy + 1, ZOOM_TACTICO);
        const ssw = tileFractionToLngLat(sx, sy + 1, ZOOM_TACTICO);
        sectorFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[snw, sne, sse, ssw, snw]],
          },
          properties: {
            kind: 'fill',
            fillColor: sectorFillColor,
          },
        });
        if (sectorGeoJsonCache.size >= 64) {
          const oldest = sectorGeoJsonCache.keys().next().value;
          if (oldest) sectorGeoJsonCache.delete(oldest);
        }
        sectorGeoJsonCache.set(key, sectorFeatures);
      }
      for (let i = 0; i < sectorFeatures.length; i++) {
        features.push(sectorFeatures[i]);
      }
    }
  }

  return { type: 'FeatureCollection', features };
}

function computeViewportSectorRange(
  map: MapLibreMap,
  maxSpan: number = 14
): {
  minSX: number;
  maxSX: number;
  minSY: number;
  maxSY: number;
} {
  const bounds = map.getBounds();
  const nw = lngLatToGridCoords(
    [bounds.getWest(), bounds.getNorth()],
    TACTICAL_GRID_DIMENSION,
    ZOOM_TACTICO
  );
  const se = lngLatToGridCoords(
    [bounds.getEast(), bounds.getSouth()],
    TACTICAL_GRID_DIMENSION,
    ZOOM_TACTICO
  );

  let minSX = Math.min(nw.sector[0], se.sector[0]) - 1;
  let maxSX = Math.max(nw.sector[0], se.sector[0]) + 1;
  let minSY = Math.min(nw.sector[1], se.sector[1]) - 1;
  let maxSY = Math.max(nw.sector[1], se.sector[1]) + 1;

  if (maxSX - minSX > maxSpan) {
    const centerSX = Math.floor((minSX + maxSX) / 2);
    const half = Math.floor(maxSpan / 2);
    minSX = centerSX - half;
    maxSX = minSX + maxSpan;
  }
  if (maxSY - minSY > maxSpan) {
    const centerSY = Math.floor((minSY + maxSY) / 2);
    const half = Math.floor(maxSpan / 2);
    minSY = centerSY - half;
    maxSY = minSY + maxSpan;
  }

  const maxTileIndex = Math.pow(2, ZOOM_TACTICO) - 1;
  minSX = Math.max(0, minSX);
  maxSX = Math.min(maxTileIndex, maxSX);
  minSY = Math.max(0, minSY);
  maxSY = Math.min(maxTileIndex, maxSY);

  return { minSX, maxSX, minSY, maxSY };
}

/**
 * Calcula un bloque macro fijo cuantizado al mundo (múltiplos de 64 sectores)
 * para que la cuadrícula municipal quede clavada en la geografía y no se mueva con la cámara.
 */
function computeFixedMacroBlockRange(map: MapLibreMap): {
  minSX: number;
  maxSX: number;
  minSY: number;
  maxSY: number;
} {
  const center = map.getCenter();
  const c = lngLatToGridCoords([center.lng, center.lat], TACTICAL_GRID_DIMENSION, ZOOM_TACTICO);
  const blockX = Math.floor(c.sector[0] / 64) * 64;
  const blockY = Math.floor(c.sector[1] / 64) * 64;
  const maxTileIndex = Math.pow(2, ZOOM_TACTICO) - 1;
  return {
    minSX: Math.max(0, blockX - 64),
    maxSX: Math.min(maxTileIndex, blockX + 128),
    minSY: Math.max(0, blockY - 64),
    maxSY: Math.min(maxTileIndex, blockY + 128),
  };
}

function buildViewportGridGeoJSON(
  map: MapLibreMap,
  range?: { minSX: number; maxSX: number; minSY: number; maxSY: number }
): TacticalGeoJSONCollection<TacticalLineStringGeometry, { isSectorBorder: boolean }> {
  const z = map.getZoom();
  if (z < 10.0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const isMacroMode = z < ZOOM_TACTICO - 1.0; // 10.0..13.99: cada sector 20x20 es 1 cuadro fijo en el mundo
  const effectiveRange = range ?? (isMacroMode ? computeFixedMacroBlockRange(map) : computeViewportSectorRange(map, 14));
  const { minSX, maxSX, minSY, maxSY } = effectiveRange;

  const minTileX = minSX;
  const maxTileX = maxSX + 1;
  const minTileY = minSY;
  const maxTileY = maxSY + 1;

  const features: TacticalGeoJSONFeature<TacticalLineStringGeometry, { isSectorBorder: boolean }>[] = [];

  if (isMacroMode) {
    for (let sx = minTileX; sx <= maxTileX; sx++) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            tileFractionToLngLat(sx, minTileY, ZOOM_TACTICO),
            tileFractionToLngLat(sx, maxTileY, ZOOM_TACTICO),
          ],
        },
        properties: { isSectorBorder: true },
      });
    }
    for (let sy = minTileY; sy <= maxTileY; sy++) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            tileFractionToLngLat(minTileX, sy, ZOOM_TACTICO),
            tileFractionToLngLat(maxTileX, sy, ZOOM_TACTICO),
          ],
        },
        properties: { isSectorBorder: true },
      });
    }
    return { type: 'FeatureCollection', features };
  }

  const startCol = minSX * TACTICAL_GRID_DIMENSION;
  const endCol = (maxSX + 1) * TACTICAL_GRID_DIMENSION;
  const startRow = minSY * TACTICAL_GRID_DIMENSION;
  const endRow = (maxSY + 1) * TACTICAL_GRID_DIMENSION;

  for (let col = startCol; col <= endCol; col++) {
    const tileX = col / TACTICAL_GRID_DIMENSION;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          tileFractionToLngLat(tileX, minTileY, ZOOM_TACTICO),
          tileFractionToLngLat(tileX, maxTileY, ZOOM_TACTICO),
        ],
      },
      properties: {
        isSectorBorder: col % TACTICAL_GRID_DIMENSION === 0,
      },
    });
  }

  for (let row = startRow; row <= endRow; row++) {
    const tileY = row / TACTICAL_GRID_DIMENSION;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          tileFractionToLngLat(minTileX, tileY, ZOOM_TACTICO),
          tileFractionToLngLat(maxTileX, tileY, ZOOM_TACTICO),
        ],
      },
      properties: {
        isSectorBorder: row % TACTICAL_GRID_DIMENSION === 0,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}

function buildCellPolygonFeature(
  sector: [number, number],
  cell: [number, number],
  kind: 'hover' | 'selected'
): TacticalGeoJSONFeature<TacticalPolygonGeometry, { kind: 'hover' | 'selected' }> {
  const x0 = sector[0] + cell[0] / TACTICAL_GRID_DIMENSION;
  const x1 = sector[0] + (cell[0] + 1) / TACTICAL_GRID_DIMENSION;
  const y0 = sector[1] + cell[1] / TACTICAL_GRID_DIMENSION;
  const y1 = sector[1] + (cell[1] + 1) / TACTICAL_GRID_DIMENSION;

  const nw = tileFractionToLngLat(x0, y0, ZOOM_TACTICO);
  const ne = tileFractionToLngLat(x1, y0, ZOOM_TACTICO);
  const se = tileFractionToLngLat(x1, y1, ZOOM_TACTICO);
  const sw = tileFractionToLngLat(x0, y1, ZOOM_TACTICO);

  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[nw, ne, se, sw, nw]],
    },
    properties: { kind },
  };
}

function resolveMunicipalityIdFromFeature(feat: any): string | null {
  if (!feat) return null;
  const munId =
    feat?.properties?.municipalityId ||
    (feat?.layer?.id === 'zulia-municipalities-fill' ? feat?.properties?.id : null);
  return munId ? String(munId) : null;
}

/**
 * ESTILO VECTORIAL ZERO-RASTER C4ISR (CONFORME A @tactical-command-intel)
 * - 0% Peticiones HTTP de teselas raster externas (CartoDB erradicado).
 * - Cero API Keys. Cero coste de ancho de banda o límites de peticiones.
 * - Fondo de búnker ciego (#12130E) + Chasis blindado continental (#23241C / #46521F).
 */
const ZERO_RASTER_MILITARY_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    'world-land': {
      type: 'geojson',
      data: '/map/world_land.json',
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#0E100C', // --color-bunker-void (profundidad oceánica de búnker)
      },
    },
    {
      id: 'world-land-mass',
      type: 'fill',
      source: 'world-land',
      paint: {
        'fill-color': '#1C1E17', // --color-armor-base secundario (Colombia, Brasil, Caribe)
        'fill-opacity': 0.95,
      },
    },
    {
      id: 'world-land-border',
      type: 'line',
      source: 'world-land',
      maxzoom: 7.5,
      layout: {
        'line-join': 'round',
        'line-cap': 'round',
      },
      paint: {
        'line-color': '#46521F', // --color-military-olive (bisel militar exterior)
        'line-width': 1.2,
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 0.65, 7.5, 0],
      },
    },
  ],
};

export const TacticalWorldMap: React.FC<TacticalWorldMapProps> = ({
  userClanId = 'clan-ferro',
  activeProvinceId = null,
  activeBattleUnits = [],
  fogOfWarBase64 = null,
  onSelectCountry,
  onSelectProvince,
  onSelectMunicipality,
  onSelectTacticalCell,
  onZoomChange,
  hideLegacyMicroDeck = false,
  externalDeployTrigger = 0,
  externalBuildTrigger = 0,
  className = '',
}) => {
  void fogOfWarBase64;
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<MapLibreMap | null>(null);
  const isStandbyRef = useRef<boolean>(false);
  const inactivityTimerRef = useRef<number | null>(null);
  const lastGridKeyRef = useRef<string>('empty');
  const lastTerrainKeyRef = useRef<string>('empty');
  const rtsAnchorSectorRef = useRef<[number, number] | null>(
    lngLatToGridCoords([-71.455, 10.395], TACTICAL_GRID_DIMENSION, ZOOM_TACTICO).sector
  );

  // Stable refs para desacoplar el ciclo de vida del mapa WebGL y evitar parpadeos
  const onSelectCountryRef = useRef(onSelectCountry);
  onSelectCountryRef.current = onSelectCountry;

  const onSelectProvinceRef = useRef(onSelectProvince);
  onSelectProvinceRef.current = onSelectProvince;

  const onSelectMunicipalityRef = useRef(onSelectMunicipality);
  onSelectMunicipalityRef.current = onSelectMunicipality;

  const onSelectTacticalCellRef = useRef(onSelectTacticalCell);
  onSelectTacticalCellRef.current = onSelectTacticalCell;

  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const [currentZoom, setCurrentZoom] = useState<number>(ZOOM_GLOBAL);
  const [hoveredProvinceId] = useState<string | null>(null);
  const [hoveredCellGlobal, setHoveredCellGlobal] = useState<{
    sector: [number, number];
    cell: [number, number];
  } | null>(null);
  const [selectedMunicipalityId, setSelectedMunicipalityId] = useState<string | null>(null);
  const selectedMunicipalityIdRef = useRef<string | null>(null);
  selectedMunicipalityIdRef.current = selectedMunicipalityId;

  const [isStandbyUI, setIsStandbyUI] = useState<boolean>(false);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Estados de Microjuego Táctico y Asignación Espacial (Sprint 3: Zoom x15)
  const [selectedMicroCoords, setSelectedMicroCoords] = useState<{
    sector: [number, number];
    cell: [number, number];
    lngLat: [number, number];
  } | null>(null);
  const [isDeployModalOpen, setIsDeployModalOpen] = useState(false);
  const [isBuildDrawerOpen, setIsBuildDrawerOpen] = useState(false);

  const hoveredCellGlobalRef = useRef(hoveredCellGlobal);
  hoveredCellGlobalRef.current = hoveredCellGlobal;

  const selectedMicroCoordsRef = useRef(selectedMicroCoords);
  selectedMicroCoordsRef.current = selectedMicroCoords;

  // Motor RTS Continuo de Celda (10 ticks/s) y Selección de Unidades
  const rtsEngineRef = useRef<TacticalRtsEngine>(new TacticalRtsEngine({ tickIntervalMs: 100 }));
  const [selectedTacticalUnitId, setSelectedTacticalUnitId] = useState<string | null>(null);
  const selectedTacticalUnitIdRef = useRef<string | null>(null);
  selectedTacticalUnitIdRef.current = selectedTacticalUnitId;

  const [baseRegionsGeoJSON, setBaseRegionsGeoJSON] = useState<any>(null);

  useEffect(() => {
    let isSubscribed = true;
    fetch('/map/theatre_regions.json')
      .then((res) => res.json())
      .then((data) => {
        if (isSubscribed) setBaseRegionsGeoJSON(data);
      })
      .catch((err) => {
        console.warn('[TacticalWorldMap] No se pudo cargar theatre_regions.json local:', err);
      });
    return () => {
      isSubscribed = false;
    };
  }, []);

  useEffect(() => {
    if (!baseRegionsGeoJSON) return;
    const registerFn =
      (worldDomain as { registerLandPolygons?: (fc: unknown) => void }).registerLandPolygons ??
      (spatialDeploymentService as unknown as { registerLandPolygons?: (fc: unknown) => void })
        .registerLandPolygons;
    if (typeof registerFn !== 'function') return;

    try {
      registerFn(baseRegionsGeoJSON);
      lastTerrainKeyRef.current = 'dirty';
      const map = mapInstanceRef.current;
      if (map && map.isStyleLoaded() && map.getSource('tactical-sector-terrain')) {
        syncViewportGridRef.current?.(map);
      }
    } catch (err) {
      console.warn('[TacticalWorldMap] Error registrando polígonos de tierra:', err);
    }
  }, [baseRegionsGeoJSON]);

  const [sovereignVersion, setSovereignVersion] = useState(0);

  useEffect(() => {
    const unsub = stateSovereigntyService.subscribe(() => {
      setSovereignVersion((v) => v + 1);
    });
    return () => unsub();
  }, []);

  const { provinces, controlMap, clansMap } = useTerritoryMap(userClanId);

  const controlMapRef = useRef(controlMap);
  controlMapRef.current = controlMap;

  // Estados de micro-física y screen shake cinético
  const [isScreenShaking, setIsScreenShaking] = useState<boolean>(false);
  const shakeTimeoutRef = useRef<number | null>(null);

  const triggerScreenShake = useCallback(() => {
    setIsScreenShaking(true);
    try {
      audioManager.playSFX('explosion');
    } catch {}
    if (shakeTimeoutRef.current) window.clearTimeout(shakeTimeoutRef.current);
    shakeTimeoutRef.current = window.setTimeout(() => {
      setIsScreenShaking(false);
    }, 190);
  }, []);

  const triggerScreenShakeRef = useRef(triggerScreenShake);
  triggerScreenShakeRef.current = triggerScreenShake;

  // Estrato de zoom y cinemática de transición con micro-desenfoque
  const getStratumForZoom = (z: number): 1 | 2 | 3 => {
    if (z < ZOOM_OPERACIONAL) return 1;
    if (z < ZOOM_TACTICO) return 2;
    return 3;
  };

  const prevStratumRef = useRef<1 | 2 | 3>(getStratumForZoom(ZOOM_GLOBAL));
  const [isStratumTransitioning, setIsStratumTransitioning] = useState<boolean>(false);
  const stratumTimeoutRef = useRef<number | null>(null);
  const [currentStratum, setCurrentStratum] = useState<1 | 2 | 3>(getStratumForZoom(ZOOM_GLOBAL));

  const handleZoomTransition = useCallback((z: number) => {
    const rounded = Number(z.toFixed(2));
    setCurrentZoom(rounded);
    onZoomChangeRef.current?.(rounded);
    const nextStratum = getStratumForZoom(rounded);
    if (prevStratumRef.current !== nextStratum) {
      prevStratumRef.current = nextStratum;
      setCurrentStratum(nextStratum);
      setIsStratumTransitioning(true);
      if (stratumTimeoutRef.current) window.clearTimeout(stratumTimeoutRef.current);
      stratumTimeoutRef.current = window.setTimeout(() => {
        setIsStratumTransitioning(false);
      }, 260);
    }
  }, []);

  const handleZoomTransitionRef = useRef(handleZoomTransition);
  handleZoomTransitionRef.current = handleZoomTransition;

  useEffect(() => {
    const handleCustomShake = () => {
      triggerScreenShake();
    };

    window.addEventListener('tactical-screen-shake', handleCustomShake);

    if (typeof window !== 'undefined') {
      (window as any).__TRIGGER_TACTICAL_SHAKE__ = triggerScreenShake;
    }

    return () => {
      window.removeEventListener('tactical-screen-shake', handleCustomShake);
      if (shakeTimeoutRef.current) window.clearTimeout(shakeTimeoutRef.current);
      if (stratumTimeoutRef.current) window.clearTimeout(stratumTimeoutRef.current);
    };
  }, [triggerScreenShake]);

  // Selector cromático de facción conforme a @tactical-command-intel
  const resolveFactionColor = useCallback((
    controllingClanId?: string | null,
    isBuffer?: boolean,
    isUnderSiege?: boolean,
    fallbackClanColor?: string
  ): string => {
    if (isUnderSiege) return '#EF4444'; // Alerta DEFCON 1 / Asedio balístico
    if (isBuffer) return '#2B2C24';     // --color-armor-base neutro
    if (controllingClanId === 'clan-ferro') return '#1D4ED8';   // Blue Moon: Azul Mando Asedio
    if (controllingClanId === 'clan-orinoco') return '#E65100'; // Orange Star: Naranja Petroquímico
    if (controllingClanId === 'clan-andes') return '#991B1B';   // Black Hole: Carmesí Hostil
    return fallbackClanColor || '#2B2C24';
  }, []);

  const pruneCivilianLayers = useCallback((map: MapLibreMap) => {
    const style = map.getStyle();
    if (!style || !style.layers) return;
    for (const layer of style.layers) {
      if (C4ISR_HIDE_LAYERS_REGEX.test(layer.id)) {
        map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
    }
  }, []);

  const syncViewportGrid = useCallback((map: MapLibreMap) => {
    const src = map.getSource('tactical-viewport-grid') as GeoJSONSource | undefined;
    const terrainSrc = map.getSource('tactical-sector-terrain') as GeoJSONSource | undefined;
    const z = map.getZoom();

    if (z < 10.0) {
      if (src && lastGridKeyRef.current !== 'empty') {
        src.setData({ type: 'FeatureCollection', features: [] });
        lastGridKeyRef.current = 'empty';
      }
      if (terrainSrc && lastTerrainKeyRef.current !== 'empty') {
        terrainSrc.setData({ type: 'FeatureCollection', features: [] });
        lastTerrainKeyRef.current = 'empty';
      }
      return;
    }

    const isMacroMode = z < ZOOM_TACTICO - 1.0;
    const range = isMacroMode ? computeFixedMacroBlockRange(map) : computeViewportSectorRange(map, 14);
    const gridKey = `${isMacroMode ? 'M' : 'T'}:${range.minSX}:${range.maxSX}:${range.minSY}:${range.maxSY}`;
    if (src && lastGridKeyRef.current !== gridKey) {
      lastGridKeyRef.current = gridKey;
      src.setData(buildViewportGridGeoJSON(map, range));
    }

    if (z < 14.45) {
      if (terrainSrc && lastTerrainKeyRef.current !== 'empty') {
        terrainSrc.setData({ type: 'FeatureCollection', features: [] });
        lastTerrainKeyRef.current = 'empty';
      }
      return;
    }

    const terrainKey = `${range.minSX}:${range.maxSX}:${range.minSY}:${range.maxSY}:rev${spatialDeploymentService.getTerrainRevision()}`;
    if (terrainSrc && lastTerrainKeyRef.current !== terrainKey) {
      lastTerrainKeyRef.current = terrainKey;
      terrainSrc.setData(buildViewportTerrainGeoJSON(range));
    }
  }, []);

  const syncViewportGridRef = useRef(syncViewportGrid);
  syncViewportGridRef.current = syncViewportGrid;

  const syncHoverGrid = useCallback((map: MapLibreMap) => {
    const hoverSrc = map.getSource('tactical-viewport-grid-hover') as GeoJSONSource | undefined;
    if (!hoverSrc) return;

    if (map.getZoom() < ZOOM_TACTICO - 1.0) {
      hoverSrc.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const features: TacticalGeoJSONFeature<TacticalPolygonGeometry, { kind: 'hover' | 'selected' }>[] = [];
    const sel = selectedMicroCoordsRef.current;
    const hov = hoveredCellGlobalRef.current;

    if (sel) {
      features.push(buildCellPolygonFeature(sel.sector, sel.cell, 'selected'));
    }

    if (
      hov &&
      (!sel ||
        sel.sector[0] !== hov.sector[0] ||
        sel.sector[1] !== hov.sector[1] ||
        sel.cell[0] !== hov.cell[0] ||
        sel.cell[1] !== hov.cell[1])
    ) {
      features.push(buildCellPolygonFeature(hov.sector, hov.cell, 'hover'));
    }

    hoverSrc.setData({ type: 'FeatureCollection', features });
  }, []);

  const syncHoverGridRef = useRef(syncHoverGrid);
  syncHoverGridRef.current = syncHoverGrid;

  const syncRtsUnitsToMap = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const src = map.getSource('tactical-rts-units') as GeoJSONSource | undefined;
    if (!src) return;

    if (map.getZoom() < ZOOM_TACTICO - 1.0) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    if (!rtsAnchorSectorRef.current) {
      const center = map.getCenter();
      rtsAnchorSectorRef.current = lngLatToGridCoords(
        [center.lng, center.lat],
        TACTICAL_GRID_DIMENSION,
        ZOOM_TACTICO
      ).sector;
    }

    const anchorSector = rtsAnchorSectorRef.current;
    const units = rtsEngineRef.current.getAllUnits() as unknown as RtsUnitView[];

    const features: TacticalGeoJSONFeature<
      TacticalPointGeometry,
      { id: string; code: string; spriteKey: string; hp: number; isAlly: boolean; isSelected: boolean }
    >[] = units
      .filter(
        (u) =>
          !u.isDestroyed &&
          u.x >= 0 &&
          u.x < TACTICAL_GRID_DIMENSION &&
          u.y >= 0 &&
          u.y < TACTICAL_GRID_DIMENSION
      )
      .map((u) => {
        const unitOwner = u.ownerId || u.owner;
        const isAlly = unitOwner === (userClanId || 'clan-ferro');
        return {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: gridCoordsToLngLat(anchorSector, [u.x, u.y], TACTICAL_GRID_DIMENSION, ZOOM_TACTICO),
          },
          properties: {
            id: u.id,
            code: String(u.unitCode || 'UNT').slice(0, 8).toUpperCase(),
            spriteKey: resolveUnitSpriteKey(u.unitCode || 'tank_light'),
            hp: u.hp ?? 100,
            isAlly,
            isSelected: u.id === selectedTacticalUnitIdRef.current,
          },
        };
      });

    src.setData({ type: 'FeatureCollection', features });
  }, [userClanId]);

  const syncRtsUnitsToMapRef = useRef(syncRtsUnitsToMap);
  syncRtsUnitsToMapRef.current = syncRtsUnitsToMap;

  const provincesGeoJSON = useMemo<any>(() => {
    // Si tenemos las geometrías oficiales reales (/map/theatre_regions.json), las usamos directamente
    if (baseRegionsGeoJSON && Array.isArray(baseRegionsGeoJSON.features) && baseRegionsGeoJSON.features.length > 0) {
      const features = baseRegionsGeoJSON.features.map((feat: any) => {
        const provId = feat.id || feat.properties?.id;
        const ctrl = controlMap[provId];
        const clan = ctrl?.controllingClanId ? clansMap[ctrl.controllingClanId] : null;
        const isBuffer = String(provId).startsWith('BUF_');
        const isUnderSiege = ctrl?.status === 'under_siege';
        const isSelected = provId === activeProvinceId;
        const ownerColor = resolveFactionColor(
          ctrl?.controllingClanId,
          isBuffer,
          isUnderSiege,
          clan?.color
        );
        const sov = stateSovereigntyService.getState(String(provId));

        return {
          ...feat,
          id: provId,
          properties: {
            ...feat.properties,
            id: provId,
            name: sov?.customStateName || feat.properties?.name || provId,
            countryName: sov?.customCountryName || 'República Soberana de Venezuela',
            controllingFaction: sov?.controllingFactionId || 'blue_moon',
            ownerColor,
            isBuffer,
            isCapital: provId === 'REG_VE_01',
            isUnderSiege,
            isVulnerableActive: Boolean(isUnderSiege || (ctrl as any)?.isVulnerableActive),
            isSelected,
            tcp: sov?.tcpCurrent ?? (ctrl?.currentTcp ?? 10000),
            tcpMax: sov?.tcpMax ?? (ctrl?.tcpThreshold ?? 10000),
          },
        };
      });

      return { type: 'FeatureCollection', features };
    }

    // Fallback proyectado referencial mientras descarga el GeoJSON
    const features: any[] = provinces.map((prov) => {
      const ctrl = controlMap[prov.id];
      const clan = ctrl?.controllingClanId ? clansMap[ctrl.controllingClanId] : null;
      const isBuffer = prov.id.startsWith('BUF_');
      const isUnderSiege = ctrl?.status === 'under_siege';
      const ownerColor = resolveFactionColor(
        ctrl?.controllingClanId,
        isBuffer,
        isUnderSiege,
        clan?.color
      );
      const sov = stateSovereigntyService.getState(prov.id);

      // Proyección referencial sobre el teatro venezolano y caribeño
      const lngCenter = (prov.posX - 50) * 0.28 - 66.5;
      const latCenter = (50 - prov.posY) * 0.16 + 7.8;
      const halfW = (prov.width * 0.11) / 2;
      const halfH = (prov.height * 0.09) / 2;

      return {
        type: 'Feature',
        id: prov.id,
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [lngCenter - halfW, latCenter + halfH],
              [lngCenter + halfW, latCenter + halfH],
              [lngCenter + halfW, latCenter - halfH],
              [lngCenter - halfW, latCenter - halfH],
              [lngCenter - halfW, latCenter + halfH],
            ],
          ],
        },
        properties: {
          id: prov.id,
          name: sov?.customStateName || prov.name,
          countryName: sov?.customCountryName || 'República Soberana de Venezuela',
          controllingFaction: sov?.controllingFactionId || 'blue_moon',
          ownerColor,
          isBuffer,
          isCapital: prov.isCapital,
          isUnderSiege,
          isVulnerableActive: Boolean(isUnderSiege || (ctrl as any)?.isVulnerableActive),
          tcp: sov?.tcpCurrent ?? (ctrl?.currentTcp ?? 10000),
          tcpMax: sov?.tcpMax ?? (ctrl?.tcpThreshold ?? 10000),
          isSelected: prov.id === activeProvinceId,
          isHovered: prov.id === hoveredProvinceId,
        },
      };
    });

    return { type: 'FeatureCollection', features };
  }, [baseRegionsGeoJSON, provinces, controlMap, clansMap, activeProvinceId, hoveredProvinceId, resolveFactionColor, sovereignVersion]);

  const provincesGeoJSONRef = useRef(provincesGeoJSON);
  provincesGeoJSONRef.current = provincesGeoJSON;

  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;
    let isMounted = true;

    const enterStandby = () => {
      if (isStandbyRef.current) return;
      isStandbyRef.current = true;
      setIsStandbyUI(true);
    };

    const wakeFromStandby = () => {
      if (inactivityTimerRef.current !== null) {
        window.clearTimeout(inactivityTimerRef.current);
      }
      inactivityTimerRef.current = window.setTimeout(enterStandby, ACTIVITY_TIMEOUT_MS);

      if (!isStandbyRef.current) return;
      isStandbyRef.current = false;
      setIsStandbyUI(false);
      mapInstanceRef.current?.triggerRepaint();
    };

    const initMapEngine = async () => {
      try {
        const maplibreMod = await import('maplibre-gl');
        const maplibregl = (maplibreMod as any).default || maplibreMod;
        if (!isMounted || !mapContainerRef.current) return;

        if (typeof maplibregl.supported === 'function' && !maplibregl.supported()) {
          setWebglError('El acelerador gráfico o navegador no soporta WebGL 2.0.');
          return;
        }

        const setWorker = (maplibregl as any).setWorkerUrl || (maplibreMod as any).setWorkerUrl;
        if (typeof setWorker === 'function') {
          setWorker('/maplibre-gl-worker.mjs');
        }

        // Registrar protocolo local en memoria tactical-sector:// (0 peticiones HTTP externas)
        if (typeof (maplibregl as any).addProtocol === 'function') {
          try {
            (maplibregl as any).addProtocol('tactical-sector', async (params: { url: string }) => {
              const parts = params.url.replace('tactical-sector://', '').split('?')[0].split('/');
              const sx = Number(parts[1] ?? 9880);
              const sy = Number(parts[2] ?? 15432);
              const matrix = spatialDeploymentService.getSectorTerrainMatrix([sx, sy], TACTICAL_GRID_DIMENSION);
              const encoder = new TextEncoder();
              return { data: encoder.encode(JSON.stringify({ sector: [sx, sy], matrix })).buffer };
            });
          } catch {
            // Ya registrado en sesión previa
          }
        }

        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: ZERO_RASTER_MILITARY_STYLE,
          center: [-71.455, 10.395], // Epicentro Operacional Inicial: Teatro Cabimas (Zulia)
          zoom: 9.8,
          minZoom: 2.0,
          maxZoom: TACTICAL_SPRITE_MAX_ZOOM,
          doubleClickZoom: false,
          attributionControl: false,
        });

        map.on('zoom', () => {
          if (!isMounted) return;
          const z = map.getZoom();
          handleZoomTransitionRef.current?.(z);
          if (z < ZOOM_TACTICO - 1.0) {
            setHoveredCellGlobal(null);
          }
          syncViewportGridRef.current?.(map);
        });

        map.on('move', () => {
          if (!isMounted) return;
          syncViewportGridRef.current?.(map);
        });

        map.on('moveend', () => {
          if (!isMounted) return;
          syncViewportGridRef.current?.(map);
        });

        map.on('resize', () => {
          if (!isMounted) return;
          syncViewportGridRef.current?.(map);
        });

        if (typeof window !== 'undefined') {
          (window as any).__TACTICAL_MAP_INSTANCE__ = map;
          (window as any).__SET_TACTICAL_ZOOM__ = (z: number) => {
            try { map.setZoom(z); } catch {}
            if (isMounted) {
              handleZoomTransitionRef.current?.(z);
              if (z < ZOOM_TACTICO - 1.0) {
                setHoveredCellGlobal(null);
              }
              syncViewportGridRef.current?.(map);
            }
          };
        }

        map.on('load', () => {
          if (!isMounted) return;
          pruneCivilianLayers(map);
          handleZoomTransitionRef.current?.(map.getZoom());

          // 1. Fuentes GeoJSON de Provincias, Malla de Fronteras Deduplicadas y Municipios (tolerance: 0, buffer: 64)
          map.addSource('tactical-provinces', {
            type: 'geojson',
            data: provincesGeoJSONRef.current,
            tolerance: 0,
            buffer: 64,
          });

          map.addSource('tactical-borders-mesh', {
            type: 'geojson',
            data: '/map/theatre_borders_mesh.json',
            tolerance: 0,
            buffer: 64,
          });

          map.addSource('zulia-municipalities', {
            type: 'geojson',
            data: '/map/zulia_municipalities.json',
            tolerance: 0,
            buffer: 64,
          });

          // 1A. Relleno de Provincias Soberanas (theatre_regions.json)
          map.addLayer({
            id: 'provinces-fill',
            type: 'fill',
            source: 'tactical-provinces',
            maxzoom: ZOOM_TACTICO - 0.5,
            paint: {
              'fill-color': ['get', 'ownerColor'],
              'fill-opacity': [
                'case',
                ['boolean', ['get', 'isSelected'], false],
                0.56,
                ['boolean', ['get', 'isUnderSiege'], false],
                0.48,
                0.34,
              ],
            },
          });

          // 1B. Relleno de Municipios del Zulia (Estrato 2: 8.5 <= zoom < ZOOM_TACTICO - 0.5)
          map.addLayer({
            id: 'zulia-municipalities-fill',
            type: 'fill',
            source: 'zulia-municipalities',
            minzoom: 8.5,
            maxzoom: ZOOM_TACTICO - 0.5,
            paint: {
              'fill-color': [
                'case',
                ['==', ['get', 'id'], selectedMunicipalityIdRef.current || ''],
                '#F59E0B',
                '#46521F',
              ],
              'fill-opacity': [
                'case',
                ['==', ['get', 'id'], selectedMunicipalityIdRef.current || ''],
                0.34,
                0.04,
              ],
            },
          });

          // 1C. Malla de Fronteras Deduplicadas en GPU (theatre_borders_mesh.json)
          map.addLayer({
            id: 'tactical-borders-mesh',
            type: 'line',
            source: 'tactical-borders-mesh',
            maxzoom: ZOOM_TACTICO - 0.5,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': '#7B8A4A',
              'line-width': ['interpolate', ['linear'], ['zoom'], 3.5, 1.2, 10, 1.5],
              'line-opacity': 0.95,
            },
          });

          // 1D. Contorno de Municipios del Zulia (Estrato 2: 8.5 <= zoom < ZOOM_TACTICO - 0.5)
          map.addLayer({
            id: 'zulia-municipalities-border',
            type: 'line',
            source: 'zulia-municipalities',
            minzoom: 8.5,
            maxzoom: ZOOM_TACTICO - 0.5,
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': [
                'case',
                ['==', ['get', 'id'], selectedMunicipalityIdRef.current || ''],
                '#FACC15',
                '#94A3B8',
              ],
              'line-width': [
                'case',
                ['==', ['get', 'id'], selectedMunicipalityIdRef.current || ''],
                3.2,
                1.2,
              ],
              'line-opacity': [
                'case',
                ['==', ['get', 'id'], selectedMunicipalityIdRef.current || ''],
                0.95,
                0.42,
              ],
            },
          });

          // 1E. Resaltado exclusivo de provincias seleccionadas o bajo asedio
          map.addLayer({
            id: 'provinces-borders',
            type: 'line',
            source: 'tactical-provinces',
            maxzoom: ZOOM_TACTICO - 0.5,
            filter: ['any', ['boolean', ['get', 'isSelected'], false], ['boolean', ['get', 'isUnderSiege'], false]],
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': [
                'case',
                ['boolean', ['get', 'isSelected'], false],
                '#00FF66', // Verde Fósforo CRT Radar al seleccionar
                '#EF4444', // Borde rojo DEFCON 1 en asedio
              ],
              'line-width': [
                'case',
                ['boolean', ['get', 'isSelected'], false],
                3.2,
                2.2,
              ],
              'line-opacity': 0.95,
            },
          });

          // 1F. Halo pulsante ámbar para regiones en estado de vulnerabilidad activa (Anti-Offline Raiding)
          map.addLayer({
            id: 'provinces-vulnerable-halo',
            type: 'line',
            source: 'tactical-provinces',
            maxzoom: ZOOM_TACTICO - 0.5,
            filter: ['==', ['get', 'isVulnerableActive'], true],
            layout: {
              'line-join': 'round',
              'line-cap': 'round',
            },
            paint: {
              'line-color': '#F59E0B',
              'line-width': 4.5,
              'line-opacity': 0.85,
              'line-blur': 3.0,
            },
          });

          // 2. Capa de Red Vial Troncal Real de Venezuela (theatre_roads.json)
          map.addSource('tactical-roads', {
            type: 'geojson',
            data: '/map/theatre_roads.json',
          });

          // Capa 2A: Sombra de Tinta Cómic (#0A0B08)
          map.addLayer({
            id: 'roads-ink-shadow',
            type: 'line',
            source: 'tactical-roads',
            paint: {
              'line-color': '#0A0B08',
              'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.8, 8, 4.2, 14, 7.0],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0.78, 14.5, 0.0],
            },
          });

          // Capa 2B: Resplandor Naranja/Ámbar C4ISR
          map.addLayer({
            id: 'roads-glow',
            type: 'line',
            source: 'tactical-roads',
            paint: {
              'line-color': '#D97706',
              'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.4, 8, 3.6, 14, 6.0],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0.30, 14.5, 0.0],
              'line-blur': 2.0,
            },
          });

          // Capa 2C: Núcleo de Carretera Principal (desaturado y atenuado al entrar a Zoom Táctico)
          map.addLayer({
            id: 'roads-core',
            type: 'line',
            source: 'tactical-roads',
            paint: {
              'line-color': [
                'match',
                ['get', 'highway'],
                'motorway', '#D97706',
                '#B45309',
              ],
              'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 8, 1.8, 14, 3.2],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0.85, 14.5, 0.0],
            },
          });

          // (Eliminadas capas urban-roads-* de theatre_urban_roads.json que generaban líneas naranjas sueltas sobre el mapa táctico)

          // 5. Capa de Nombres de Ciudades y Cabeceras Reales (theatre_cities.json - 8.5 <= zoom < 15.0)
          map.addSource('tactical-cities', {
            type: 'geojson',
            data: '/map/theatre_cities.json',
          });

          // 5A: Marcador Radar de Ciudad
          map.addLayer({
            id: 'cities-glow',
            type: 'circle',
            source: 'tactical-cities',
            minzoom: 8.5,
            maxzoom: 15.0,
            paint: {
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 8.5, 6, 14, 12],
              'circle-color': [
                'case',
                ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], selectedMunicipalityIdRef.current || ''],
                '#00FF66',
                '#F59E0B',
              ],
              'circle-opacity': 0.4,
              'circle-blur': 1.2,
            },
          });

          map.addLayer({
            id: 'cities-point',
            type: 'circle',
            source: 'tactical-cities',
            minzoom: 8.5,
            maxzoom: 15.0,
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                8.5,
                [
                  'case',
                  ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], selectedMunicipalityIdRef.current || ''],
                  5.5,
                  3.5,
                ],
                14,
                [
                  'case',
                  ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], selectedMunicipalityIdRef.current || ''],
                  8.5,
                  6,
                ],
              ],
              'circle-color': [
                'case',
                ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], selectedMunicipalityIdRef.current || ''],
                '#00FF66',
                '#F2E8D5',
              ],
              'circle-stroke-color': '#0A0B08',
              'circle-stroke-width': 2,
            },
          });

          // 5B: Etiquetas de Texto con el Nombre de la Ciudad
          map.addLayer({
            id: 'cities-labels',
            type: 'symbol',
            source: 'tactical-cities',
            minzoom: 8.5,
            maxzoom: 15.0,
            layout: {
              'text-field': ['get', 'name'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 8.5, 10.5, 14, 15],
              'text-offset': [0, 1.2],
              'text-anchor': 'top',
              'text-transform': 'uppercase',
              'text-letter-spacing': 0.1,
              'text-allow-overlap': false,
              'text-optional': true,
              'text-padding': 4,
            },
            paint: {
              'text-color': [
                'case',
                ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], selectedMunicipalityIdRef.current || ''],
                '#00FF66',
                '#F2E8D5',
              ],
              'text-halo-color': '#0A0B08',
              'text-halo-width': 2,
            },
          });

          // 5C. Terreno Geográfico Persistente por Sector (Ruta A: CustomLayer WebGL GL_NEAREST 0-huecos)
          map.addSource('tactical-sector-terrain', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });

          map.addLayer({
            id: 'tactical-sector-terrain-fill',
            type: 'fill',
            source: 'tactical-sector-terrain',
            minzoom: 14.5,
            filter: ['==', ['get', 'kind'], 'fill'],
            paint: {
              'fill-color': ['get', 'fillColor'],
              'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0.0, 14.99, 0.12, 15.0, 0.15],
            },
          });

          map.addLayer(createTacticalTerrainWebGLLayer(map));

          // 6. Cuadrícula Táctica Vectorial Continua en GPU (Macro 10.0..13.99 -> Micro 20x20 >= 14.0)
          map.addSource('tactical-viewport-grid', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });

          map.addLayer({
            id: 'tactical-viewport-grid-lines',
            type: 'line',
            source: 'tactical-viewport-grid',
            minzoom: 10.0,
            paint: {
              'line-color': ['case', ['boolean', ['get', 'isSectorBorder'], false], '#4ADE80', '#A3E635'],
              'line-width': ['case', ['boolean', ['get', 'isSectorBorder'], false], 1.6, 0.9],
              'line-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                10.0,
                0.16,
                13.99,
                0.24,
                14.0,
                ['case', ['boolean', ['get', 'isSectorBorder'], false], 0.55, 0.28],
                15.0,
                ['case', ['boolean', ['get', 'isSectorBorder'], false], 0.65, 0.32],
              ],
            },
          });

          map.addSource('tactical-viewport-grid-hover', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });

          map.addLayer({
            id: 'tactical-viewport-grid-hover-fill',
            type: 'fill',
            source: 'tactical-viewport-grid-hover',
            minzoom: ZOOM_TACTICO - 1.0,
            paint: {
              'fill-color': '#FACC15',
              'fill-opacity': 0.16,
            },
          });

          map.addLayer({
            id: 'tactical-viewport-grid-hover-line',
            type: 'line',
            source: 'tactical-viewport-grid-hover',
            minzoom: ZOOM_TACTICO - 1.0,
            paint: {
              'line-color': '#FACC15',
              'line-width': 2.2,
            },
          });

          // 7. Precarga GPU de Sprites Verdes (greenEarth) + Capa de Unidades RTS Activas (zoom >= 15.0)
          registerGreenUnitSprites(map);

          map.addSource('tactical-rts-units', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });

          map.addLayer({
            id: 'tactical-rts-units-halo',
            type: 'circle',
            source: 'tactical-rts-units',
            minzoom: 14.0,
            paint: {
              'circle-radius': ['case', ['boolean', ['get', 'isSelected'], false], 16, 13],
              'circle-color': ['case', ['boolean', ['get', 'isAlly'], true], '#15803D', '#C2410C'],
              'circle-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                14.0,
                0.0,
                14.5,
                0.15,
                14.99,
                ['case', ['boolean', ['get', 'isSelected'], false], 0.40, 0.24],
              ],
              'circle-stroke-color': ['case', ['boolean', ['get', 'isSelected'], false], '#EAB308', '#090D14'],
              'circle-stroke-width': ['case', ['boolean', ['get', 'isSelected'], false], 2.5, 1.5],
              'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 14.0, 0.0, 14.99, 1.0],
            },
          });

          map.addLayer({
            id: 'tactical-rts-units-sprites',
            type: 'symbol',
            source: 'tactical-rts-units',
            minzoom: 14.0,
            layout: {
              'icon-image': ['get', 'spriteKey'],
              'icon-size': ['case', ['boolean', ['get', 'isSelected'], false], 0.85, 0.7],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
            },
            paint: {
              'icon-opacity': ['interpolate', ['linear'], ['zoom'], 14.0, 0.0, 14.5, 0.45, 14.99, 0.96, 15.0, 1.0],
            },
          });

          map.addLayer({
            id: 'tactical-rts-units-labels',
            type: 'symbol',
            source: 'tactical-rts-units',
            minzoom: 14.5,
            layout: {
              'text-field': ['concat', ['get', 'code'], ' ', ['to-string', ['get', 'hp']]],
              'text-size': 10,
              'text-offset': [0, 1.5],
              'text-anchor': 'top',
            },
            paint: {
              'text-color': '#E2E8F0',
              'text-halo-color': '#0A0B08',
              'text-halo-width': 1.5,
              'text-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0.0, 15.0, 1.0],
            },
          });

          // 7B. Zona de Calor GPU de Unidades en Vista Municipal (Estrato 2: 8.5 <= zoom < 15.0)
          map.addSource('tactical-operational-units', {
            type: 'geojson',
            data: operationalUnitsService.toGeoJSON() as any,
          });

          map.addLayer({
            id: 'tactical-operational-units-heatmap',
            type: 'heatmap',
            source: 'tactical-operational-units',
            minzoom: 8.5,
            maxzoom: ZOOM_TACTICO,
            paint: {
              'heatmap-weight': 1,
              'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8.5, 0.6, 14.0, 1.3],
              'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8.5, 18, 12.0, 28, 14.5, 42],
              'heatmap-color': [
                'interpolate',
                ['linear'],
                ['heatmap-density'],
                0.0, 'rgba(0, 0, 0, 0)',
                0.2, 'rgba(34, 197, 94, 0.35)',
                0.45, 'rgba(234, 179, 8, 0.58)',
                0.7, 'rgba(249, 115, 22, 0.78)',
                1.0, 'rgba(239, 68, 68, 0.92)',
              ],
              'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 14.0, 0.82, 14.99, 0.0],
            },
          });

          syncViewportGridRef.current?.(map);
          syncHoverGridRef.current?.(map);
          syncRtsUnitsToMapRef.current?.();

          // Cursores tácticos e interactividad
          map.on('mouseenter', 'provinces-fill', () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', 'provinces-fill', () => {
            map.getCanvas().style.cursor = '';
          });

          const handleZuliaLayerClick = (e: MapMouseEvent) => {
            if (map.getZoom() >= ZOOM_TACTICO - 1.0) return;
            if ((e.originalEvent as any)?.__zuliaMunHandled) return;
            const features = (e as any).features as any[] | undefined;
            const matchedFeat = features?.find((f) => Boolean(resolveMunicipalityIdFromFeature(f)));
            const munId = matchedFeat ? resolveMunicipalityIdFromFeature(matchedFeat) : null;
            if (!munId) return;
            if (e.originalEvent) (e.originalEvent as any).__zuliaMunHandled = true;
            setSelectedMunicipalityId(munId);
            if (onSelectMunicipalityRef.current) {
              onSelectMunicipalityRef.current(munId, {
                name: matchedFeat?.properties?.name || matchedFeat?.properties?.municipalityName,
                cityName: matchedFeat?.properties?.cityName,
                stateId: matchedFeat?.properties?.stateId || 'REG_VE_02',
              });
            }
            try { audioManager.playHoverTick(); } catch {}
          };

          for (const layerId of ['cities-labels', 'cities-point', 'zulia-municipalities-fill'] as const) {
            map.on('mouseenter', layerId, () => {
              map.getCanvas().style.cursor = 'pointer';
            });
            map.on('mouseleave', layerId, () => {
              map.getCanvas().style.cursor = '';
            });
            map.on('click', layerId, handleZuliaLayerClick);
          }

          map.on('mousemove', (e: MapMouseEvent) => {
            wakeFromStandby();
            if (map.getZoom() >= ZOOM_TACTICO - 1.0) {
              const { sector, cell } = lngLatToGridCoords(
                [e.lngLat.lng, e.lngLat.lat],
                TACTICAL_GRID_DIMENSION,
                ZOOM_TACTICO
              );
              setHoveredCellGlobal((prev) =>
                prev &&
                prev.sector[0] === sector[0] &&
                prev.sector[1] === sector[1] &&
                prev.cell[0] === cell[0] &&
                prev.cell[1] === cell[1]
                  ? prev
                  : { sector, cell }
              );
            } else {
              setHoveredCellGlobal(null);
            }
          });

          map.on('click', (e: MapMouseEvent) => {
            wakeFromStandby();
            if (map.getZoom() >= ZOOM_TACTICO - 1.0) {
              const { sector, cell } = lngLatToGridCoords(
                [e.lngLat.lng, e.lngLat.lat],
                TACTICAL_GRID_DIMENSION,
                ZOOM_TACTICO
              );
              setSelectedMicroCoords({
                sector,
                cell,
                lngLat: [e.lngLat.lng, e.lngLat.lat],
              });
              if (onSelectTacticalCellRef.current) {
                onSelectTacticalCellRef.current(sector, cell, [e.lngLat.lng, e.lngLat.lat]);
              }

              // Interacción RTS Continuo en Celda
              const rts = rtsEngineRef.current;
              const allUnits = rts.getAllUnits() as unknown as RtsUnitView[];
              const clickedUnit = allUnits.find((u) => u.x === cell[0] && u.y === cell[1]);
              const selectedUnit = selectedTacticalUnitIdRef.current
                ? (rts.getUnit(selectedTacticalUnitIdRef.current) as unknown as RtsUnitView | undefined)
                : undefined;

              if (clickedUnit) {
                const clickedOwner = clickedUnit.owner || clickedUnit.ownerId;
                const selectedOwner = selectedUnit ? selectedUnit.owner || selectedUnit.ownerId : null;

                if (clickedOwner === (userClanId || 'clan-ferro') || !selectedUnit) {
                  // Seleccionar unidad aliada
                  setSelectedTacticalUnitId(clickedUnit.id);
                  selectedTacticalUnitIdRef.current = clickedUnit.id;
                  syncRtsUnitsToMapRef.current?.();
                  try { audioManager.playHoverTick(); } catch {}
                } else if (selectedUnit && clickedOwner !== selectedOwner) {
                  // Disparo sobre unidad enemiga
                  const fireResult = rts.executeFire(selectedUnit.id, clickedUnit.id, Date.now());
                  if (fireResult.success) {
                    triggerScreenShakeRef.current?.();
                    syncRtsUnitsToMapRef.current?.();
                    try { audioManager.playCue('action_confirmed'); } catch {}
                  } else {
                    try { audioManager.playCue('ui_cancel_rollback'); } catch {}
                  }
                }
              } else if (selectedUnit) {
                // Clic en celda vacía: orden de marcha interpolada
                const path = [
                  { x: selectedUnit.x, y: selectedUnit.y },
                  { x: cell[0], y: cell[1] },
                ];
                rts.issueMoveOrder(selectedUnit.id, path, Date.now());
                syncRtsUnitsToMapRef.current?.();
                try { audioManager.playSFX('button_click'); } catch {}
              }
            }
          });

          map.on('click', 'provinces-fill', (e: MapMouseEvent) => {
            const z = map.getZoom();
            if (z >= ZOOM_TACTICO - 1.0) return;

            if (z >= 8.5 && z < ZOOM_TACTICO - 0.5) {
              const zuliaLayers = ['cities-labels', 'cities-point', 'zulia-municipalities-fill'].filter((id) =>
                Boolean(map.getLayer(id))
              );
              if (zuliaLayers.length > 0) {
                const zuliaHits = map.queryRenderedFeatures(e.point, { layers: zuliaLayers });
                const matchedMunFeat = zuliaHits.find((f: any) => Boolean(resolveMunicipalityIdFromFeature(f)));
                const hitMunId = matchedMunFeat ? resolveMunicipalityIdFromFeature(matchedMunFeat) : null;
                if (hitMunId) {
                  if (!(e.originalEvent as any)?.__zuliaMunHandled) {
                    if (e.originalEvent) (e.originalEvent as any).__zuliaMunHandled = true;
                    setSelectedMunicipalityId(hitMunId);
                    if (onSelectMunicipalityRef.current) {
                      onSelectMunicipalityRef.current(hitMunId, {
                        name: matchedMunFeat?.properties?.name || matchedMunFeat?.properties?.municipalityName,
                        cityName: matchedMunFeat?.properties?.cityName,
                        stateId: matchedMunFeat?.properties?.stateId || 'REG_VE_02',
                      });
                    }
                    try { audioManager.playHoverTick(); } catch {}
                  }
                  return;
                }
              }
            }

            if (z < 5.0 && onSelectCountryRef.current) {
              onSelectCountryRef.current('COUNTRY_VEN');
              return;
            }

            const featureId = (e as any).features?.[0]?.properties?.id;
            if (featureId && onSelectProvinceRef.current) {
              onSelectProvinceRef.current(String(featureId));
            }
            const ctrl = controlMapRef.current?.[featureId];
            if (ctrl?.status === 'under_siege') {
              triggerScreenShakeRef.current?.();
            }
          });

          map.on('click', 'world-land-mass', (e: MapMouseEvent) => {
            if (map.getZoom() >= ZOOM_TACTICO - 1.0) return;
            const provHits = map.getLayer('provinces-fill')
              ? map.queryRenderedFeatures(e.point, { layers: ['provinces-fill'] })
              : [];
            if (provHits.length > 0) return;
            onSelectCountryRef.current?.('COUNTRY_VEN');
          });
        });

        mapInstanceRef.current = map;
        if (typeof window !== 'undefined') {
          (window as any).__TACTICAL_MAP_INSTANCE__ = map;
        }
      } catch (err: any) {
        console.error('[TacticalWorldMap] Fallo crítico al inicializar MapLibre WebGL:', err);
        setWebglError(err?.message || 'Error de contexto WebGL al inicializar mapa.');
      }
    };

    initMapEngine();

    window.addEventListener('blur', enterStandby);
    window.addEventListener('focus', wakeFromStandby);
    inactivityTimerRef.current = window.setTimeout(enterStandby, ACTIVITY_TIMEOUT_MS);

    return () => {
      isMounted = false;
      window.removeEventListener('blur', enterStandby);
      window.removeEventListener('focus', wakeFromStandby);
      if (inactivityTimerRef.current !== null) window.clearTimeout(inactivityTimerRef.current);
      if (mapInstanceRef.current) {
        if (typeof window !== 'undefined' && (window as any).__TACTICAL_MAP_INSTANCE__ === mapInstanceRef.current) {
          (window as any).__TACTICAL_MAP_INSTANCE__ = null;
        }
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [pruneCivilianLayers, userClanId]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const provSource = map.getSource('tactical-provinces') as GeoJSONSource | undefined;
    if (provSource) provSource.setData(provincesGeoJSON);
  }, [provincesGeoJSON]);

  // Actualización instantánea de delimitación geográfica real de municipios del Zulia sin recargar fuentes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const activeMunId = selectedMunicipalityId || '';

    if (map.getLayer('zulia-municipalities-fill')) {
      map.setPaintProperty('zulia-municipalities-fill', 'fill-color', [
        'case',
        ['==', ['get', 'id'], activeMunId],
        '#F59E0B',
        '#46521F',
      ]);
      map.setPaintProperty('zulia-municipalities-fill', 'fill-opacity', [
        'case',
        ['==', ['get', 'id'], activeMunId],
        0.34,
        0.04,
      ]);
    }

    if (map.getLayer('zulia-municipalities-border')) {
      map.setPaintProperty('zulia-municipalities-border', 'line-color', [
        'case',
        ['==', ['get', 'id'], activeMunId],
        '#00FF66',
        '#7B8A4A',
      ]);
      map.setPaintProperty('zulia-municipalities-border', 'line-width', [
        'case',
        ['==', ['get', 'id'], activeMunId],
        3.2,
        1.1,
      ]);
      map.setPaintProperty('zulia-municipalities-border', 'line-opacity', [
        'case',
        ['==', ['get', 'id'], activeMunId],
        0.98,
        0.48,
      ]);
    }

    if (map.getLayer('cities-glow')) {
      map.setPaintProperty('cities-glow', 'circle-color', [
        'case',
        ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], activeMunId],
        '#00FF66',
        '#F59E0B',
      ]);
    }

    if (map.getLayer('cities-point')) {
      map.setPaintProperty('cities-point', 'circle-color', [
        'case',
        ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], activeMunId],
        '#00FF66',
        '#F2E8D5',
      ]);
      map.setPaintProperty('cities-point', 'circle-radius', [
        'interpolate',
        ['linear'],
        ['zoom'],
        8.5,
        [
          'case',
          ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], activeMunId],
          5.5,
          3.5,
        ],
        14,
        [
          'case',
          ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], activeMunId],
          8.5,
          6,
        ],
      ]);
    }

    if (map.getLayer('cities-labels')) {
      map.setPaintProperty('cities-labels', 'text-color', [
        'case',
        ['==', ['coalesce', ['get', 'municipalityId'], '__NONE__'], activeMunId],
        '#00FF66',
        '#F2E8D5',
      ]);
    }
  }, [selectedMunicipalityId]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    syncHoverGrid(map);
  }, [hoveredCellGlobal, selectedMicroCoords, currentZoom, syncHoverGrid]);

  const syncAnchorSectorUnitsToRts = useCallback(() => {
    const anchorSector =
      rtsAnchorSectorRef.current ??
      lngLatToGridCoords([-71.455, 10.395], TACTICAL_GRID_DIMENSION, ZOOM_TACTICO).sector;
    rtsAnchorSectorRef.current = anchorSector;

    const rts = rtsEngineRef.current;
    for (const opUnit of operationalUnitsService.getAllUnits()) {
      const { sector, cell } = lngLatToGridCoords(
        opUnit.coordinates,
        TACTICAL_GRID_DIMENSION,
        ZOOM_TACTICO
      );
      if (sector[0] === anchorSector[0] && sector[1] === anchorSector[1]) {
        rts.registerUnit(
          {
            id: opUnit.id,
            unitCode: opUnit.code,
            displayName: opUnit.name,
            owner: opUnit.clanId,
            ownerId: opUnit.clanId,
            x: cell[0],
            y: cell[1],
            hp: opUnit.hp,
            maxHp: opUnit.maxHp,
            ammo: 9,
            fuel: 99,
            minRange: 1,
            maxRange: 1,
            moveRange: 5,
            movementPoints: 5,
            movementType: 'treads',
            visionRange: 3,
            baseAttack: 85,
            productionCost: 5000,
            hasMoved: false,
            hasActed: false,
            skinId: 'default',
          } as any,
          opUnit.tier || 1
        );
      }
    }

    const matrix = spatialDeploymentService.getSectorTerrainMatrix(anchorSector, TACTICAL_GRID_DIMENSION);
    for (let y = 0; y < TACTICAL_GRID_DIMENSION; y++) {
      for (let x = 0; x < TACTICAL_GRID_DIMENSION; x++) {
        rts.setTerrain(x, y, matrix[y][x]);
      }
    }
  }, []);

  // Sincronización reactiva de unidades operacionales (Estrato 2) y sector ancla RTS (Estrato 3)
  useEffect(() => {
    const handleOperationalUnitsChange = () => {
      const map = mapInstanceRef.current;
      if (map) {
        const opSource = map.getSource('tactical-operational-units') as GeoJSONSource | undefined;
        if (opSource) {
          opSource.setData(operationalUnitsService.toGeoJSON() as any);
        }
      }
      if (!activeBattleUnits || activeBattleUnits.length === 0) {
        syncAnchorSectorUnitsToRts();
        syncRtsUnitsToMapRef.current?.();
      }
    };

    const unsub = operationalUnitsService.subscribe(handleOperationalUnitsChange);
    const unsubSpatial = spatialDeploymentService.subscribe(() => {
      const map = mapInstanceRef.current;
      if (map) {
        lastTerrainKeyRef.current = 'dirty';
        syncViewportGridRef.current?.(map);
      }
      const anchor = rtsAnchorSectorRef.current;
      if (anchor) {
        const matrix = spatialDeploymentService.getSectorTerrainMatrix(anchor, TACTICAL_GRID_DIMENSION);
        for (let y = 0; y < TACTICAL_GRID_DIMENSION; y++) {
          for (let x = 0; x < TACTICAL_GRID_DIMENSION; x++) {
            rtsEngineRef.current.setTerrain(x, y, matrix[y][x]);
          }
        }
      }
    });
    return () => {
      unsub();
      unsubSpatial();
    };
  }, [activeBattleUnits, syncAnchorSectorUnitsToRts]);

  // Loop de simulación RTS continua a 10 ticks/s (100 ms) en Zoom Táctico (Zero-Jank Dirty Checking)
  useEffect(() => {
    if (currentZoom < ZOOM_TACTICO - 1.0) {
      syncRtsUnitsToMap();
      return;
    }

    // Sembrar unidades del Polígono de Cabimas en sector ancla si el motor está vacío
    if (rtsEngineRef.current.getAllUnits().length === 0) {
      if (activeBattleUnits && activeBattleUnits.length > 0) {
        for (const u of activeBattleUnits) {
          rtsEngineRef.current.registerUnit(u as any);
        }
      } else {
        syncAnchorSectorUnitsToRts();
      }
    }

    syncRtsUnitsToMap();

    const interval = window.setInterval(() => {
      if (isStandbyRef.current) return;
      const now = Date.now();
      const { stateChanged } = rtsEngineRef.current.tick(now);
      const isDirty = rtsEngineRef.current.consumeDirtyFlag();

      if (stateChanged || isDirty) {
        syncRtsUnitsToMap();
      }
    }, 100);

    return () => window.clearInterval(interval);
  }, [currentZoom, activeBattleUnits, userClanId, syncRtsUnitsToMap, syncAnchorSectorUnitsToRts]);

  const activeMicroCoords = useMemo(() => {
    if (selectedMicroCoords) return selectedMicroCoords;
    if (currentZoom >= 15.0 && mapInstanceRef.current) {
      const center = mapInstanceRef.current.getCenter();
      const coords = lngLatToGridCoords([center.lng, center.lat], TACTICAL_GRID_DIMENSION, ZOOM_TACTICO);
      return {
        sector: coords.sector,
        cell: coords.cell,
        lngLat: [center.lng, center.lat] as [number, number],
      };
    }
    return null;
  }, [selectedMicroCoords, currentZoom]);

  const microAssignment = useMemo(() => {
    if (!activeMicroCoords || currentZoom < 15.0) return null;
    return spatialDeploymentService.getSpatialAssignment(activeMicroCoords.lngLat);
  }, [activeMicroCoords, currentZoom]);

  useEffect(() => {
    if (externalDeployTrigger > 0) {
      setIsDeployModalOpen(true);
    }
  }, [externalDeployTrigger]);

  useEffect(() => {
    if (externalBuildTrigger > 0) {
      setIsBuildDrawerOpen(true);
    }
  }, [externalBuildTrigger]);

  if (webglError) {
    return (
      <div className={`relative w-full h-full flex flex-col items-center justify-center bg-[#090D14] p-6 text-center select-none ${className}`}>
        <div className="max-w-md p-6 bg-[#161712] border-2 border-amber-500 rounded-[6px_2px_6px_2px] shadow-[4px_4px_0px_#0A0B08] space-y-4">
          <div className="text-amber-400 font-mono text-xs font-black tracking-widest uppercase">
            [ALERTA C4ISR: FALLO EN MOTOR GRÁFICO WEBGL 2.0]
          </div>
          <p className="text-[#F2E8D5] text-xs font-mono leading-relaxed">
            {webglError}
          </p>
          <div className="text-[11px] font-mono text-neutral-400 bg-black/60 p-2.5 rounded border border-neutral-800">
            Verifica que la aceleración por hardware WebGL 2.0 esté habilitada en tu navegador para continuar la campaña.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative w-full h-full overflow-hidden bg-[#090D14] ${isScreenShaking ? 'tactical-screen-shake' : ''} ${className}`}
    >
      <div
        ref={mapContainerRef}
        className={`w-full h-full ${isStratumTransitioning ? 'tactical-stratum-blur' : 'tactical-stratum-clear'}`}
      />

      {/* Indicador Cinético de Cambio de Estrato (HUD C4ISR) */}
      {isStratumTransitioning && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 pointer-events-none tactical-spring-bounce">
          <div className="bg-[#161712]/95 border-2 border-[#7B8A4A] text-[#F2E8D5] px-4 py-1.5 rounded-[12px_3px_12px_3px] shadow-[4px_4px_0px_#0A0B08] flex items-center gap-2 font-mono text-xs font-black uppercase tracking-wider backdrop-blur-sm">
            <span className="w-2.5 h-2.5 rounded-full bg-[#00FF66] animate-ping" />
            <span>
              {currentStratum === 1
                ? '🛰️ ESTRATO 1: VISTA MACRO-ESTRATÉGICA (Z < 10)'
                : currentStratum === 2
                ? '🗺️ ESTRATO 2: TEATRO OPERACIONAL Y RED VIAL (10 ≤ Z < 15)'
                : '⚔️ ESTRATO 3: CUADRÍCULA DE COMBATE C4ISR (Z ≥ 15)'}
            </span>
          </div>
        </div>
      )}

      {/* Capa Semántica e Interactiva Accesible (Habilita accesibilidad y orquestación E2E en Playwright) */}
      <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden" aria-hidden="false">
        <button
          type="button"
          data-country-id="COUNTRY_VEN"
          onClick={(e) => {
            e.stopPropagation();
            onSelectCountry?.('COUNTRY_VEN');
          }}
          tabIndex={-1}
          aria-label="País República de Venezuela"
          className="absolute pointer-events-auto opacity-0 focus:opacity-100 w-6 h-6 top-16 left-1/2 -translate-x-1/2 cursor-pointer"
        />

        {[
          { id: 'MUN_ZULIA_CABIMAS', name: 'Cabimas', cityName: 'Cabimas', stateId: 'REG_VE_02', left: '22%', top: '26%' },
          { id: 'MUN_ZULIA_MARACAIBO', name: 'Maracaibo', cityName: 'Maracaibo', stateId: 'REG_VE_02', left: '19%', top: '23%' },
          { id: 'MUN_ZULIA_BARALT', name: 'Baralt', cityName: 'Mene Grande', stateId: 'REG_VE_02', left: '24%', top: '31%' },
          { id: 'MUN_ZULIA_SUCRE', name: 'Sucre', cityName: 'Bobures', stateId: 'REG_VE_02', left: '23%', top: '36%' },
        ].map((mun) => (
          <button
            key={mun.id}
            type="button"
            data-municipality-id={mun.id}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedMunicipalityId(mun.id);
              onSelectMunicipality?.(mun.id, {
                name: mun.name,
                cityName: mun.cityName,
                stateId: mun.stateId,
              });
            }}
            tabIndex={-1}
            aria-label={`Municipio ${mun.name}`}
            className="absolute pointer-events-auto opacity-0 focus:opacity-100 w-6 h-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
            style={{ left: mun.left, top: mun.top }}
          />
        ))}

        {provinces.map((prov) => {
          const isBuffer = prov.id.startsWith('BUF_');
          return (
            <button
              key={prov.id}
              data-region-id={prov.id}
              data-buffer-zone={isBuffer ? 'true' : 'false'}
              onClick={(e) => {
                e.stopPropagation();
                if (onSelectProvince) onSelectProvince(prov.id);
              }}
              tabIndex={-1}
              aria-label={`Región ${prov.name}`}
              className="absolute pointer-events-auto opacity-0 focus:opacity-100 w-8 h-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
              style={{
                left: `${prov.posX}%`,
                top: `${prov.posY}%`,
              }}
            />
          );
        })}
      </div>
      <div
        className={
          hideLegacyMicroDeck
            ? 'absolute top-14 left-1/2 -translate-x-1/2 z-20 pointer-events-none bg-[#0E100C]/88 border border-[#46521F] px-2.5 py-1 text-[9.5px] font-mono text-emerald-400 rounded shadow-[2px_2px_0px_#0A0B08] whitespace-nowrap'
            : 'absolute bottom-16 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-3 sm:bottom-16 z-20 pointer-events-none bg-[#090D14]/88 border border-[#46521F] px-2.5 py-1 text-[10px] font-mono text-emerald-400 rounded shadow-[2px_2px_0px_#0A0B08]'
        }
      >
        <div>OPENPLACE WEBGL • ZOOM: {currentZoom.toFixed(2)}x • TEATRO VENEZUELA ({provinces.filter(p => !p.id.startsWith('BUF_')).length} SOBERANAS + {provinces.filter(p => p.id.startsWith('BUF_')).length} BUFFERS)</div>
        {isStandbyUI && <div className="text-amber-500 font-bold">[MODO AHORRO C4ISR: 0% GPU STANDBY]</div>}
      </div>

      {/* Panel de Detalle del Microjuego Táctico C4ISR (Activo a Zoom >= 15.0 cuando no usa inspector unificado) */}
      {!hideLegacyMicroDeck && (
        <MicroTacticalDeckHUD
          currentZoom={currentZoom}
          selectedSector={activeMicroCoords?.sector ?? null}
          selectedCell={activeMicroCoords?.cell ?? null}
          selectedLngLat={activeMicroCoords?.lngLat ?? null}
          terrainType={microAssignment?.terrainName}
          defenseStars={microAssignment ? Math.round(microAssignment.defenseCoverPercent / 10) : 2}
          occupantName={
            microAssignment?.deployedUnit?.callsign ||
            microAssignment?.deployedBuilding?.buildingType ||
            null
          }
          onOpenDeploy={() => setIsDeployModalOpen(true)}
          onOpenBuild={() => setIsBuildDrawerOpen(true)}
        />
      )}

      {/* Modales de Despliegue y Construcción Espacial */}
      {(activeMicroCoords || isDeployModalOpen || isBuildDrawerOpen) && (() => {
        const modalCoords = activeMicroCoords || (() => {
          const fallbackLngLat: [number, number] = [-71.455, 10.395];
          const coords = lngLatToGridCoords(fallbackLngLat, TACTICAL_GRID_DIMENSION, ZOOM_TACTICO);
          return {
            sector: coords.sector,
            cell: coords.cell,
            lngLat: fallbackLngLat,
          };
        })();
        const portalContent = (
          <>
            <TacticalUnitDeployModal
              isOpen={isDeployModalOpen}
              onClose={() => setIsDeployModalOpen(false)}
              sector={modalCoords.sector}
              cell={modalCoords.cell}
              lngLat={modalCoords.lngLat}
              userClanId={userClanId || 'clan-ferro'}
              userFactionId="blue_moon"
              onDeploySuccess={() => {
                syncRtsUnitsToMap();
              }}
            />

            <TacticalConstructionDrawer
              isOpen={isBuildDrawerOpen}
              onClose={() => setIsBuildDrawerOpen(false)}
              sector={modalCoords.sector}
              cell={modalCoords.cell}
              lngLat={modalCoords.lngLat}
              userClanId={userClanId || 'clan-ferro'}
              onConstructionSuccess={() => {}}
            />
          </>
        );
        return typeof document !== 'undefined' ? createPortal(portalContent, document.body) : portalContent;
      })()}
    </div>
  );
};
