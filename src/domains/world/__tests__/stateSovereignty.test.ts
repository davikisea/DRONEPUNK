/**
 * ==============================================================================
 * TEST SUITE: SOBERANÍA TERRITORIAL, RBAC Y CONTROL DE ESTADOS C4ISR
 * ==============================================================================
 * Conforme a @game-dev-quality-gate y docs/00_GEOTACTICS_ONLINE_MASTER_SPEC.md
 * Valida permisos de líderes de clan, gestores de facción y renombre de países.
 * ==============================================================================
 */

import { stateSovereigntyService, STATE_PERKS_CATALOG } from '../services/stateSovereigntyService';
import type { UserRoleContext } from '../types/stateSovereigntyTypes';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ [FAILED]: ${msg}`);
    process.exit(1);
  }
}

console.log('==============================================================================');
console.log('EJECUTANDO SUITE: SOBERANÍA TERRITORIAL, RBAC Y CONTROL DE ESTADOS');
console.log('==============================================================================\n');

let passedTests = 0;

try {
  // ----------------------------------------------------------------------------
  // SUITE 1: Consulta Inicial y SSOT de Estados
  // ----------------------------------------------------------------------------
  console.log('--- SUITE 1: CONSULTA DE ESTADOS Y TELEMETRÍA GEOPOLÍTICA ---');

  const caracas = stateSovereigntyService.getState('REG_VE_01');
  assert(!!caracas, 'Caracas (REG_VE_01) debe existir en el SSOT de soberanía');
  assert(caracas!.canonicalStateName === 'Distrito Capital', 'Caracas debe mapear a Distrito Capital');
  assert(caracas!.controllingFactionId === 'orange_star', 'Caracas controlada inicialmente por Orange Star');
  assert(caracas!.tcpCurrent === 10000, 'TCP inicial debe ser 10,000');
  assert(caracas!.gdpWarCreditsPerHour > 0, 'PIB de guerra debe ser mayor a 0');
  console.log(`✅ [PASSED] Test 1.1: Caracas verificado con ${caracas!.gdpWarCreditsPerHour} $G/hr`);
  passedTests++;

  const zulia = stateSovereigntyService.getState('REG_VE_02');
  assert(!!zulia, 'Zulia (REG_VE_02) debe existir');
  assert(zulia!.controllingFactionId === 'blue_moon', 'Zulia controlado por Blue Moon (Clan Ferro)');
  assert(zulia!.resources.oil > 500, 'Zulia debe tener alto rendimiento de crudo (>500)');
  console.log(`✅ [PASSED] Test 1.2: Zulia verificado con ${zulia!.resources.oil} barriles de petróleo`);
  passedTests++;

  // ----------------------------------------------------------------------------
  // SUITE 2: RBAC Estricto (Líderes de Clan y Gestores de Facción)
  // ----------------------------------------------------------------------------
  console.log('\n--- SUITE 2: RBAC ESTRICTO Y CONTROL DE ACCESO ---');

  // Caso 2.1: Soldado / Recluta de tropa ordinaria intenta desbloquear
  const recruitUser: UserRoleContext = {
    userId: 'user-soldier-01',
    userName: 'Soldado Pérez',
    clanId: 'clan-ferro',
    clanTag: 'FERR',
    clanRole: 'recruit',
    factionId: 'blue_moon',
    isFactionManager: false,
  };

  const recruitCheck = stateSovereigntyService.canUnlockStateControl(recruitUser, 'REG_VE_02');
  assert(recruitCheck.allowed === false, 'Recluta NO debe tener autorización para alterar soberanía');
  assert(recruitCheck.reason!.includes('AUTORIZACIÓN INSUFICIENTE'), 'Debe advertir sobre jerarquía insuficiente');
  console.log('✅ [PASSED] Test 2.1: Recluta denegado con feedback de rango militar');
  passedTests++;

  // Caso 2.2: Miembro de facción rival intenta acceder a Zulia (Orange Star intentando gobernar Blue Moon)
  const rivalLeaderUser: UserRoleContext = {
    userId: 'user-rival-leader',
    userName: 'Comandante Rival',
    clanId: 'clan-orinoco',
    clanTag: 'ORNC',
    clanRole: 'leader',
    factionId: 'orange_star',
    isFactionManager: false,
  };

  const rivalCheck = stateSovereigntyService.canUnlockStateControl(rivalLeaderUser, 'REG_VE_02');
  assert(rivalCheck.allowed === false, 'Líder de facción rival NO puede gobernar un estado ajeno');
  assert(rivalCheck.reason!.includes('bajo control de la facción'), 'Debe advertir sobre soberanía enemiga');
  console.log('✅ [PASSED] Test 2.2: Facción rival bloqueada con advertencia de control soberano');
  passedTests++;

  // Caso 2.3: Líder de Clan Hegemónico autorizado
  const ferroLeaderUser: UserRoleContext = {
    userId: 'user-ferro-cmd',
    userName: 'General Ferro',
    clanId: 'clan-ferro',
    clanTag: 'FERR',
    clanRole: 'leader',
    factionId: 'blue_moon',
    isFactionManager: false,
  };

  const leaderCheck = stateSovereigntyService.canUnlockStateControl(ferroLeaderUser, 'REG_VE_02');
  assert(leaderCheck.allowed === true, 'Líder del clan controlador DEBE estar autorizado');
  console.log('✅ [PASSED] Test 2.3: Líder de clan hegemónico autorizado exitosamente');
  passedTests++;

  // Caso 2.4: Gestor de Facción autorizado (incluso si no es el líder directo del clan)
  const factionManagerUser: UserRoleContext = {
    userId: 'user-manager-bluemoon',
    userName: 'Comisario Político Blue Moon',
    clanId: 'clan-sub-ferro',
    clanTag: 'FERR-2',
    clanRole: 'officer',
    factionId: 'blue_moon',
    isFactionManager: true,
  };

  const managerCheck = stateSovereigntyService.canUnlockStateControl(factionManagerUser, 'REG_VE_02');
  assert(managerCheck.allowed === true, 'Gestor de facción DEBE estar autorizado');
  console.log('✅ [PASSED] Test 2.4: Gestor de facción autorizado exitosamente');
  passedTests++;

  // ----------------------------------------------------------------------------
  // SUITE 3: Proclamación Soberana y Mutación de Nombre de País y Estado
  // ----------------------------------------------------------------------------
  console.log('\n--- SUITE 3: PROCLAMACIÓN SOBERANA Y PROPAGACIÓN DE PAÍS ---');

  let notificationFired: boolean = false;
  const unsubscribe = stateSovereigntyService.subscribe((updated) => {
    if (updated.stateId === 'REG_VE_02') {
      notificationFired = true;
    }
  });

  const proclamationResult = await stateSovereigntyService.updateStateSovereignty(ferroLeaderUser, {
    stateId: 'REG_VE_02',
    newCountryName: 'Confederación Ártica de Venezuela',
    newStateName: 'República Petrolera de Zulia',
    customMotto: 'Acero Frío y Victoria Continental',
    sovereignProclamation: 'Por decreto militar del Clan Ferro, la cuenca del Lago de Maracaibo queda formalmente reestructurada.',
  });

  assert(Boolean(proclamationResult.success), 'La proclamación debe ser exitosa');
  assert(Boolean(notificationFired), 'Los suscriptores deben recibir la notificación reactiva');

  const updatedZulia = stateSovereigntyService.getState('REG_VE_02')!;
  assert(updatedZulia.customCountryName === 'Confederación Ártica de Venezuela', 'Nombre de país debe actualizarse');
  assert(updatedZulia.customStateName === 'República Petrolera de Zulia', 'Nombre de estado debe actualizarse');
  assert(updatedZulia.customMotto === 'Acero Frío y Victoria Continental', 'Lema debe registrarse');
  assert(updatedZulia.unlockedByUserId === ferroLeaderUser.userId, 'ID del proclamador registrado');

  console.log(`✅ [PASSED] Test 3.1: Soberanía mutada: [${updatedZulia.customCountryName} / ${updatedZulia.customStateName}]`);
  passedTests++;

  unsubscribe();

  // ----------------------------------------------------------------------------
  // SUITE 4: Política Macro Escalada (Gestor Municipal, Corrupción, Perks >60% y Corporación)
  // ----------------------------------------------------------------------------
  console.log('\n--- SUITE 4: POLÍTICA MACRO ESCALADA (GESTOR, PERKS >60% Y DIPLOMACIA) ---');

  const rejectedAppoint = stateSovereigntyService.appointMunicipalManager({
    municipalityId: 'MUN_ZULIA_CABIMAS',
    stateId: 'REG_VE_02',
    municipalityControllingClanId: 'clan-ferro',
    majorityRatio: 0.48,
    managerUserId: 'user-mgr-01',
    managerUserName: 'Gestor Cabimas',
    actorContext: ferroLeaderUser,
  });
  assert(rejectedAppoint.success === false, 'No se puede nombrar Gestor Municipal con <= 50% de celdas');

  const validAppoint = stateSovereigntyService.appointMunicipalManager({
    municipalityId: 'MUN_ZULIA_CABIMAS',
    stateId: 'REG_VE_02',
    municipalityControllingClanId: 'clan-ferro',
    majorityRatio: 0.62,
    managerUserId: 'user-mgr-01',
    managerUserName: 'Gestor Cabimas',
    actorContext: ferroLeaderUser,
  });
  assert(validAppoint.success === true && !!validAppoint.manager, 'Gestor Municipal nombrado tras superar 50%');

  const unauthorizedMgrAction = stateSovereigntyService.executeMunicipalManagerAction({
    municipalityId: 'MUN_ZULIA_CABIMAS',
    actorUserId: 'intruder-99',
    actorUserName: 'Intruso',
    actionType: 'toggle_radar',
    buildingEnabled: false,
  });
  assert(unauthorizedMgrAction.success === false, 'Usuario no asignado como Gestor Municipal es rechazado');

  const sabotageAction = stateSovereigntyService.executeMunicipalManagerAction({
    municipalityId: 'MUN_ZULIA_CABIMAS',
    actorUserId: 'user-mgr-01',
    actorUserName: 'Gestor Cabimas',
    actionType: 'toggle_radar',
    buildingEnabled: false,
    isPreIncursionWindow: true,
  });
  assert(sabotageAction.success === true, 'Acción del Gestor ejecutada y auditada');
  assert(sabotageAction.auditEntry?.isSuspiciousCorruption === true, 'Apagar radar en ventana pre-incursión marca riesgo de corrupción');
  assert((sabotageAction.manager?.corruptionRiskScore ?? 0) > 0, 'Índice de riesgo de corrupción incrementado en bitácora');
  assert(sabotageAction.manager?.publicBuildingsState.earlyWarningRadarActive === false, 'Radar desactivado tras orden');
  console.log('✅ [PASSED] Test 4.1: RBAC de Gestor Municipal y trazabilidad de sabotaje pre-incursión verificados');
  passedTests++;

  const perksLocked = stateSovereigntyService.evaluateStateLevelPerks({
    stateId: 'REG_VE_02',
    clanId: 'clan-ferro',
    controlledMunicipalitiesCount: 12,
    totalMunicipalitiesCount: 21,
  });
  assert(perksLocked.isPerkUnlocked === false, 'Con 12/21 (~57.1%) aún no se desbloquean Perks Estatales (>60%)');

  const perksUnlocked = stateSovereigntyService.evaluateStateLevelPerks({
    stateId: 'REG_VE_02',
    clanId: 'clan-ferro',
    controlledMunicipalitiesCount: 13,
    totalMunicipalitiesCount: 21,
  });
  assert(perksUnlocked.isPerkUnlocked === true, 'Con 13/21 (~61.9% > 60%) se activan Perks Estatales');
  assert(perksUnlocked.borderFuelDiscountMultiplier === 0.80, 'Perk Estatal otorga -20% de consumo de combustible fronterizo');
  assert(perksUnlocked.adjacentConquestSpeedMultiplier === 1.15, 'Perk Estatal otorga +15% velocidad de conquista en municipios adyacentes');

  const corpPrivs = stateSovereigntyService.evaluateCorporateMacroPrivileges({
    clanId: 'clan-ferro',
    controlledMunicipalitiesCount: 1,
    addNonAggressionPactWithClanId: 'clan-caribe',
    setCustomTariffForClan: { targetClanId: 'clan-caribe', rate: 0.06 },
  });
  assert(corpPrivs.advancedTechTreeUnlocked === true, 'Corporación con >= 1 municipio desbloquea Árbol Tecnológico Avanzado');
  assert(corpPrivs.unlockedHeavyChassis.includes('neotank') && corpPrivs.unlockedHeavyChassis.includes('bomber'), 'Neotanque y Bombardero habilitados en Hangar Físico');
  assert(corpPrivs.officialDiplomacyEnabled === true && corpPrivs.nonAggressionPacts.includes('clan-caribe'), 'Diplomacia Oficial y pactos habilitados');
  console.log('✅ [PASSED] Test 4.2: Perks Estatales (>60%) y Privilegios Corporativos (>=1 municipio) verificados');
  passedTests++;

  // Suite 5: 8 Perks Estatales (>60% = 1, >85% = 2, tope global = 3)
  assert(Object.keys(STATE_PERKS_CATALOG).length === 8, 'Catálogo de Perks Estatales debe contener exactamente 8 perks en 3 ramas');
  const perksCapRejected = stateSovereigntyService.configureCorporationStatePerks({
    clanId: 'clan-ferro',
    statesControlRatios: { REG_VE_02: 0.90, REG_VE_05: 0.90 },
    requestedPerksByState: {
      REG_VE_02: ['VANGUARD_LOGISTICS', 'BLITZKRIEG_DOCTRINE'],
      REG_VE_05: ['MICROCHIP_SUBSIDY', 'CORPORATE_FREE_ZONE'],
    },
  });
  assert(perksCapRejected.success === false, 'Tope global máximo de 3 Perks Estatales simultáneos bloquea 4 perks');

  const perksConfigured = stateSovereigntyService.configureCorporationStatePerks({
    clanId: 'clan-ferro',
    statesControlRatios: { REG_VE_02: 0.88, REG_VE_05: 0.65 },
    requestedPerksByState: {
      REG_VE_02: ['VANGUARD_LOGISTICS', 'CENTRALIZED_SUPPLY'],
      REG_VE_05: ['CIVIL_MOBILIZATION'],
    },
  });
  assert(perksConfigured.success === true && perksConfigured.activeGlobalPerks.length === 3, 'Configuración de 2 perks (>85%) + 1 perk (>60%) = 3 globales aprobada');
  console.log('✅ [PASSED] Test 5.1: 8 Perks Estatales en 3 ramas y tope global de 3 perks verificados');
  passedTests++;

  console.log('------------------------------------------------------------------------------');
  console.log(`RESUMEN SOBERANÍA, RBAC Y PERKS ESTATALES: ${passedTests}/8 PASARON`);
  console.log('✅ TODAS LAS PRUEBAS DE SOBERANÍA Y POLÍTICA MACRO SUPERADAS (100% ÉXITO)');
  console.log('==============================================================================\n');
} catch (e) {
  console.error('Error fatal durante la ejecución de pruebas:', e);
  process.exit(1);
}
