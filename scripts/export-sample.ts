/**
 * Exporta el circuito de ejemplo de los tests (óvalo con zona de grava) a una carpeta,
 * para validar el paquete fuera del navegador:  npx vite-node scripts/export-sample.ts <carpeta>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildTrackFiles } from '../src/export/trackPackage';
import { ovalProject } from '../src/test/fixtures';

const outDir = process.argv[2];
if (!outDir) throw new Error('Uso: vite-node scripts/export-sample.ts <carpeta>');
const files = buildTrackFiles({ ...ovalProject(), conesCollidable: true }, { trackId: 'atc_sample', perimeterWalls: true, satellite: null });
for (const [path, data] of Object.entries(files)) {
  const target = join(outDir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}
console.log(`Exportados ${Object.keys(files).length} archivos en ${outDir}`);
