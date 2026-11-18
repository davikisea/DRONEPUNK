// ==============================================================================
// PUBLIC API: SHARED
// Primitivas de UI Atompunk, Cliente Supabase, Tipos Globales y Utilidades
// ==============================================================================

// Supabase Client
export { supabase, isSupabaseConfigured } from './lib/supabase/client';

// Pure H3 Spatial Utilities (zero domain dependencies — must load before UI/domain re-exports)
export {
  H3_RES9_EDGE_METERS,
  latLngToH3Res9,
  h3Res9ToLatLng,
  h3Res9ToParentRes4,
  h3GridDistance,
  h3GridDisk,
  h3GridPathCells,
} from './utils/h3';

// Shared UI Primitives
export { TacticalGhostBar } from './ui/TacticalGhostBar';
export { QADevOpsRunner } from './qa/QADevOpsRunner';
export { TacticalErrorBoundary } from './ui/TacticalErrorBoundary';
export { AuthTerminalModal } from './auth/AuthTerminalModal';

// Shared Types
export * from './types/index';
export * from './types/database.types';
export * from './types/metagame';
export * from './types/network';
export * from './types/stateSovereigntyTypes';

// Shared Services & Auth
export { catalogRegistry, type CatalogChangeListener } from './services/catalogRegistryService';
export { useAuth } from './auth/useAuth';
export { useModalStack, type ModalId } from './hooks/useModalStack';

// Asset Optimization & QA Harness
export * from './lib/shopData';
export { assetLoader, UNIT_GREEN_SPRITE_PATHS, resolveUnitSpriteKey } from './lib/assetLoader';
export { AssetOptimizationEngine, type PerformanceCheckItem, type WebPOptimizationReport } from './lib/assetOptimization';
export { initQABridge, updateQASnapshot, type QAGameSnapshot } from './utils/qaHarness';
