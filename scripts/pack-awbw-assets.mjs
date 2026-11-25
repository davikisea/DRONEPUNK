/**
 * Empaquetador determinista de sprites AWBW (SOLO LECTURA sobre SPRITE-FORGE-STUDIO).
 * Copia el subconjunto canónico de C:\Users\Usuario\SPRITE-FORGE-STUDIO\assets\awbw\
 * hacia public/assets/awbw/ e instala Neutral/HQ{,_Rain,_Snow}-0.png desde GreySky/HQ
 * para garantizar 100% de edificios grises neutrales en la creación inicial de ciudades.
 */
import fs from 'node:fs';
import path from 'node:path';

const SOURCE_ROOT = 'C:\\Users\\Usuario\\SPRITE-FORGE-STUDIO\\assets\\awbw';
const DEST_ROOT = path.resolve(process.cwd(), 'public', 'assets', 'awbw');

function copyRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += copyRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

function copyFileSafe(relSrc, relDest = relSrc) {
  const srcPath = path.join(SOURCE_ROOT, relSrc);
  const destPath = path.join(DEST_ROOT, relDest);
  if (!fs.existsSync(srcPath)) return 0;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(srcPath, destPath);
  return 1;
}

function main() {
  if (!fs.existsSync(SOURCE_ROOT)) {
    console.error(`[pack-awbw-assets] Fuente no encontrada: ${SOURCE_ROOT}`);
    process.exit(1);
  }

  let copied = 0;
  // 1. Metadatos JSON oficiales AWBW
  copied += copyRecursive(path.join(SOURCE_ROOT, 'Json'), path.join(DEST_ROOT, 'Json'));

  // 2. Terreno base Classic (Plain, Wood, Mountain, Reef, Road, River, Pipe, Sea 47, Shoal 81, Neutral/SiloEmpty+Rubble)
  copied += copyRecursive(path.join(SOURCE_ROOT, 'Map', 'Classic'), path.join(DEST_ROOT, 'Map', 'Classic'));

  // 3. Dosel denso DoR/Wood para contraste entre parques urbanos y bosques periurbanos
  for (const sfx of ['', '_Rain', '_Snow']) {
    copied += copyFileSafe(path.join('Map', 'DoR', `Wood${sfx}.png`));
  }

  // 4. Edificios Neutrales AW2 + Dual-Skin City AW1 (100% grises neutrales)
  copied += copyRecursive(path.join(SOURCE_ROOT, 'Map', 'AW2', 'Neutral'), path.join(DEST_ROOT, 'Map', 'AW2', 'Neutral'));
  for (const sfx of ['', '_Rain', '_Snow']) {
    copied += copyFileSafe(path.join('Map', 'AW1', 'Neutral', `City${sfx}-0.png`));
    // Neutral HQ gris oficial (16x31 px) derivado de AW2/GreySky/HQ{w_sfx}-0.png
    copied += copyFileSafe(
      path.join('Map', 'AW2', 'GreySky', `HQ${sfx}-0.png`),
      path.join('Map', 'AW2', 'Neutral', `HQ${sfx}-0.png`)
    );
  }

  // 5. Facciones activas para edificios tras captura posterior + Unidades (16/25 chasis)
  const factions = ['OrangeStar', 'BlueMoon', 'GreenEarth', 'YellowComet', 'BlackHole'];
  for (const fac of factions) {
    copied += copyRecursive(path.join(SOURCE_ROOT, 'Map', 'AW2', fac), path.join(DEST_ROOT, 'Map', 'AW2', fac));
    copied += copyRecursive(path.join(SOURCE_ROOT, 'Units', fac), path.join(DEST_ROOT, 'Units', fac));
  }

  console.log(`[pack-awbw-assets] OK: ${copied} archivos AWBW empaquetados en ${DEST_ROOT}`);
}

main();
