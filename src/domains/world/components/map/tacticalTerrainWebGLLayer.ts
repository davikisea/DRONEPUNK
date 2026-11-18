import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import { assetLoader } from '@shared';
import { spatialDeploymentService } from '../../services/spatialDeploymentService';
import { TACTICAL_GRID_DIMENSION } from './tacticalMapStyle';
import {
  GBA_FACTION_SHEETS,
  SYNTHETIC_TERRAIN_CANVASES,
  ensureSyntheticCoastalCanvases16,
  getAllTerrainSpriteCatalog,
  isTerrainSheetsLoaded,
  markTerrainSheetsLoaded,
} from './tacticalTerrainSprites';
import { computeViewportSectorRange, resolveFastTileSpriteKey } from './tacticalGridGeoJson';

export function createTacticalTerrainWebGLLayer(mapInstance: MapLibreMap): CustomLayerInterface {
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

      if (!isTerrainSheetsLoaded()) {
        void Promise.all([
          assetLoader.loadSheet('neutral'),
          ...GBA_FACTION_SHEETS.map((f) => assetLoader.loadSheet(f.sheet)),
        ]).then(() => {
          markTerrainSheetsLoaded();
          ensureSyntheticCoastalCanvases16();
          mapInstance.triggerRepaint();
        });
      }
    },
    render(gl, options) {
      const z = mapInstance.getZoom();
      if (!isTerrainSheetsLoaded() || !program || z < 14.45) return;

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
