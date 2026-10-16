import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_STEAM_DIRS = ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'];

/** Rutas de las bibliotecas de Steam declaradas en libraryfolders.vdf. */
function steamLibraries(steamDir: string): string[] {
  const vdf = join(steamDir, 'steamapps', 'libraryfolders.vdf');
  if (!existsSync(vdf)) return [steamDir];
  const paths = [...readFileSync(vdf, 'utf8').matchAll(/"path"\s+"([^"]+)"/g)].map((m) => m[1].replace(/\\\\/g, '\\'));
  return [steamDir, ...paths];
}

/**
 * Carpeta `content/tracks` de Assetto Corsa. La variable ATC_AC_PATH tiene prioridad;
 * si no, se busca en las bibliotecas de Steam.
 */
export function findAcTracksDir(): string | null {
  const candidates = process.env.ATC_AC_PATH
    ? [process.env.ATC_AC_PATH]
    : DEFAULT_STEAM_DIRS.flatMap(steamLibraries).map((lib) => join(lib, 'steamapps', 'common', 'assettocorsa'));
  const acDir = candidates.find((dir) => existsSync(join(dir, 'acs.exe')));
  return acDir ? join(acDir, 'content', 'tracks') : null;
}
