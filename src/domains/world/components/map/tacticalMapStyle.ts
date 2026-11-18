import type { StyleSpecification } from 'maplibre-gl';

export interface TacticalLineStringGeometry {
  type: 'LineString';
  coordinates: [number, number][];
}

export interface TacticalPolygonGeometry {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export interface TacticalPointGeometry {
  type: 'Point';
  coordinates: [number, number];
}

export interface TacticalGeoJSONFeature<G, P = Record<string, unknown>> {
  type: 'Feature';
  geometry: G;
  properties: P;
}

export interface TacticalGeoJSONCollection<G, P = Record<string, unknown>> {
  type: 'FeatureCollection';
  features: TacticalGeoJSONFeature<G, P>[];
}

export const C4ISR_HIDE_LAYERS_REGEX = /^poi_|^landuse|^building(-3d)?$|^road_label|^waterway_label|^transit_/;
export const ACTIVITY_TIMEOUT_MS = 300_000; // 5 minutos para standby automático (0% CPU)
export const TACTICAL_GRID_DIMENSION = 20; // Cuadrícula de 20x20 celdas por sector
export const MAX_GRID_SECTORS_PER_AXIS = 5;
export const SPRITE_GPU_SIZE = 48;

export function resolveMunicipalityIdFromFeature(feat: any): string | null {
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
export const ZERO_RASTER_MILITARY_STYLE: StyleSpecification = {
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
