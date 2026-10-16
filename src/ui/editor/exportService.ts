import { zipTrackFiles, type TrackFiles } from '../../export/trackPackage';

export interface AcStatus {
  readonly found: boolean;
  readonly tracksDir: string | null;
}

/** Estado de la instalación local de AC (lo resuelve el servidor de desarrollo). */
export async function fetchAcStatus(): Promise<AcStatus> {
  try {
    const res = await fetch('/api/ac/status');
    return res.ok ? ((await res.json()) as AcStatus) : { found: false, tracksDir: null };
  } catch {
    return { found: false, tracksDir: null };
  }
}

/** Instala la pista en `content/tracks/<id>` y devuelve la ruta final. */
export async function installTrack(files: TrackFiles, trackId: string): Promise<string> {
  const body = zipTrackFiles(files);
  const res = await fetch(`/api/ac/install?id=${encodeURIComponent(trackId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/zip' },
    body: new Blob([body]),
  });
  const json = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !json.path) throw new Error(json.error ?? `Error HTTP ${res.status}`);
  return json.path;
}

/** Descarga un ZIP con la carpeta de la pista, listo para descomprimir en content/tracks. */
export function downloadZip(files: TrackFiles, trackId: string): void {
  const url = URL.createObjectURL(new Blob([zipTrackFiles(files, trackId)], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${trackId}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
