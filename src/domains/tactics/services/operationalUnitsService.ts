/**
 * ==============================================================================
 * SERVICIO DE UNIDADES OPERACIONALES DESPLEGADAS EN EL MAPA C4ISR
 * ==============================================================================
 * Especificación Canónica: docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md §3.2
 * Gestiona tropas desplegadas visibles a partir de Zoom x10 en carreteras y frentes.
 * ==============================================================================
 */

import { resolveUnitSpriteKey } from '@shared';

export interface DeployedOperationalUnit {
  id: string;
  name: string;
  code: string;            // 'infantry' | 'recon' | 'md_tank' | 'artillery' | 'b_copter' | 'anti_air'
  clanId: string;
  clanTag: string;
  factionId: string;
  coordinates: [number, number]; // [lng, lat]
  hp: number;              // 1 - 100
  maxHp: number;           // 100
  tier: number;            // 1 - 5
  status: 'patrol' | 'holding' | 'in_transit' | 'combat';
  callsign: string;
  colorHex: string;
}

type UnitChangeListener = (units: DeployedOperationalUnit[]) => void;

class OperationalUnitsService {
  private units: Map<string, DeployedOperationalUnit> = new Map();
  private listeners: Set<UnitChangeListener> = new Set();

  constructor() {
    this.seedDefaultOperationalUnits();
  }

  private seedDefaultOperationalUnits() {
    const defaultUnits: DeployedOperationalUnit[] = [
      // ======================================================================
      // POLÍGONO DE PRUEBAS CABIMAS — SECTOR ANCLA [9880, 15432] + LA SALINA
      // 9 Drones Autónomos H3 + 16 Chasis Tácticos + 2 Blancos Hostiles (100 HP)
      // ======================================================================

      // 0. Terminal La Salina (compatibilidad E2E y Sprint 2/3)
      {
        id: 'unit-cab-01',
        name: 'División Blindada Ferro A-1',
        code: 'md_tank',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.458, 10.395],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'FERRO-TITÁN-01',
        colorHex: '#1D4ED8',
      },

      // --- FILA y=2: LOS 9 DRONES AUTÓNOMOS H3 (CANONICAL_H3_DRONE_CATALOG) ---
      {
        id: 'unit-cab-h3-infantry_swarm',
        name: 'Dron Infantería (Swarm)',
        code: 'infantry_swarm',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.453705, 10.400027],
        hp: 100,
        maxHp: 100,
        tier: 1,
        status: 'holding',
        callsign: 'SWARM-CAB-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-h3-recon_explorer',
        name: 'Recon (Explorador H3)',
        code: 'recon_explorer',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.453156, 10.400027],
        hp: 100,
        maxHp: 100,
        tier: 1,
        status: 'holding',
        callsign: 'RECON-H3-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-h3-light_artillery',
        name: 'Artillería Ligera H3',
        code: 'light_artillery',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.452606, 10.400027],
        hp: 100,
        maxHp: 100,
        tier: 1,
        status: 'holding',
        callsign: 'ARTY-H3-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-h3-medium_tank',
        name: 'Tanque Medio H3',
        code: 'medium_tank',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.452057, 10.400027],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'MTANK-H3-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-h3-anti_air',
        name: 'Unidad Antiaérea (AA H3)',
        code: 'anti_air',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.451508, 10.400027],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'AA-H3-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-h3-logistics_apc',
        name: 'Dron Logístico (APC H3)',
        code: 'logistics_apc',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.450958, 10.400027],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'APC-H3-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-h3-bomber_drone',
        name: 'Dron Bombardero H3',
        code: 'bomber_drone',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.450409, 10.400027],
        hp: 100,
        maxHp: 100,
        tier: 3,
        status: 'holding',
        callsign: 'BOMBER-H3-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-h3-neo_tank',
        name: 'Neo-Tanque (Coloso H3)',
        code: 'neo_tank',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.44986, 10.400027],
        hp: 100,
        maxHp: 100,
        tier: 3,
        status: 'holding',
        callsign: 'NEOTANK-H3-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-h3-tactical_missile',
        name: 'Lanzamisiles Táctico H3',
        code: 'tactical_missile',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.44931, 10.400027],
        hp: 100,
        maxHp: 100,
        tier: 3,
        status: 'holding',
        callsign: 'MISSILE-H3-01',
        colorHex: '#1D4ED8',
      },

      // --- FILAS y=4..8: LOS 16 CHASIS TÁCTICOS + 2 BLANCOS HOSTILES ---
      {
        id: 'unit-cab-ch-battleship',
        name: 'Acorazado Naval La Salina',
        code: 'battleship',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.454254, 10.398946],
        hp: 100,
        maxHp: 100,
        tier: 3,
        status: 'holding',
        callsign: 'FERRO-NAVAL-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-infantry',
        name: 'Infantería de Línea Cabimas',
        code: 'infantry',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.453705, 10.398946],
        hp: 100,
        maxHp: 100,
        tier: 1,
        status: 'holding',
        callsign: 'FERRO-INF-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-mech',
        name: 'Mecanizado Bazooka El Barroso',
        code: 'mech',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.453156, 10.398946],
        hp: 100,
        maxHp: 100,
        tier: 1,
        status: 'holding',
        callsign: 'FERRO-MECH-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-tank_medium',
        name: 'Tanque Mediano Vanguardia',
        code: 'tank_medium',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.452606, 10.398946],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'FERRO-MTANK-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-enemy-01',
        name: 'Blanco Hostil Blindado Orinoco',
        code: 'tank_medium',
        clanId: 'clan-orinoco',
        clanTag: 'ORNC',
        factionId: 'orange_star',
        coordinates: [-71.452057, 10.398946],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'ORINOCO-BLANCO-01',
        colorHex: '#E65100',
      },
      {
        id: 'unit-cab-ch-recon',
        name: 'Vehículo Reconocimiento Intercomunal',
        code: 'recon',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.451508, 10.398946],
        hp: 100,
        maxHp: 100,
        tier: 1,
        status: 'holding',
        callsign: 'FERRO-RECON-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-apc',
        name: 'Transporte Blindado APC Logístico',
        code: 'apc',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.450958, 10.398946],
        hp: 100,
        maxHp: 100,
        tier: 1,
        status: 'holding',
        callsign: 'FERRO-APC-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-tank_light',
        name: 'Tanque Ligero Costa Oriental',
        code: 'tank_light',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.450409, 10.398946],
        hp: 100,
        maxHp: 100,
        tier: 1,
        status: 'holding',
        callsign: 'FERRO-LTANK-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-neotank',
        name: 'Neotanque Pesado Ferro',
        code: 'neotank',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.44986, 10.398946],
        hp: 100,
        maxHp: 100,
        tier: 3,
        status: 'holding',
        callsign: 'FERRO-NEO-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-enemy-02',
        name: 'Blanco Hostil Aéreo Orinoco',
        code: 'b_copter',
        clanId: 'clan-orinoco',
        clanTag: 'ORNC',
        factionId: 'orange_star',
        coordinates: [-71.452057, 10.398406],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'ORINOCO-BLANCO-02',
        colorHex: '#E65100',
      },
      {
        id: 'unit-cab-ch-anti_air',
        name: 'Blindado Antiaéreo Vulcan',
        code: 'anti_air',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.451508, 10.398406],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'FERRO-VULCAN-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-b_copter',
        name: 'Helicóptero de Batalla Costa',
        code: 'b_copter',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.453705, 10.397866],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'FERRO-BCOPTER-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-t_copter',
        name: 'Helicóptero de Transporte Lago',
        code: 't_copter',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.453156, 10.397866],
        hp: 100,
        maxHp: 100,
        tier: 1,
        status: 'holding',
        callsign: 'FERRO-TCOPTER-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-artillery',
        name: 'Artillería de Asedio Carretera H',
        code: 'artillery',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.452057, 10.397866],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'FERRO-ARTY-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-fighter',
        name: 'Caza Interceptor Aeroespacial',
        code: 'fighter',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.450958, 10.397866],
        hp: 100,
        maxHp: 100,
        tier: 3,
        status: 'holding',
        callsign: 'FERRO-FIGHTER-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-bomber',
        name: 'Bombardero Pesado Estratégico',
        code: 'bomber',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.450409, 10.397866],
        hp: 100,
        maxHp: 100,
        tier: 3,
        status: 'holding',
        callsign: 'FERRO-BOMBER-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-rocket',
        name: 'Lanzacohetes Múltiple Carretera K',
        code: 'rocket',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.452057, 10.397325],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'FERRO-ROCKET-01',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-cab-ch-missiles',
        name: 'Batería de Misiles AA Tierra-Aire',
        code: 'missiles',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.452057, 10.396785],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'FERRO-SAM-01',
        colorHex: '#1D4ED8',
      },

      // ======================================================================
      // DESPLIEGUES REGIONALES DE REFERENCIA (MARACAIBO / CARACAS / VALENCIA / BARQUISIMETO)
      // ======================================================================
      {
        id: 'unit-mcbo-01',
        name: 'Destacamento de Artillería Lago Urdaneta',
        code: 'artillery',
        clanId: 'clan-ferro',
        clanTag: 'FERR',
        factionId: 'blue_moon',
        coordinates: [-71.550, 10.580],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'BATERÍA-URDANETA',
        colorHex: '#1D4ED8',
      },
      {
        id: 'unit-ccs-01',
        name: 'Guardia Mecanizada Capital Orinoco',
        code: 'md_tank',
        clanId: 'clan-orinoco',
        clanTag: 'ORNC',
        factionId: 'orange_star',
        coordinates: [-66.845, 10.490],
        hp: 100,
        maxHp: 100,
        tier: 3,
        status: 'holding',
        callsign: 'ORINOCO-VANGUARD-01',
        colorHex: '#E65100',
      },
      {
        id: 'unit-val-01',
        name: 'Compañía Acorazada Sol Imperial',
        code: 'anti_air',
        clanId: 'clan-sol',
        clanTag: 'SOL',
        factionId: 'yellow_comet',
        coordinates: [-67.980, 10.180],
        hp: 100,
        maxHp: 100,
        tier: 2,
        status: 'holding',
        callsign: 'COMETA-DEFENDER',
        colorHex: '#D97706',
      },
      {
        id: 'unit-brq-01',
        name: 'Regimiento de Infantería Selva',
        code: 'infantry',
        clanId: 'clan-selva',
        clanTag: 'SLVA',
        factionId: 'green_earth',
        coordinates: [-69.320, 10.065],
        hp: 100,
        maxHp: 100,
        tier: 1,
        status: 'holding',
        callsign: 'GUARDIÁN-SELVA',
        colorHex: '#15803D',
      },
    ];

    defaultUnits.forEach((u) => this.units.set(u.id, u));
  }

  public getAllUnits(): DeployedOperationalUnit[] {
    return Array.from(this.units.values());
  }

  public getUnit(id: string): DeployedOperationalUnit | undefined {
    return this.units.get(id);
  }

  public deployUnit(unit: DeployedOperationalUnit): void {
    this.units.set(unit.id, unit);
    this.notifyListeners();
  }

  public removeUnit(id: string): void {
    this.units.delete(id);
    this.notifyListeners();
  }

  public toGeoJSON(): {
    type: 'FeatureCollection';
    features: any[];
  } {
    const features = Array.from(this.units.values()).map((u) => ({
      type: 'Feature',
      id: u.id,
      geometry: {
        type: 'Point',
        coordinates: u.coordinates,
      },
      properties: {
        id: u.id,
        name: u.name,
        code: u.code,
        spriteKey: resolveUnitSpriteKey(u.code),
        clanId: u.clanId,
        clanTag: u.clanTag,
        factionId: u.factionId,
        hp: u.hp,
        maxHp: u.maxHp,
        tier: u.tier,
        status: u.status,
        callsign: u.callsign,
        colorHex: u.colorHex,
      },
    }));

    return {
      type: 'FeatureCollection',
      features,
    };
  }

  public subscribe(listener: UnitChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    const current = this.getAllUnits();
    this.listeners.forEach((fn) => {
      try {
        fn(current);
      } catch (e) {
        console.error('[OperationalUnitsService] Error en suscriptor:', e);
      }
    });
  }
}

export const operationalUnitsService = new OperationalUnitsService();
