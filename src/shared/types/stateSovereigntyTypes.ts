/**
 * ==============================================================================
 * TIPOS CANÓNICOS DE SOBERANÍA ESTATAL Y RBAC C4ISR
 * ==============================================================================
 * Especificación: docs/PROPUESTA_INGENIERIA_MAPA_METAPOLITICA_ALICE_CABIMAS.md
 * Rige la propiedad, el renombre de países/estados y la gobernanza territorial.
 * ==============================================================================
 */

export type FactionId =
  | 'orange_star'
  | 'blue_moon'
  | 'green_earth'
  | 'yellow_comet'
  | 'black_hole';

export type ClanRole = 'leader' | 'officer' | 'veteran' | 'recruit' | 'guest';

export interface UserRoleContext {
  userId: string;
  userName: string;
  clanId: string;
  clanTag: string;
  clanRole: ClanRole;
  factionId: FactionId;
  isFactionManager: boolean;
}

export interface StateResourceYield {
  oil: number;        // Barriles por ciclo
  steel: number;      // Toneladas de acero
  rareEarth: number;  // Minerales raros
  composites: number; // Blindaje compuesto
}

export interface StateSovereigntyRecord {
  stateId: string;                // ej: 'REG_VE_01', 'REG_VE_02'
  countryId: string;              // ej: 'COUNTRY_VEN'
  canonicalCountryName: string;   // ej: 'República de Venezuela'
  customCountryName: string;      // Nombre decretado por la facción hegemónica
  canonicalStateName: string;     // ej: 'Zulia', 'Caracas'
  customStateName: string;        // Nombre renombrado del estado
  controllingFactionId: FactionId;
  controllingClanId: string;
  controllingClanTag: string;
  controllingClanName: string;
  status: 'stable' | 'under_siege' | 'contested' | 'liberated';
  tcpCurrent: number;             // Puntos de control territorial actuales
  tcpMax: number;                 // Puntos de control máximos (10,000)
  gdpWarCreditsPerHour: number;   // PIB de guerra ($G/hr)
  resources: StateResourceYield;
  defenseLevel: number;           // 1-5 (Nivel de fortificación)
  customMotto?: string;           // Lema soberano de la facción
  sovereignProclamation?: string; // Manifiesto oficial publicado por los líderes
  unlockedAt?: string;
  unlockedByUserId?: string;
  unlockedByUserName?: string;
}

export interface SovereignStateUpdateInput {
  stateId: string;
  newCountryName?: string;
  newStateName?: string;
  customMotto?: string;
  sovereignProclamation?: string;
}

// ============================================================================
// ESTRATOS SOCIALES PROVINCIALES (POPS) Y COHESIÓN INSTITUCIONAL (PARADOX LENS)
// ============================================================================

export interface ProvincialStrataState {
  stateId: string;
  militaristsLoyalty: number;        // 0-100% (Demandan inversión en búnkeres)
  bureaucratsSatisfaction: number;   // 0-100% (Afectado por sobre-extensión imperial)
  petroLaborUnrest: number;          // 0-100% (Sube por sobre-explotación de RGO)
  oligarchCapitalFlight: number;     // 0-100% (Fuga de capital si impuestos > 15%)
  secessionRiskPercent: number;      // Sube superlinealmente si Unrest > 70%
  isRebelControlled: boolean;        // true si la provincia se declara en secesión armada
  updatedAt: string;
}

export interface SecessionEvaluationResult {
  stateId: string;
  seceded: boolean;
  strata: ProvincialStrataState;
  reason: string;
}

// ============================================================================
// POLÍTICA MACRO ESCALADA: GESTOR MUNICIPAL, PERKS ESTATALES Y CORPORACIÓN
// ============================================================================

export type MunicipalAuditActionType =
  | 'toggle_radar'
  | 'toggle_workshop'
  | 'toggle_sam_battery'
  | 'adjust_local_tax'
  | 'sabotage_radar_pre_incursion'
  | 'fiscal_diversion_detected';

export interface MunicipalAuditLogEntry {
  id: string;
  municipalityId: string;
  actorUserId: string;
  actorUserName: string;
  actionType: MunicipalAuditActionType;
  previousValue: string;
  newValue: string;
  isSuspiciousCorruption: boolean;
  timestamp: string;
}

export interface MunicipalPublicBuildingsState {
  earlyWarningRadarActive: boolean;
  rapidRepairWorkshopActive: boolean;
  samBatteryActive: boolean;
}

export interface MunicipalManagerRole {
  managerUserId: string;
  managerUserName: string;
  municipalityId: string;
  stateId: string;
  appointedByClanId: string;
  publicBuildingsState: MunicipalPublicBuildingsState;
  localTaxRate: number;
  corruptionRiskScore: number;
  auditTrailLogs: MunicipalAuditLogEntry[];
  updatedAt: string;
}

export interface StateLevelPerkState {
  stateId: string;
  controllingClanId: string | null;
  controlledMunicipalitiesCount: number;
  totalMunicipalitiesCount: number;
  controlRatio: number;
  isPerkUnlocked: boolean;
  borderFuelDiscountMultiplier: number;
  adjacentConquestSpeedMultiplier: number;
}

export interface CorporateMacroPrivilegeState {
  clanId: string;
  controlledMunicipalitiesCount: number;
  advancedTechTreeUnlocked: boolean;
  unlockedHeavyChassis: string[];
  officialDiplomacyEnabled: boolean;
  nonAggressionPacts: string[];
  customTariffTreaties: Record<string, number>;
}

// ============================================================================
// INFRAESTRUCTURA MUNICIPAL (6 EDIFICIOS) Y PERKS ESTATALES (3 RAMAS / 8 PERKS)
// ============================================================================

export type MunicipalBuildingType =
  | 'EARLY_WARNING_RADAR'
  | 'RAPID_REPAIR_WORKSHOP'
  | 'FIXED_AA_BATTERY'
  | 'JAMMER_CENTER'
  | 'CUSTOMS_REFINERY'
  | 'COMMAND_BUNKER';

export interface MunicipalBuildingSpec {
  type: MunicipalBuildingType;
  name: string;
  cost: { alloys: number; fuel: number; microchips: number };
  radiusHexes: number | 'MUNICIPALITY';
  description: string;
}

export type StatePerkBranch = 'EXPANSION' | 'INDUSTRIAL' | 'FORTRESS';

export type StatePerkId =
  | 'VANGUARD_LOGISTICS'
  | 'BLITZKRIEG_DOCTRINE'
  | 'ASYMMETRIC_WARFARE'
  | 'MICROCHIP_SUBSIDY'
  | 'CORPORATE_FREE_ZONE'
  | 'CENTRALIZED_SUPPLY'
  | 'CIVIL_MOBILIZATION'
  | 'INTEGRATED_DEFENSE_NET';

export interface StatePerkSpec {
  id: StatePerkId;
  branch: StatePerkBranch;
  name: string;
  description: string;
}


