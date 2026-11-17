import { parseCliArgs, runBuildPipeline } from './build-theatre-vector-data.mjs';

console.warn(
  '[DEPRECATION] optimize-regions.mjs ya NO ejecuta simplificación Douglas-Peucker independiente por anillo (causa brechas/solapamientos entre arcos).'
);
console.warn(
  '[DEPRECATION] Delegando al pipeline topológico de arco compartido (TopoJSON) en build-theatre-vector-data.mjs...'
);

const cliOptions = parseCliArgs();
runBuildPipeline({ ...cliOptions, skipRoads: true }).catch((err) => {
  console.error('Error fatal en optimize-regions (pipeline topológico):', err);
  process.exit(1);
});
