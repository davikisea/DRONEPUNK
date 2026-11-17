/**
 * ==============================================================================
 * CONTRATO UNIFICADO DE SELECCIÓN MULTIESCALA (4 NIVELES GEOGRÁFICOS)
 * ==============================================================================
 * Escalas soportadas en el Inspector Derecho Unificado:
 *   1. country      -> País (COUNTRY_VEN u otros)
 *   2. state        -> Estado / Región Federal (REG_VE_01..REG_VE_24 o BUF_*)
 *   3. municipality -> Municipio (MUN_ZULIA_* o cabeceras)
 *   4. cell         -> Cuadrícula Táctica 20×20 (Zoom >= 15.0)
 * ==============================================================================
 */

export type MapScaleLevel = 'country' | 'state' | 'municipality' | 'cell';

export type InspectorTabId = 'summary' | 'government' | 'economy' | 'operations';

export interface CountrySelectionTarget {
  scale: 'country';
  countryId: string;
  countryName: string;
}

export interface StateSelectionTarget {
  scale: 'state';
  countryId: string;
  stateId: string;
}

export interface MunicipalitySelectionTarget {
  scale: 'municipality';
  countryId: string;
  stateId: string;
  municipalityId: string;
  municipalityName?: string;
  cityName?: string;
}

export interface CellSelectionTarget {
  scale: 'cell';
  countryId: string;
  stateId: string;
  municipalityId?: string | null;
  sector: [number, number];
  cell: [number, number];
  lngLat: [number, number];
}

export type MapSelectionTarget =
  | CountrySelectionTarget
  | StateSelectionTarget
  | MunicipalitySelectionTarget
  | CellSelectionTarget;

export interface ZuliaMunicipalityMeta {
  id: string;
  name: string;
  cityName: string;
  stateId: string;
  stateName: string;
  centerLngLat: [number, number];
  strategicRole: string;
  chokepointId?: 'CHK-MARACAIBO' | 'CHK-PARIA' | null;
  activeFiefName: string;
  hourlyLocalYieldEc: number;
}

/**
 * Catálogo ligero de los 21 municipios canónicos del Estado Zulia (REG_VE_02)
 * sincronizado con public/map/zulia_municipalities.json y theatre_cities.json.
 */
export const ZULIA_MUNICIPALITIES_CATALOG: ZuliaMunicipalityMeta[] = [
  {
    id: 'MUN_ZULIA_MARACAIBO',
    name: 'Maracaibo',
    cityName: 'Maracaibo',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.6406, 10.6544],
    strategicRole: 'Puerto Occidental y Estrecho de Maracaibo',
    chokepointId: 'CHK-MARACAIBO',
    activeFiefName: 'Aduana Naval del Estrecho',
    hourlyLocalYieldEc: 320,
  },
  {
    id: 'MUN_ZULIA_SAN_FRANCISCO',
    name: 'San Francisco',
    cityName: 'San Francisco',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.6344, 10.5517],
    strategicRole: 'Corredor Sur del Estrecho y Puente General Rafael Urdaneta',
    chokepointId: 'CHK-MARACAIBO',
    activeFiefName: 'Cabecera Occidental Puente Urdaneta',
    hourlyLocalYieldEc: 240,
  },
  {
    id: 'MUN_ZULIA_CABIMAS',
    name: 'Cabimas',
    cityName: 'Cabimas',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.4539, 10.3994],
    strategicRole: 'Epicentro Petrolero Génesis • Terminal La Salina',
    chokepointId: 'CHK-MARACAIBO',
    activeFiefName: 'Feudo La Salina (Terminal Petrolero)',
    hourlyLocalYieldEc: 380,
  },
  {
    id: 'MUN_ZULIA_SANTA_RITA',
    name: 'Santa Rita',
    cityName: 'Santa Rita',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.5117, 10.5364],
    strategicRole: 'Cabecera Oriental del Puente sobre el Lago de Maracaibo',
    chokepointId: 'CHK-MARACAIBO',
    activeFiefName: 'Peaje Oriental Puente del Lago',
    hourlyLocalYieldEc: 190,
  },
  {
    id: 'MUN_ZULIA_MIRANDA',
    name: 'Miranda',
    cityName: 'Los Puertos de Altagracia',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.5228, 10.6744],
    strategicRole: 'Complejo Petroquímico Ana María Campos (El Tablazo)',
    chokepointId: 'CHK-MARACAIBO',
    activeFiefName: 'Complejo Petroquímico El Tablazo',
    hourlyLocalYieldEc: 290,
  },
  {
    id: 'MUN_ZULIA_LAGUNILLAS',
    name: 'Lagunillas',
    cityName: 'Ciudad Ojeda',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.3087, 10.2078],
    strategicRole: 'Complejo de Servicios Petroleros Costa Oriental',
    chokepointId: null,
    activeFiefName: 'Maestranza Industrial Ciudad Ojeda',
    hourlyLocalYieldEc: 270,
  },
  {
    id: 'MUN_ZULIA_VALMORE_RODRIGUEZ',
    name: 'Valmore Rodríguez',
    cityName: 'Bachaquero',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.1494, 9.9694],
    strategicRole: 'Campo Petrolero Sur de la Costa Oriental y Dique Costanero',
    chokepointId: null,
    activeFiefName: 'Muelle Petrolero Bachaquero',
    hourlyLocalYieldEc: 210,
  },
  {
    id: 'MUN_ZULIA_BARALT',
    name: 'Baralt',
    cityName: 'Mene Grande',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-70.9253, 9.8167],
    strategicRole: 'Cuna Histórica del Pozo Zumaque I y Nudo Trujillo-Zulia',
    chokepointId: null,
    activeFiefName: 'Campo Zumaque I (Extracción)',
    hourlyLocalYieldEc: 220,
  },
  {
    id: 'MUN_ZULIA_SIMON_BOLIVAR',
    name: 'Simón Bolívar',
    cityName: 'Tía Juana',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.3667, 10.2583],
    strategicRole: 'Estación de Flujo y Subestación Energética Costa Oriental',
    chokepointId: null,
    activeFiefName: 'Subestación Tía Juana',
    hourlyLocalYieldEc: 200,
  },
  {
    id: 'MUN_ZULIA_MARA',
    name: 'Mara',
    cityName: 'San Rafael del Moján',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.735, 10.96],
    strategicRole: 'Paso Fluvial del Río Limón y Acceso a la Guajira',
    chokepointId: null,
    activeFiefName: 'Control Fluvial Río Limón',
    hourlyLocalYieldEc: 165,
  },
  {
    id: 'MUN_ZULIA_GUAJIRA',
    name: 'Guajira',
    cityName: 'Sinamaica / Paraguaipoa',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.8542, 11.0875],
    strategicRole: 'Bastión Fronterizo Norte • Laguna de Sinamaica y Troncal del Caribe',
    chokepointId: null,
    activeFiefName: 'Guarnición Troncal del Caribe',
    hourlyLocalYieldEc: 150,
  },
  {
    id: 'MUN_ZULIA_JESUS_ENRIQUE_LOSSADA',
    name: 'Jesús Enrique Lossada',
    cityName: 'La Concepción',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.8389, 10.6194],
    strategicRole: 'Cuenca Occidental Petrolera y Planicie Agroindustrial de Lossada',
    chokepointId: null,
    activeFiefName: 'Batería Campo Boscán Norte',
    hourlyLocalYieldEc: 185,
  },
  {
    id: 'MUN_ZULIA_LA_CANADA_DE_URDANETA',
    name: 'La Cañada de Urdaneta',
    cityName: 'Concepción',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.6939, 10.4222],
    strategicRole: 'Puerto Pesquero Occidental y Corredor Industrial El Bajo',
    chokepointId: null,
    activeFiefName: 'Terminal Industrial El Bajo',
    hourlyLocalYieldEc: 175,
  },
  {
    id: 'MUN_ZULIA_MACHIQUES_DE_PERIJA',
    name: 'Machiques de Perijá',
    cityName: 'Machiques',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-72.545, 10.0644],
    strategicRole: 'Capital Ganadera de Perijá y Pie de Monte Fronterizo',
    chokepointId: null,
    activeFiefName: 'Bastión Sierra de Perijá',
    hourlyLocalYieldEc: 180,
  },
  {
    id: 'MUN_ZULIA_ROSARIO_DE_PERIJA',
    name: 'Rosario de Perijá',
    cityName: 'La Villa del Rosario',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-72.3133, 10.3258],
    strategicRole: 'Nudo Agrícola y Troncal 6 hacia la Sierra de Perijá',
    chokepointId: null,
    activeFiefName: 'Nudo Troncal 6',
    hourlyLocalYieldEc: 160,
  },
  {
    id: 'MUN_ZULIA_COLON',
    name: 'Colón',
    cityName: 'San Carlos del Zulia',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.9136, 9.0],
    strategicRole: 'Capital del Sur del Lago • Eje Fluvial Río Escalante',
    chokepointId: null,
    activeFiefName: 'Puerto Fluvial Escalante',
    hourlyLocalYieldEc: 195,
  },
  {
    id: 'MUN_ZULIA_FRANCISCO_JAVIER_PULGAR',
    name: 'Francisco Javier Pulgar',
    cityName: 'Pueblo Nuevo-El Chivo',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.6083, 8.9583],
    strategicRole: 'Corredor Platanero del Sur del Lago y Puerto Concha',
    chokepointId: null,
    activeFiefName: 'Depósito Logístico Puerto Concha',
    hourlyLocalYieldEc: 140,
  },
  {
    id: 'MUN_ZULIA_CATATUMBO',
    name: 'Catatumbo',
    cityName: 'Encontrados',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-72.2333, 9.0594],
    strategicRole: 'Terminal Fluvial del Río Catatumbo y Paso Sur-Occidental',
    chokepointId: null,
    activeFiefName: 'Embarcadero Río Catatumbo',
    hourlyLocalYieldEc: 155,
  },
  {
    id: 'MUN_ZULIA_JESUS_MARIA_SEMPRUM',
    name: 'Jesús María Semprúm',
    cityName: 'Casigua El Cubo',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-72.5197, 8.7536],
    strategicRole: 'Campo Petrolero Tarra-Catatumbo y Frontera Suroeste',
    chokepointId: null,
    activeFiefName: 'Batería Tarra-Casigua',
    hourlyLocalYieldEc: 170,
  },
  {
    id: 'MUN_ZULIA_SUCRE',
    name: 'Sucre',
    cityName: 'Bobures',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.16, 9.235],
    strategicRole: 'Puerto Lacustre Sureste y Enlace Panamericano',
    chokepointId: null,
    activeFiefName: 'Puerto Lacustre de Bobures',
    hourlyLocalYieldEc: 165,
  },
  {
    id: 'MUN_ZULIA_ALMIRANTE_PADILLA',
    name: 'Almirante Padilla',
    cityName: 'El Toro',
    stateId: 'REG_VE_02',
    stateName: 'Zulia',
    centerLngLat: [-71.6561, 10.9575],
    strategicRole: 'Isla de Toas • Control Naval de la Barra del Lago de Maracaibo',
    chokepointId: 'CHK-MARACAIBO',
    activeFiefName: 'Fortaleza Barra de Maracaibo',
    hourlyLocalYieldEc: 215,
  },
];

export function getZuliaMunicipalityMeta(municipalityId: string): ZuliaMunicipalityMeta | undefined {
  return ZULIA_MUNICIPALITIES_CATALOG.find((m) => m.id === municipalityId);
}
