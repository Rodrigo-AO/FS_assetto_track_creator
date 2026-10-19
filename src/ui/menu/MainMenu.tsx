import { useRef, useState } from 'react';
import { openTrackZip } from '../../export/projectFile';
import { useEditorStore } from '../../state/editorStore';
import { hasDraft, useProjectStore } from '../../state/projectStore';
import { ConeIcon, EditIcon, PlusIcon } from '../icons';
import './MainMenu.css';

export function MainMenu() {
  const project = useProjectStore((s) => s.project);
  const reset = useProjectStore((s) => s.reset);
  const setEditor = useEditorStore((s) => s.set);
  const notify = useEditorStore((s) => s.notify);
  const fitRequest = useEditorStore((s) => s.fitRequest);
  const fileInput = useRef<HTMLInputElement>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const openEditor = (fresh: boolean): void => {
    if (fresh) reset();
    setEditor({ screen: 'editor', tool: fresh ? 'area' : null, exportOpen: false });
  };

  const createNew = (): void => {
    if (hasDraft(project) && !window.confirm(`Se descartará el borrador «${project.name}». ¿Crear un circuito nuevo?`)) return;
    openEditor(true);
  };

  /** Editar circuito: abre el proyecto guardado en el ZIP de una pista exportada. */
  const openTrack = async (file: File): Promise<void> => {
    setOpenError(null);
    const result = openTrackZip(new Uint8Array(await file.arrayBuffer()));
    if (!result.ok) {
      setOpenError(`${file.name}: ${result.error}`);
      return;
    }
    if (hasDraft(project) && !window.confirm(`Se descartará el borrador «${project.name}». ¿Abrir «${result.project.name}»?`)) return;
    reset(result.project);
    setEditor({ screen: 'editor', tool: null, exportOpen: false, fitRequest: fitRequest + 1 });
    notify(`Circuito «${result.project.name}» abierto`, 'success');
  };

  return (
    <main className="menu">
      <div className="menu-card">
        <div className="menu-brand">
          <span className="menu-logo">
            <ConeIcon size={30} />
          </span>
          <div>
            <h1>Assetto Track Creator</h1>
            <p className="muted">Diseña circuitos de conos sobre el mapa y llévalos a Assetto Corsa.</p>
          </div>
        </div>

        <div className="menu-actions">
          <button className="menu-option menu-option-primary" onClick={createNew}>
            <PlusIcon size={26} />
            <span>
              <strong>Crear circuito</strong>
              <small>Elige una zona en el mapa satélite y traza la pista</small>
            </span>
          </button>
          <button className="menu-option" onClick={() => fileInput.current?.click()}>
            <EditIcon size={26} />
            <span>
              <strong>Editar circuito</strong>
              <small>Abre el .zip de un circuito exportado para modificarlo</small>
            </span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // permite volver a elegir el mismo archivo
              if (file) void openTrack(file);
            }}
          />
        </div>

        {openError && (
          <p className="menu-error" role="alert">
            {openError}
          </p>
        )}

        {hasDraft(project) && (
          <button className="menu-resume" onClick={() => openEditor(false)}>
            Continuar con el borrador «{project.name}»
          </button>
        )}
      </div>
    </main>
  );
}
