import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';
import { installTrack, OWNERSHIP_MARKER } from './acInstallerPlugin';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dirs: string[] = [];
const tracksDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'atc-tracks-'));
  dirs.push(dir);
  return dir;
};

afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('instalador de pistas', () => {
  it('descomprime la pista y la reinstala encima si es de la app', () => {
    const root = tracksDir();
    installTrack(root, 'atc_x', zipSync({ 'atc_x.kn5': enc('v1'), [OWNERSHIP_MARKER]: enc('{}') }));
    installTrack(root, 'atc_x', zipSync({ 'atc_x.kn5': enc('v2'), [OWNERSHIP_MARKER]: enc('{}') }));
    expect(readFileSync(join(root, 'atc_x', 'atc_x.kn5'), 'utf8')).toBe('v2');
  });

  it('no sobrescribe una pista ajena', () => {
    const root = tracksDir();
    mkdirSync(join(root, 'imola'));
    writeFileSync(join(root, 'imola', 'imola.kn5'), 'kunos');
    expect(() => installTrack(root, 'imola', zipSync({ 'x.kn5': enc('x') }))).toThrow(/no fue creada con esta app/);
    expect(readFileSync(join(root, 'imola', 'imola.kn5'), 'utf8')).toBe('kunos');
  });

  it('rechaza rutas que escapan de la carpeta de la pista', () => {
    const root = tracksDir();
    expect(() => installTrack(root, 'atc_y', zipSync({ '../evil.txt': enc('x') }))).toThrow(/Ruta no válida/);
    expect(existsSync(join(root, 'evil.txt'))).toBe(false);
  });
});
