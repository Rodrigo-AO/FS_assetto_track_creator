import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ovalProject } from '../test/fixtures';
import { openTrackZip, PROJECT_FILE, PROJECT_FORMAT, projectFileJson } from './projectFile';
import { buildTrackFiles, zipTrackFiles } from './trackPackage';

const zipWith = (files: Record<string, string>): Uint8Array => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

describe('Editar circuito: abrir el ZIP de una pista exportada', () => {
  it('recupera el proyecto del ZIP de «Descargar ZIP» (carpeta de la pista dentro)', () => {
    const project = { ...ovalProject(), name: 'Óvalo para editar' };
    const files = buildTrackFiles(project, { trackId: 'atc_ovalo', perimeterWalls: false, satellite: null });
    const opened = openTrackZip(zipTrackFiles(files, 'atc_ovalo'));
    expect(opened).toEqual({ ok: true, project, trackId: 'atc_ovalo' });
  });

  it('también vale la carpeta de la pista comprimida sin carpeta raíz', () => {
    const project = ovalProject();
    const opened = openTrackZip(zipWith({ [PROJECT_FILE]: projectFileJson(project, 'atc_x'), 'map.png': '' }));
    expect(opened.ok && opened.project).toEqual(project);
  });

  it('rechaza lo que no es un circuito de la app', () => {
    const notOurs = /no es un circuito creado con Assetto Track Creator/;
    expect(openTrackZip(new Uint8Array([1, 2, 3, 4]))).toEqual({ ok: false, error: 'El archivo no es un .zip válido.' });
    const kunos = openTrackZip(zipWith({ 'ks_barcelona/models.ini': '[MODEL_0]', 'ks_barcelona/ui/ui_track.json': '{}' }));
    expect(!kunos.ok && kunos.error).toMatch(notOurs);
    const other = openTrackZip(zipWith({ [PROJECT_FILE]: JSON.stringify({ app: 'otra-app', format: 1, project: ovalProject() }) }));
    expect(!other.ok && other.error).toMatch(notOurs);
    const broken = openTrackZip(zipWith({ [PROJECT_FILE]: '{ no es json' }));
    expect(!broken.ok && broken.error).toMatch(notOurs);
    const noTrack = openTrackZip(zipWith({ [PROJECT_FILE]: JSON.stringify({ app: 'assetto-track-creator', format: 1, project: { version: 1, name: 'x', area: null } }) }));
    expect(!noTrack.ok && noTrack.error).toMatch(notOurs);
  });

  it('avisa si el circuito es de una versión más reciente o usa un preset desconocido', () => {
    const newer = openTrackZip(zipWith({ [PROJECT_FILE]: JSON.stringify({ app: 'assetto-track-creator', format: PROJECT_FORMAT + 1, project: ovalProject() }) }));
    expect(!newer.ok && newer.error).toMatch(/versión más reciente/);
    const unknown = openTrackZip(zipWith({ [PROJECT_FILE]: projectFileJson({ ...ovalProject(), preset: 'monaco' }, 'atc_x') }));
    expect(!unknown.ok && unknown.error).toMatch(/monaco/);
  });

  it('abre exportaciones anteriores (solo el proyecto) completando los campos nuevos', () => {
    const { dirt: _dirt, relief: _relief, ...old } = ovalProject();
    const opened = openTrackZip(zipWith({ [`pista/${PROJECT_FILE}`]: JSON.stringify(old) }));
    expect(opened.ok && opened.project.relief).toEqual([]);
    expect(opened.ok && opened.project.dirt).toEqual([]);
    expect(opened.ok && opened.trackId).toBeNull();
  });
});
