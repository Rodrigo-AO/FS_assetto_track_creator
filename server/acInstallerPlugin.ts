import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';
import type { Plugin } from 'vite';
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
