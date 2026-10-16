import { useEffect, useState } from 'react';
import { fetchSatelliteTexture } from '../../export/satellite';
import { buildTrackFiles, exportWarnings, trackIdFromName, validateForExport, type TrackFiles } from '../../export/trackPackage';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { CloseIcon, ExportIcon } from '../icons';
import { downloadZip, fetchAcStatus, installTrack, type AcStatus } from './exportService';
import { useScene } from './sceneContext';

type Status = { kind: 'idle' } | { kind: 'busy'; text: string } | { kind: 'done'; text: string } | { kind: 'error'; text: string };

export function ExportDialog() {
  const project = useProjectStore((s) => s.project);
  const scene = useScene();
  const setEditor = useEditorStore((s) => s.set);
  const [satellite, setSatellite] = useState(true);
  const [perimeterWalls, setPerimeterWalls] = useState(true);
  const [ac, setAc] = useState<AcStatus | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    fetchAcStatus().then(setAc);
  }, []);

  const trackId = trackIdFromName(project.name);
  const errors = validateForExport(project, scene);
  const warnings = scene ? exportWarnings(project, scene) : [];
  const busy = status.kind === 'busy';

  async function build(): Promise<TrackFiles> {
    let sat = null;
    if (satellite && scene) {
      setStatus({ kind: 'busy', text: 'Descargando imagen satélite…' });
      try {
        sat = await fetchSatelliteTexture(scene);
      } catch (e) {
        console.warn(e);
        setStatus({ kind: 'busy', text: 'No se pudo descargar la imagen satélite; se usará textura de suelo.' });
      }
    }
    setStatus({ kind: 'busy', text: 'Generando geometría y kn5…' });
    await new Promise((r) => setTimeout(r, 30)); // deja pintar el estado antes del cálculo
    return buildTrackFiles(project, { trackId, perimeterWalls, satellite: sat });
  }

  async function run(target: 'install' | 'zip'): Promise<void> {
    try {
      const files = await build();
      if (target === 'zip') {
        downloadZip(files, trackId);
        setStatus({ kind: 'done', text: `Descargado ${trackId}.zip: descomprímelo en assettocorsa/content/tracks.` });
      } else {
        setStatus({ kind: 'busy', text: 'Instalando en Assetto Corsa…' });
        const path = await installTrack(files, trackId);
        setStatus({ kind: 'done', text: `Instalado en ${path}. Búscalo en AC o Content Manager como «${project.name}».` });
      }
    } catch (e) {
      setStatus({ kind: 'error', text: (e as Error).message });
    }
  }

  return (
    <div className="dialog-backdrop" onClick={() => !busy && setEditor({ exportOpen: false })}>
      <section className="dialog" role="dialog" aria-label="Exportar a Assetto Corsa" onClick={(e) => e.stopPropagation()}>
        <header className="dialog-header">
          <ExportIcon size={20} />
          <h2>Exportar a Assetto Corsa</h2>
          <button className="btn btn-icon btn-sm" onClick={() => setEditor({ exportOpen: false })} disabled={busy} title="Cerrar">
            <CloseIcon size={14} />
          </button>
        </header>

        <div className="stack">
          <div className="field">
            <span className="field-label">Carpeta de la pista</span>
            <code className="code">content/tracks/{trackId}</code>
          </div>
          <label className="toggle">
            <span>Imagen satélite como textura del suelo</span>
            <input type="checkbox" checked={satellite} onChange={(e) => setSatellite(e.target.checked)} />
          </label>
          <label className="toggle">
            <span>Muro invisible en el límite del área</span>
            <input type="checkbox" checked={perimeterWalls} onChange={(e) => setPerimeterWalls(e.target.checked)} />
          </label>

          {errors.length > 0 && (
            <ul className="notice notice-error">
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
          {warnings.length > 0 && (
            <ul className="notice">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          {status.kind !== 'idle' && <p className={`notice ${status.kind === 'error' ? 'notice-error' : status.kind === 'done' ? 'notice-ok' : ''}`}>{status.text}</p>}

          <div className="dialog-actions">
            <button className="btn" disabled={busy || errors.length > 0} onClick={() => run('zip')}>
              Descargar ZIP
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || errors.length > 0 || !ac?.found}
              onClick={() => run('install')}
              title={ac?.found ? ac.tracksDir ?? '' : 'No se encontró Assetto Corsa en este equipo'}
            >
              Instalar en Assetto Corsa
            </button>
          </div>
          {ac && !ac.found && <p className="muted panel-text">No se encontró Assetto Corsa; usa «Descargar ZIP» o define ATC_AC_PATH al arrancar la app.</p>}
        </div>
      </section>
    </div>
  );
}
