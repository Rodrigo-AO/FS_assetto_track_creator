import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';
import type { Plugin } from 'vite';
import { loadCircuit, rasterizeGround } from './acCircuit';
import { buildSurfaceMap, type SurfaceMap } from './surfaceMap';
import { circuitPresetById } from '../src/domain/presets/presets';
import { LocalProjection } from '../src/domain/geo/projection';
import { findAcTracksDir } from './assettoCorsaLocator';

/** Archivo que marca una pista como generada por esta app (solo esas se sobrescriben). */
export const OWNERSHIP_MARKER = 'atc/project.json';
const TRACK_ID = /^[a-z0-9_]{1,64}$/;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => ok(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', fail);
  });
}

/** Descomprime la pista en `tracksDir/trackId`; solo sobrescribe pistas creadas por esta app. */
export function installTrack(tracksDir: string, trackId: string, zip: Uint8Array): string {
  const target = join(tracksDir, trackId);
  if (existsSync(target)) {
    if (!existsSync(join(target, OWNERSHIP_MARKER))) {
      throw new Error(`Ya existe una pista "${trackId}" que no fue creada con esta app; cambia el nombre.`);
    }
    rmSync(target, { recursive: true, force: true });
  }
  for (const [name, data] of Object.entries(unzipSync(zip))) {
    const file = resolve(target, name);
    if (!file.startsWith(target + sep)) throw new Error(`Ruta no válida en el paquete: ${name}`);
    if (name.endsWith('/')) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  }
  return target;
}

/** API local para instalar la pista exportada directamente en Assetto Corsa. */
export function acInstallerPlugin(): Plugin {
  return {
    name: 'atc-ac-installer',
    configureServer(server) {
      server.middlewares.use('/api/ac/status', (_req, res) => {
        const tracksDir = findAcTracksDir();
        sendJson(res, 200, { found: tracksDir !== null, tracksDir });
      });
      // Circuito instalado usado como preset: modelos a cargar y superficies.
      server.middlewares.use('/api/ac/circuit-terrain', (req, res) => {
        const q = new URL(req.url ?? '', 'http://localhost').searchParams;
        const tracksDir = findAcTracksDir();
        if (!tracksDir) return sendJson(res, 404, { error: 'No se encontró Assetto Corsa (define ATC_AC_PATH)' });
        try {
          const circuit = loadCircuit(tracksDir, q.get('track') ?? '', q.get('layout') ?? '');
          if (!circuit) return sendJson(res, 404, { error: `El circuito «${q.get('track')}» no está instalado` });
          const [x0, y0, x1, y1, cell] = ['x0', 'y0', 'x1', 'y1', 'cell'].map((k) => Number(q.get(k)));
          if (![x0, y0, x1, y1, cell].every(Number.isFinite) || x1 <= x0 || y1 <= y0 || cell <= 0) {
            return sendJson(res, 400, { error: 'Rectángulo no válido' });
          }
          sendJson(res, 200, rasterizeGround(circuit.ground, { x0, y0, x1, y1, cell }, circuit.visual));
        } catch (e) {
          sendJson(res, 400, { error: (e as Error).message });
        }
      });
      // Capa del editor: superficies del circuito (asfalto, pianos, césped…) georreferenciadas.
      const surfaceMaps = new Map<string, { stamp: string; map: SurfaceMap }>();
      server.middlewares.use('/api/ac/circuit-surfaces', (req, res) => {
        const preset = circuitPresetById(new URL(req.url ?? '', 'http://localhost').searchParams.get('id'));
        if (!preset) return sendJson(res, 400, { error: 'Preset de circuito desconocido' });
        const tracksDir = findAcTracksDir();
        if (!tracksDir) return sendJson(res, 404, { error: 'No se encontró Assetto Corsa (define ATC_AC_PATH)' });
        try {
          const circuit = loadCircuit(tracksDir, preset.acTrack, preset.layout);
          if (!circuit) return sendJson(res, 404, { error: `El circuito «${preset.acTrack}» no está instalado` });
          const hit = surfaceMaps.get(preset.id);
          const tangent = new LocalProjection(preset.georef.origin);
          const outline = preset.polygon.map((p) => tangent.toLocal(p));
          const xs = outline.map((p) => p.x);
          const ys = outline.map((p) => p.y);
          const clip = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
          const map = hit?.stamp === circuit.stamp ? hit.map : buildSurfaceMap(circuit, preset.georef, clip);
          surfaceMaps.set(preset.id, { stamp: circuit.stamp, map });
          sendJson(res, 200, map);
        } catch (e) {
          sendJson(res, 500, { error: (e as Error).message });
        }
      });
      server.middlewares.use('/api/ac/circuit', (req, res) => {
        const q = new URL(req.url ?? '', 'http://localhost').searchParams;
        const tracksDir = findAcTracksDir();
        if (!tracksDir) return sendJson(res, 200, { installed: false, acFound: false });
        try {
          const circuit = loadCircuit(tracksDir, q.get('track') ?? '', q.get('layout') ?? '');
          if (!circuit) return sendJson(res, 200, { installed: false, acFound: true });
          sendJson(res, 200, { installed: true, acFound: true, models: circuit.models, skipped: circuit.skipped, surfacesIni: circuit.surfacesIni });
        } catch (e) {
          sendJson(res, 400, { error: (e as Error).message });
        }
      });
      server.middlewares.use('/api/ac/install', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'Usa POST' });
        const trackId = new URL(req.url ?? '', 'http://localhost').searchParams.get('id') ?? '';
        if (!TRACK_ID.test(trackId)) return sendJson(res, 400, { error: 'Identificador de pista no válido' });
        const tracksDir = findAcTracksDir();
        if (!tracksDir) return sendJson(res, 404, { error: 'No se encontró Assetto Corsa (define ATC_AC_PATH)' });
        try {
          const path = installTrack(tracksDir, trackId, await readBody(req));
          sendJson(res, 200, { path });
        } catch (e) {
          sendJson(res, 409, { error: (e as Error).message });
        }
      });
    },
  };
}
